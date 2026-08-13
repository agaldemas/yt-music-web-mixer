/* audio-engine.js — moteur Web Audio API partagé (crossfade DSP)
 *
 * Module pur vanilla. Expose window.AudioEngine avec :
 *   - init()                            : crée l'AudioContext (lazy, idempotent)
 *   - resume()                          : débloque l'autoplay (geste utilisateur)
 *   - createDeckChain(deckId, audioEl)  : construit le graphe pour une voie
 *   - destroyDeckChain(deckId)          : teardown propre (changement de vidéo)
 *   - applyCrossfade(p)                 : 0..1 → equal-power sur les deckGain
 *   - applyMasterVolume(v)              : 0..100 → gain master (multiplicatif)
 *   - setEQ(deck, band, gainDb)         : low/mid/high (-12..+12 dB)
 *   - setDjFilter(deck, position)       : -1..+1 (lowpass ↔ bypass ↔ highpass)
 *   - getAnalyser(deck)                 : AnalyserNode par voie (visualizer)
 *   - getMasterAnalyser()               : AnalyserNode global (master spectrum)
 *
 * Graphe par voie :
 *   source → lowShelf → midPeak → highShelf → djFilter → deckGain → analyser
 *          → masterGain → masterAnalyser → ctx.destination
 *
 * Conventions : see search.js / piped-streams.js (camelCase, IIFE, window.X).
 */

(function () {
  // ===== Constantes DSP =====
  //
  // Plages/paramètres typiques console DJ. Documentés ici (et plus tard
  // exportés via window.YT_CONFIG si besoin) — l'audio-engine ne dépend pas
  // de config.js pour pouvoir être testé en isolation.
  const EQ_FREQ_LOW = 200;       // Hz (crossover graves/mediums)
  const EQ_FREQ_MID = 1000;      // Hz (centre peaking)
  const EQ_FREQ_HIGH = 4000;     // Hz (crossover mediums/aigus)
  const EQ_MID_Q = 1.0;          // facteur de qualité peaking
  const EQ_RANGE_DB = 12;        // ±12 dB par bande

  // Filtre DJ : plage de fréquences balayée par le knob
  const DJ_FILTER_LP_MAX = 200;       // position -1 → freq = 200 Hz (lowpass très fermé)
  const DJ_FILTER_LP_BYPASS = 20000;  // position 0  → freq = 20 kHz (transparent)
  const DJ_FILTER_HP_MIN = 20;        // position 0  → freq = 20 Hz (transparent)
  const DJ_FILTER_HP_MAX = 5000;      // position +1 → freq = 5 kHz (highpass très ouvert)

  // Ramping : timeConstant pour setTargetAtTime. 15ms = compromis naturel/
  // réactivité, comparable à un fader physique qui amortit légèrement.
  const RAMP_TC = 0.015;

  // ===== État interne =====

  let ctx = null;                  // AudioContext unique
  let masterGain = null;           // GainNode master partagé entre voies
  let masterAnalyser = null;       // AnalyserNode post-master (spectre global)
  const chains = Object.create(null); // { A: { ...nodes }, B: { ... } }
  let crossfadeP = 0.5;            // 0..1 mémorisé pour applyCrossfade idempotent

  // ===== Init / Resume =====

  // Crée l'AudioContext si pas déjà fait. Appelé automatiquement par
  // createDeckChain et resume(). Idempotent.
  function init() {
    if (ctx) return ctx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) {
      throw new Error('Web Audio API non supportée par ce navigateur');
    }
    ctx = new Ctor();

    // masterGain : un seul no partagé entre les 2 voies. C'est ici qu'on
    // applique le volume master (multiplicatif sur les deux deckGain).
    masterGain = ctx.createGain();
    masterGain.gain.value = 1.0;

    // masterAnalyser : placé APRÈS le masterGain (cf. spec section 2) pour
    // pouvoir visualiser ce que l'utilisateur entend vraiment (master mix).
    masterAnalyser = ctx.createAnalyser();
    masterAnalyser.fftSize = 2048;
    masterAnalyser.smoothingTimeConstant = 0.8;

    // masterGain → masterAnalyser → destination
    masterGain.connect(masterAnalyser);
    masterAnalyser.connect(ctx.destination);

    return ctx;
  }

  // Débloque l'audio après un geste utilisateur (politique autoplay). À
  // appeler depuis le premier play() / click sur play.
  async function resume() {
    if (!ctx) init();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    return ctx.state;
  }

  function getContext() {
    return ctx;
  }

  // ===== Création du graphe par voie =====

  // Crée toute la chaîne audio pour une voie (deckId = 'A' ou 'B'). Branche
  // l'élément <audio> (audioEl) dans Web Audio via MediaElementAudioSourceNode.
  //
  // ⚠️ Contrainte Web Audio API : un élément <audio> ne peut être connecté
  // qu'UNE SEULE FOIS à un MediaElementAudioSourceNode. Si on appelle
  // createDeckChain deux fois pour le même deckId, le 2e appel throw.
  // Pour changer de vidéo : NE PAS recréer la chaîne, changer `audioEl.src`.
  // Pour détruire une voie : destroyDeckChain(deckId).
  function createDeckChain(deckId, audioEl) {
    if (!audioEl || !(audioEl instanceof HTMLAudioElement)) {
      throw new Error('createDeckChain: audioEl doit être un élément <audio>');
    }
    if (chains[deckId]) {
      throw new Error('createDeckChain: deck "' + deckId + '" a déjà une chaîne active. '
        + 'Appeler destroyDeckChain() d\'abord.');
    }
    if (!ctx) init();

    // Source (entrée du graphe depuis l'<audio>)
    const source = ctx.createMediaElementSource(audioEl);

    // EQ 3 bandes
    const lowShelf = ctx.createBiquadFilter();
    lowShelf.type = 'lowshelf';
    lowShelf.frequency.value = EQ_FREQ_LOW;
    lowShelf.gain.value = 0;

    const midPeak = ctx.createBiquadFilter();
    midPeak.type = 'peaking';
    midPeak.frequency.value = EQ_FREQ_MID;
    midPeak.Q.value = EQ_MID_Q;
    midPeak.gain.value = 0;

    const highShelf = ctx.createBiquadFilter();
    highShelf.type = 'highshelf';
    highShelf.frequency.value = EQ_FREQ_HIGH;
    highShelf.gain.value = 0;

    // Filtre DJ : type dynamique selon position. Démarre en bypass (allpass).
    const djFilter = ctx.createBiquadFilter();
    djFilter.type = 'allpass';
    djFilter.frequency.value = DJ_FILTER_LP_BYPASS;
    djFilter.Q.value = 0.707; // Q par défaut raisonnable

    // Gain du crossfade (deckGain). Part à 0.5 (centre) pour ne pas avoir
    // de silence au boot si l'utilisateur appuie play avant d'avoir touché
    // le crossfader.
    const deckGain = ctx.createGain();
    deckGain.gain.value = 0.5;

    // Analyser pour visualisation par voie (spectre + waveform)
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;

    // Connexion en série
    // source → lowShelf → midPeak → highShelf → djFilter → deckGain → analyser
    source.connect(lowShelf);
    lowShelf.connect(midPeak);
    midPeak.connect(highShelf);
    highShelf.connect(djFilter);
    djFilter.connect(deckGain);
    deckGain.connect(analyser);

    // Le analyser est terminal côté deck (il n'a pas besoin de transmettre
    // l'audio au master — c'est deckGain qui le fait via une 2e connexion).
    // En fait on DOIT connecter deckGain au masterGain aussi :
    deckGain.connect(masterGain);

    chains[deckId] = {
      audioEl: audioEl,
      source: source,
      lowShelf: lowShelf,
      midPeak: midPeak,
      highShelf: highShelf,
      djFilter: djFilter,
      deckGain: deckGain,
      analyser: analyser,
    };

    // Si crossfadeP a déjà été réglé avant la création de la chaîne,
    // on l'applique tout de suite pour rester cohérent.
    if (crossfadeP !== 0.5) {
      applyDeckGain(deckId, deckGainFromP(crossfadeP, deckId));
    }

    return chains[deckId];
  }

  // Détruit proprement la chaîne d'une voie. disconnect() tous les nœuds,
  // supprime la référence. À appeler quand on bascule une voie en IFrame ou
  // qu'on veut la nettoyer complètement.
  function destroyDeckChain(deckId) {
    const chain = chains[deckId];
    if (!chain) return false;
    try {
      chain.source.disconnect();
      chain.lowShelf.disconnect();
      chain.midPeak.disconnect();
      chain.highShelf.disconnect();
      chain.djFilter.disconnect();
      chain.deckGain.disconnect();
      chain.analyser.disconnect();
    } catch (e) {
      // disconnect() throw si déjà déconnecté — pas grave, on continue.
    }
    delete chains[deckId];
    return true;
  }

  // ===== Crossfade =====

  // Calcule le gain d'une voie pour une position p ∈ [0..1].
  // Equal-power : vA = cos(p·π/2), vB = sin(p·π/2).
  // Convention de l'app : p=0 → full A, p=1 → full B.
  function deckGainFromP(p, deckId) {
    const clamped = Math.max(0, Math.min(1, Number(p) || 0));
    if (deckId === 'A') return Math.cos(clamped * Math.PI / 2);
    if (deckId === 'B') return Math.sin(clamped * Math.PI / 2);
    throw new Error('deckId inconnu : ' + deckId);
  }

  function applyDeckGain(deckId, value) {
    const chain = chains[deckId];
    if (!chain || !ctx) return;
    // Ramping fluide via setTargetAtTime : évite les clics si on drag le
    // crossfader rapidement. timeConstant=0.015s → ~50ms de transition.
    chain.deckGain.gain.setTargetAtTime(value, ctx.currentTime, RAMP_TC);
  }

  // Applique un crossfade à p ∈ [0..1]. 0 = full A, 1 = full B.
  // Met à jour immédiatement la valeur des deux deckGain (avec ramping).
  function applyCrossfade(p) {
    crossfadeP = Math.max(0, Math.min(1, Number(p) || 0));
    if (!ctx) return;
    if (chains.A) applyDeckGain('A', deckGainFromP(crossfadeP, 'A'));
    if (chains.B) applyDeckGain('B', deckGainFromP(crossfadeP, 'B'));
  }

  // ===== Master volume =====

  // Applique le volume master v ∈ [0..100]. Multiplicatif (gain = v/100).
  function applyMasterVolume(v) {
    if (!ctx) return;
    const value = Math.max(0, Math.min(1, (Number(v) || 0) / 100));
    masterGain.gain.setTargetAtTime(value, ctx.currentTime, RAMP_TC);
  }

  // ===== EQ 3 bandes =====

  // band = 'low' | 'mid' | 'high'
  // gainDb ∈ [-12..+12] (clampé). Ramping court pour éviter clics.
  function setEQ(deckId, band, gainDb) {
    const chain = chains[deckId];
    if (!chain || !ctx) return;
    const clamped = Math.max(-EQ_RANGE_DB, Math.min(EQ_RANGE_DB, Number(gainDb) || 0));
    const node = band === 'low' ? chain.lowShelf
      : band === 'mid' ? chain.midPeak
      : band === 'high' ? chain.highShelf
      : null;
    if (!node) throw new Error('setEQ: band inconnue "' + band + '"');
    node.gain.setTargetAtTime(clamped, ctx.currentTime, RAMP_TC);
  }

  // ===== Filtre DJ (sweep LowPass ↔ Bypass ↔ HighPass) =====

  // position ∈ [-1..+1]
  //   -1 → lowpass très fermé (200 Hz)
  //    0 → bypass (transparent, allpass à 20 kHz)
  //   +1 → highpass très ouvert (5 kHz)
  function setDjFilter(deckId, position) {
    const chain = chains[deckId];
    if (!chain || !ctx) return;
    const pos = Math.max(-1, Math.min(1, Number(position) || 0));
    const node = chain.djFilter;

    if (pos < 0) {
      // Lowpass : position [-1..0] → freq [200..20000 Hz] (log scale)
      // pos=0 → freq=20000 (transparent), pos=-1 → freq=200 (très fermé).
      // On interpole en domaine log pour une sensation régulière du knob :
      // freq = exp(maxLog - t * (maxLog - minLog)) avec t=-pos ∈ [0..1].
      const t = -pos; // 0..1
      const minLog = Math.log(DJ_FILTER_LP_MAX);    // log(200)
      const maxLog = Math.log(DJ_FILTER_LP_BYPASS); // log(20000)
      const freq = Math.exp(maxLog + t * (minLog - maxLog));
      node.type = 'lowpass';
      node.frequency.setTargetAtTime(freq, ctx.currentTime, RAMP_TC);
    } else if (pos > 0) {
      // Highpass : position [0..+1] → freq [20..5000 Hz]
      // pos=0 → freq=20 (transparent), pos=+1 → freq=5000 (très ouvert).
      const t = pos; // 0..1
      const minLog = Math.log(DJ_FILTER_HP_MIN);  // log(20)
      const maxLog = Math.log(DJ_FILTER_HP_MAX);  // log(5000)
      const freq = Math.exp(minLog + t * (maxLog - minLog));
      node.type = 'highpass';
      node.frequency.setTargetAtTime(freq, ctx.currentTime, RAMP_TC);
    } else {
      // Bypass : allpass (transparent) — on laisse lowpass à 20 kHz pour
      // éviter de changer le type inutilement (et garder la résonance neutre).
      node.type = 'lowpass';
      node.frequency.setTargetAtTime(DJ_FILTER_LP_BYPASS, ctx.currentTime, RAMP_TC);
    }
  }

  // ===== Accesseurs =====

  function getAnalyser(deckId) {
    return chains[deckId] ? chains[deckId].analyser : null;
  }

  function getMasterAnalyser() {
    return masterAnalyser;
  }

  function hasDeck(deckId) {
    return !!chains[deckId];
  }

  function getDeckAudioElement(deckId) {
    return chains[deckId] ? chains[deckId].audioEl : null;
  }

  // ===== API publique =====
  window.AudioEngine = {
    init: init,
    resume: resume,
    getContext: getContext,
    createDeckChain: createDeckChain,
    destroyDeckChain: destroyDeckChain,
    applyCrossfade: applyCrossfade,
    applyMasterVolume: applyMasterVolume,
    setEQ: setEQ,
    setDjFilter: setDjFilter,
    getAnalyser: getAnalyser,
    getMasterAnalyser: getMasterAnalyser,
    hasDeck: hasDeck,
    getDeckAudioElement: getDeckAudioElement,
    // Constantes exportées (debug / config UI)
    CONST: {
      EQ_FREQ_LOW: EQ_FREQ_LOW,
      EQ_FREQ_MID: EQ_FREQ_MID,
      EQ_FREQ_HIGH: EQ_FREQ_HIGH,
      EQ_MID_Q: EQ_MID_Q,
      EQ_RANGE_DB: EQ_RANGE_DB,
      DJ_FILTER_LP_MAX: DJ_FILTER_LP_MAX,
      DJ_FILTER_HP_MAX: DJ_FILTER_HP_MAX,
    },
  };
})();
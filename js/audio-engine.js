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
 *   - setPitch(deck, pitchPct)          : -8..+8 % → audioEl.playbackRate (tempo)
 *   - getPitch(deck)                    : pitch courant en % (0 = vitesse native)
 *   - resetPitch(deck)                  : remet le tempo à 0 % (playbackRate = 1)
 *   - getAnalyser(deck)                 : AnalyserNode par voie (visualizer)
 *   - getMasterAnalyser()               : AnalyserNode global (master spectrum)
 *   - decodeDeckBuffer(deckId, url)     : fetch + decodeAudioData → AudioBuffer
 *                                         en mémoire (scratch, Approche C hybride)
 *   - engageScratch(deckId)             : bascule la source vers AudioBufferSourceNode
 *   - disengageScratch(deckId, posSec)  : rebascule vers MediaElementSource,
 *                                         remet audio.currentTime à posSec
 *   - setScratchRate(deckId, rate)      : playbackRate du scratch (peut être < 0)
 *   - seekScratch(deckId, sec)          : recrée l'AudioBufferSourceNode à sec
 *   - isScratchEngaged(deckId)          : true si le scratch est actif
 *   - getDeckBuffer(deckId)             : AudioBuffer du deck (ou null)
 *   - clearDeckBuffer(deckId)           : libère le buffer (changement de morceau)
 *
 * Graphe par voie :
 *   source → scratchGain → lowShelf → midPeak → highShelf → djFilter ─┬→ deckGain → masterGain
 *                                                                     │            → masterAnalyser → ctx.destination
 *                                                                     └→ analyser (tap pre-fader, visualiseur de voie)
 *
 * `scratchGain` est un GainNode intermédiaire (gain=1 en mode normal) servant
 * de point d'entrée commun à la chaîne EQ. En mode scratch, on y branche un
 * AudioBufferSourceNode à la place du MediaElementSource : on déconnecte ce
 * dernier de scratchGain et on connecte le buffer source. Au relâchement, on
 * fait l'inverse. Le ducking (~10-30 ms) au point de bascule évite le clic.
 *
 * Le visualiseur de voie tapote AVANT le deckGain : il reste actif même si
 * le crossfader coupe la voie (deckGain ≈ 0). Le masterAnalyser, lui, est
 * post-masterGain et reflète le mix de sortie effectif.
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

  // Scratch (phase 11) — constantes. Le scratch hybride bascule la source
  // entre le MediaElementAudioSourceNode (streaming normal) et un
  // AudioBufferSourceNode (vrai scratch bidirectionnel, pitch variable).
  //   - DUCK_TC : timeConstant du ducking au moment du swap de source
  //     (~15 ms). On ramp le scratchGain à ~0, on swap, puis on remonte.
  //     Évite le clic audible lié à la reconnexion d'un nœud source.
  //   - DUCK_HOLD_MS : durée où le gain reste proche de 0 pendant le swap.
  //   - SCRATCH_MAX_RATE : borne du playbackRate du scratch (avant/arrière).
  const DUCK_TC = 0.012;
  const DUCK_HOLD_MS = 16;
  const SCRATCH_MAX_RATE = 3;

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

    // Scratch gain : point d'entrée commun de la chaîne EQ. En mode normal
    // (streaming), le MediaElementSource s'y connecte. En mode scratch, on
    // le déconnecte et on y branche un AudioBufferSourceNode. gain=1 par
    // défaut ; ducking temporaire au moment du swap (cf. engage/disengage).
    const scratchGain = ctx.createGain();
    scratchGain.gain.value = 1.0;

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

    // Connexion : source → scratchGain → EQ → djFilter, puis split pre-fader.
    //   - Une branche → deckGain → masterGain (chemin audio, niveau crossfade).
    //   - Une branche → analyser (tap PRE-fader : visualise le flux en lecture,
    //     indépendamment du deckGain/crossfader). Ainsi le visualiseur d'une voie
    //     reste actif même si son crossfade est à 0.
    // scratchGain sert de pivot : en mode scratch, on y branche un
    // AudioBufferSourceNode à la place du MediaElementSource.
    source.connect(scratchGain);
    scratchGain.connect(lowShelf);
    lowShelf.connect(midPeak);
    midPeak.connect(highShelf);
    highShelf.connect(djFilter);

    // Branche audio (niveau dépendant du crossfader + master).
    djFilter.connect(deckGain);
    deckGain.connect(masterGain);

    // Tap pre-fader : l'analyser voit le signal post-EQ/filtre mais AVANT
    // le deckGain. Insensible au crossfade et au volume master.
    djFilter.connect(analyser);

    chains[deckId] = {
      audioEl: audioEl,
      source: source,
      scratchGain: scratchGain,
      scratchEngaged: false,
      scratchBuffer: null,
      scratchNode: null,
      scratchOffset: 0,
      scratchStartTime: 0,
      lowShelf: lowShelf,
      midPeak: midPeak,
      highShelf: highShelf,
      djFilter: djFilter,
      deckGain: deckGain,
      analyser: analyser,
      scratchRate: 0,        // dernier rate POSÉ (pour accumulateOffset en arrière)
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
    // Si un scratch est en cours, on libère d'abord le nœud scratch.
    try {
      if (chain.scratchNode) {
        chain.scratchNode.onended = null;
        chain.scratchNode.stop();
        chain.scratchNode.disconnect();
      }
    } catch (e) { /* already stopped */ }
    try {
      chain.source.disconnect();
      chain.scratchGain.disconnect();
      chain.lowShelf.disconnect();
      chain.midPeak.disconnect();
      chain.highShelf.disconnect();
      chain.djFilter.disconnect();
      chain.deckGain.disconnect();
      chain.analyser.disconnect();
    } catch (e) {
      // disconnect() throw si déjà déconnecté — pas grave, on continue.
    }
    // Libère la mémoire du buffer scratch (important : ~10 Mo/min).
    chain.scratchBuffer = null;
    chain.scratchNode = null;
    chain.scratchEngaged = false;
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

  // ===== Pitch / Tempo (phase 7) =====
  //
  // Agit sur audioEl.playbackRate pour le beatmatching. Le pitch est donné
  // en pourcentage (-8..+8 typiquement) : playbackRate = 1 + pitch/100.
  // La préservation de la hauteur (pas d'effet "chipmunk") est posée sur
  // l'élément <audio> dès sa création dans audio-player.js (preservesPitch).
  // Les préfixes moz/webkit sont gérés là-bas — ici on ne fait que la vitesse.
  function setPitch(deckId, pitchPercent) {
    const chain = chains[deckId];
    if (!chain || !chain.audioEl) return;
    const p = Number(pitchPercent) || 0;
    // On clamp conservative via PITCH_RANGE_PERCENT si dispo, sinon ±8%.
    const limit = (window.YT_CONFIG && window.YT_CONFIG.PITCH_RANGE_PERCENT) || 8;
    const clamped = Math.max(-limit, Math.min(limit, p));
    const rate = 1 + clamped / 100;
    // Garde-fou : ne jamais tomber à 0 ou négatif (lecture cassée).
    chain.audioEl.playbackRate = Math.max(0.0625, rate);
  }

  function getPitch(deckId) {
    const chain = chains[deckId];
    if (!chain || !chain.audioEl) return 0;
    const rate = chain.audioEl.playbackRate;
    return isFinite(rate) ? (rate - 1) * 100 : 0;
  }

  function resetPitch(deckId) {
    setPitch(deckId, 0);
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

  // ===== Scratch / platine vinyle (phase 11) — Approche C hybride =====
  //
  // Mode normal : MediaElementAudioSourceNode (streaming, économique).
  // Mode scratch : AudioBufferSourceNode (PCM en mémoire, lecture avant/
  // arrière, pitch variable — le vrai son de scratch). On bascule l'un par
  // l'autre au moment de l'engage, avec ducking pour éviter le clic.
  //
  // ⚠️ AudioBufferSourceNode est one-shot : un seul start()/stop() par
  // instance. seekScratch() doit donc recréer le nœud (stop → nouveau →
  // connecter → start(0, offset)).
  //
  // ⚠️ Conflit preservesPitch : le beatmatch (setPitch) veut preservesPitch
  // =true, le scratch veut le pitch variable. AudioBufferSourceNode ne
  // préserve JAMAIS le pitch → c'est ce qu'on veut pour le scratch. Les
  // deux modes sont mutuellement exclusifs sur une voix à un instant t.

  // Ducking : ramp scratchGain → ~0, hold, swap de source, remontée → 1.
  // On renvoie une promesse résolue quand le gain est effectivement ~0
  // (safe pour déconnecter/reconnecter sans clic).
  function duckDown(chain) {
    const t = ctx.currentTime;
    chain.scratchGain.gain.setTargetAtTime(0.0001, t, DUCK_TC);
    return new Promise(function (resolve) {
      setTimeout(resolve, DUCK_HOLD_MS + 6);
    });
  }

  function duckUp(chain, target) {
    const t = ctx.currentTime;
    chain.scratchGain.gain.setTargetAtTime(target == null ? 1 : target, t, DUCK_TC);
  }

  // Pré-charge un AudioBuffer pour le scratch. XMLHttpRequest + progress +
  // decodeAudioData. Stocké dans chains[deck].scratchBuffer.
  //
  // ⚠️ On utilise XHR (et pas fetch+arrayBuffer) car res.arrayBuffer() met
  // ~100 s sur 3 Mo via le relais /api/audio — le CDN YouTube throttle la
  // 2e connexion (l'<audio> streame déjà la 1re). XHR avec responseType=
  // 'arraybuffer' + onprogress permet aussi d'afficher la progression.
  //
  // onProgress(fraction 0..1) est appelé pendant le téléchargement.
  function decodeDeckBuffer(deckId, url, onProgress) {
    const chain = chains[deckId];
    if (!ctx) init();
    if (!chain || !url) throw new Error('decodeDeckBuffer: deck ou url manquant');

    return new Promise(function (resolve, reject) {
      var _t0 = performance.now();
      console.log('%c[scratch:' + deckId + '] decodeDeckBuffer START (XHR) — url='
        + (url.length > 80 ? url.slice(0, 80) + '…' : url), 'color:#e80');

      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      // Range: bytes=0- → force une réponse 206 (pleine vitesse). Sans ce header,
      // le CDN YouTube throttle les downloads complets (200) à ~30 Ko/s — le
      // scratch reste bloqué à ~14% (cf. fetch principal dans audio-player.js).
      // Ce chemin XHR n'est qu'un SECOURS quand le tee échoue ; il doit rester
      // aussi rapide que le fetch principal.
      xhr.setRequestHeader('Range', 'bytes=0-');
      xhr.responseType = 'arraybuffer';

      xhr.onprogress = function (e) {
        if (e.lengthComputable) {
          var pct = (e.loaded / e.total * 100).toFixed(0);
          var mo = (e.loaded / 1024 / 1024).toFixed(1);
          var totalMo = (e.total / 1024 / 1024).toFixed(1);
          console.log('[scratch:' + deckId + '] download ' + pct + '%  (' + mo + '/' + totalMo + ' Mo)');
          if (typeof onProgress === 'function') onProgress(e.loaded / e.total);
        }
      };

      xhr.onload = function () {
        if (xhr.status !== 200 && xhr.status !== 206) {
          console.error('[scratch:' + deckId + '] XHR HTTP ' + xhr.status);
          reject(new Error('decodeDeckBuffer: HTTP ' + xhr.status));
          return;
        }
        var arr = xhr.response;
        var dlMs = (performance.now() - _t0).toFixed(0);
        console.log('%c[scratch:' + deckId + '] ← XHR ' + (arr.byteLength / 1024 / 1024).toFixed(2)
          + ' Mo en ' + dlMs + 'ms', 'color:#08e;font-weight:bold');

        console.log('[scratch:' + deckId + '] → ctx.decodeAudioData('
          + (arr.byteLength / 1024 / 1024).toFixed(2) + ' Mo)…');
        var _tdec = performance.now();
        ctx.decodeAudioData(arr).then(function (decoded) {
          var decMs = (performance.now() - _tdec).toFixed(0);
          console.log('%c[scratch:' + deckId + '] ← decodeAudioData en ' + decMs + 'ms'
            + '  → duration=' + decoded.duration.toFixed(1) + 's'
            + '  channels=' + decoded.numberOfChannels
            + '  sampleRate=' + decoded.sampleRate
            + '  PCM=' + (decoded.length * decoded.numberOfChannels * 4 / 1024 / 1024).toFixed(1) + ' Mo',
            'color:#0a0;font-weight:bold');
          chain.scratchBuffer = decoded;
          console.log('%c[scratch:' + deckId + '] decodeDeckBuffer TOTAL '
            + (performance.now() - _t0).toFixed(0) + 'ms', 'color:#e80;font-weight:bold');
          resolve(decoded);
        }).catch(function (err) {
          console.error('[scratch:' + deckId + '] decodeAudioData ÉCHEC:', err);
          reject(err);
        });
      };

      xhr.onerror = function () {
        console.error('[scratch:' + deckId + '] XHR réseau erreur');
        reject(new Error('decodeDeckBuffer: erreur réseau (XHR)'));
      };
      xhr.ontimeout = function () {
        console.error('[scratch:' + deckId + '] XHR timeout');
        reject(new Error('decodeDeckBuffer: timeout réseau (XHR)'));
      };

      xhr.send();
    });
  }

  // Bascule vers le scratch. Déconnecte le MediaElementSource de scratchGain,
  // crée un AudioBufferSourceNode branché sur scratchGain, démarre à
  // scratchOffset (position courante du <audio>).
  async function engageScratch(deckId) {
    const chain = chains[deckId];
    if (!ctx || !chain) throw new Error('engageScratch: deck "' + deckId + '" absent');
    if (chain.scratchEngaged) return;
    if (!chain.scratchBuffer) {
      throw new Error('engageScratch: buffer non décodé (appeler decodeDeckBuffer)');
    }
    console.log('%c[scratch:' + deckId + '] engageScratch: swap source → AudioBufferSourceNode'
      + '  buffer.duration=' + chain.scratchBuffer.duration.toFixed(1) + 's',
      'color:#e80');
    // Mémorise la position de lecture courante pour démarrer le scratch
    // au même endroit (et pouvoir y revenir au disengage).
    const offset = isFinite(chain.audioEl.currentTime)
      ? chain.audioEl.currentTime : 0;
    chain.scratchOffset = Math.max(0, Math.min(offset,
      chain.scratchBuffer.duration));

    // Ducking avant le swap (évite le clic de reconnexion).
    await duckDown(chain);
    // ⚠️ On NE met PAS l'<audio> en pause. Son signal est déconnecté du graphe
    // (source.disconnect ci-dessous) → il est silencieux, mais il reste en
    // lecture. C'est voulu : au disengage, le seek sur un élément EN LECTURE
    // est fiable, alors qu'un seek sur un élément paused-puis-rejoué est avalé
    // par le navigateur (le moteur rejouait à l'ancienne position → "retour à
    // la case départ"). L'audio avance en silence pendant le scratch ; on le
    // re-seek à la position finale au relâchement.
    const wasPlaying = !chain.audioEl.paused;

    // Crée le nœud scratch. onended remonte quand le buffer atteint la fin
    // (scratch en lecture avant prolongé) — on le neutralise pendant le
    // scratch actif (recréation au prochain geste).
    const node = ctx.createBufferSource();
    node.buffer = chain.scratchBuffer;
    node.playbackRate.value = 0; // figé au départ (l'utilisateur tient la platine)
    node.connect(chain.scratchGain);
    try {
      node.start(0, chain.scratchOffset);
    } catch (e) {
      // start() peut throw si offset > duration (fin de morceau).
      node.disconnect();
      duckUp(chain, 1);
      throw e;
    }
    chain.scratchNode = node;
    chain.scratchEngaged = true;
    chain.scratchStartTime = ctx.currentTime;

    // On déconnecte le MediaElementSource du scratchGain (il n'alimente
    // plus la chaîne EQ). On garde la référence pour la rebrancher au
    // disengage. ⚠️ On ne déconnecte pas TOUT (sinon on coupe aussi le
    // tap analyser qui part de djFilter — on veut juste remplacer la
    // source). disconnect() sans args coupe toutes les sorties du nœud,
    // ce qui est ce qu'on veut pour le source.
    try { chain.source.disconnect(); } catch (e) { /* déjà déconnecté */ }

    // Remonte le gain (le swap est fait, on peut réentendre).
    duckUp(chain, 1);

    return {
      offset: chain.scratchOffset,
      wasPlaying: wasPlaying,
    };
  }

  // Rebascule vers le streaming. Stoppe le nœud scratch, rebranche le
  // MediaElementSource sur scratchGain, remet audio.currentTime à posSec,
  // reprend la lecture si wasPlaying (renvoyé par engageScratch).
  function disengageScratch(deckId, posSec, wasPlaying) {
    const chain = chains[deckId];
    if (!ctx || !chain || !chain.scratchEngaged) return;
    const dur = isFinite(chain.audioEl.duration) ? chain.audioEl.duration : 0;
    const target = Math.max(0, Math.min(Number(posSec) || 0, dur > 0 ? dur : Infinity));

    // Ducking, swap, remontée.
    duckDown(chain).then(function () {
      // Stoppe et libère le nœud scratch (one-shot → irréutilisable).
      try {
        if (chain.scratchNode) {
          chain.scratchNode.onended = null;
          chain.scratchNode.stop();
          chain.scratchNode.disconnect();
        }
      } catch (e) { /* déjà stoppé */ }
      chain.scratchNode = null;
      chain.scratchEngaged = false;
      chain.scratchOffset = target;

      // Rebranche le MediaElementSource sur scratchGain.
      try { chain.source.connect(chain.scratchGain); } catch (e) { /* ignore */ }

      var audio = chain.audioEl;

      // ⚠️ Cause réelle du "retour à la case départ" : sur un <audio> Blob EN
      // PAUSE, un seek (currentTime=X) n'est pas honoré par le moteur de
      // décodage (la propriété lit X mais le moteur garde l'ancienne position).
      // À la reprise de lecture, le moteur rejoue à l'ancienne position.
      // Fix : on engage le moteur AVANT le seek (play() silencieux à gain 0),
      // on seek sur un élément en lecture active → seek honoré. On attend
      // 'seeked' pour confirmer, puis on remonte le gain et on repause si
      // l'utilisateur ne voulait pas reprendre.
      var applySeek = function () {
        try { audio.currentTime = target; } catch (e) { /* seek impossible */ }
      };

      var done = false;
      var finalize = function () {
        if (done) return;
        done = true;
        duckUp(chain, 1);
        if (!wasPlaying && !audio.paused) {
          try { audio.pause(); } catch (e) { /* ignore */ }
        }
        console.log('[scratch:' + deckId + '] disengageScratch FINAL currentTime='
          + (isFinite(audio.currentTime) ? audio.currentTime.toFixed(2) : '?')
          + 's (target=' + target.toFixed(2) + '  paused=' + audio.paused + ')');
      };

      var afterSeek = function () {
        audio.addEventListener('seeked', finalize, { once: true });
        setTimeout(finalize, 150);
      };

      if (audio.paused) {
        var pr = audio.play();
        var onEngaged = function () { applySeek(); afterSeek(); };
        if (pr && typeof pr.then === 'function') {
          pr.then(onEngaged, function () { applySeek(); afterSeek(); });
        } else { onEngaged(); }
      } else {
        applySeek();
        afterSeek();
      }
    });
  }

  // Ajuste le playbackRate du scratch (vitesse + direction). rate=0 fige,
  // rate<0 = lecture arrière (vrai scratch), rate>0 = avant.
  //
  // ⚠️ Avant chaque changement de rate, on ACCUMULE la position réelle
  // avancée depuis le dernier ancrage (scratchOffset += dt × oldRate), puis
  // on re-ancre scratchStartTime = maintenant. On lit oldRate sur la valeur
  // POSÉE (setValueAtTime, instantané) — pas sur un ramp — pour que
  // l'accumulation soit EXACTE sur plusieurs tours (1 tour = SEC_PER_TURN s).
  // Sans accumulation, getScratchPosition ferait totalElapsed × currentRate
  // (faux : le rate change tout le temps) → la position retombait à l'initial.
  function setScratchRate(deckId, rate) {
    const chain = chains[deckId];
    if (!ctx || !chain || !chain.scratchNode) return;
    const t = ctx.currentTime;
    // Accumule la position réelle depuis le dernier ancrage. On utilise le
    // dernier rate POSÉ (chain.scratchRate) — pas .value qui peut être en
    // plein ramp et donnerait une accumulation inexacte (problème multi-tours).
    if (chain.scratchStartTime && chain.scratchBuffer) {
      const oldRate = chain.scratchRate || 0;
      const dt = t - chain.scratchStartTime;
      chain.scratchOffset = chain.scratchOffset + dt * oldRate;
      // Boucle multi-tours : quand on dépasse la fin (plusieurs tours en
      // avant) ou le début (plusieurs tours en arrière), on reboucle
      // modulo la durée du morceau — vraie platine qui n'a pas de "bord".
      const dur = chain.scratchBuffer.duration;
      if (dur > 0) {
        chain.scratchOffset = ((chain.scratchOffset % dur) + dur) % dur;
      } else {
        chain.scratchOffset = 0;
      }
    }
    chain.scratchStartTime = t;
    const r = Math.max(-SCRATCH_MAX_RATE, Math.min(SCRATCH_MAX_RATE, Number(rate) || 0));
    chain.scratchRate = r;
    // setValueAtTime (instantané) : l'accumulation reste exacte. Le lissage
    // est déjà fait côté scratch.js (low-pass SMOOTH) → pas de ramp AudioParam.
    chain.scratchNode.playbackRate.setValueAtTime(r, t);
  }

  // Recrée le nœud scratch à un offset précis (seek scratch). Comme
  // AudioBufferSourceNode est one-shot, on stoppe l'ancien et on en crée
  // un nouveau démarré à `sec`. Utilisé quand l'utilisateur déplace
  // violemment la platine (saut de position).
  function seekScratch(deckId, sec) {
    const chain = chains[deckId];
    if (!ctx || !chain || !chain.scratchEngaged || !chain.scratchBuffer) return;
    const offset = Math.max(0, Math.min(Number(sec) || 0,
      chain.scratchBuffer.duration));
    // Ducking court, swap, remontée — pour éviter le clic du stop/start.
    duckDown(chain).then(function () {
      try {
        if (chain.scratchNode) {
          chain.scratchNode.onended = null;
          chain.scratchNode.stop();
          chain.scratchNode.disconnect();
        }
      } catch (e) { /* déjà stoppé */ }
      const node = ctx.createBufferSource();
      node.buffer = chain.scratchBuffer;
      node.playbackRate.value = 0;
      node.connect(chain.scratchGain);
      try {
        node.start(0, offset);
      } catch (e) {
        node.disconnect();
        duckUp(chain, 1);
        return;
      }
      chain.scratchNode = node;
      chain.scratchOffset = offset;
      chain.scratchStartTime = ctx.currentTime;
      duckUp(chain, 1);
    });
  }

  // Position de lecture courante du scratch (pour affichage et reprise au
  // disengage). scratchOffset est ACCUMULÉ à chaque setScratchRate (vrai
  // delta intégré) ; on ajoute seulement l'avance depuis le dernier ancrage.
  // Au relâchement → disengageScratch reçoit la position réelle, pas l'initiale.
  function getScratchPosition(deckId) {
    const chain = chains[deckId];
    if (!chain || !chain.scratchBuffer) return chain ? chain.scratchOffset : 0;
    if (!chain.scratchEngaged) return chain.scratchOffset;
    // Rate POSÉ (pas .value en plein ramp) pour une position exacte multi-tours.
    const rate = chain.scratchRate || 0;
    const dt = ctx.currentTime - chain.scratchStartTime;
    let pos = chain.scratchOffset + dt * rate;
    const dur = chain.scratchBuffer.duration;
    if (dur > 0) pos = ((pos % dur) + dur) % dur;  // boucle (vraie platine)
    return pos;
  }

  function isScratchEngaged(deckId) {
    return !!(chains[deckId] && chains[deckId].scratchEngaged);
  }

  function getDeckBuffer(deckId) {
    return chains[deckId] ? chains[deckId].scratchBuffer : null;
  }

  // Libère le buffer scratch d'une voie (changement de morceau / mode).
  function clearDeckBuffer(deckId) {
    const chain = chains[deckId];
    if (!chain) return;
    if (chain.scratchEngaged) {
      // Si le scratch est actif, on le désengage proprement avant.
      try { disengageScratch(deckId, chain.scratchOffset, false); } catch (e) {}
    }
    chain.scratchBuffer = null;
    chain.scratchLoadPromise = null; // tee: invalide aussi la promesse de décodage en cours
  }

  // ===== Tee: décodage du buffer scratch à partir d'un ArrayBuffer déjà téléchargé =====
  //
  // Évite la 2e requête XHR (throttle CDN YouTube). audio-player.js fetch() une
  // seule fois le flux, partage les octets : un Blob pour la lecture (audio.src)
  // et ce tableau pour le scratch via decodeAudioData. Dédupliqué via
  // chain.scratchLoadPromise : si l'utilisateur clique la platine avant la fin
  // du décodage, scratch.js récupère la même promesse (getDeckBufferLoadPromise).
  // Décode un ArrayBuffer déjà téléchargé en AudioBuffer scratch. Pure décodage
  // (pas de dedup ici) : la promesse est enregistrée tôt par audio-player.js via
  // setDeckBufferLoadPromise() DÈS LE DÉBUT du download → ensureBuffer() la trouve
  // pendant le fetch et attend au lieu de relancer un 2e XHR (throttle CDN).
  // decodeAudioData peut neutered son entrée → on passe une copie.
  function loadDeckBufferFromBlob(deckId, arrayBuffer) {
    const chain = chains[deckId];
    if (!ctx) init();
    if (!chain) throw new Error('loadDeckBufferFromBlob: deck absent');
    if (chain.scratchBuffer) return Promise.resolve(chain.scratchBuffer);

    var copy = arrayBuffer.slice(0);
    var _t0 = performance.now();
    console.log('%c[scratch:' + deckId + '] loadDeckBufferFromBlob START — '
      + (copy.byteLength / 1024 / 1024).toFixed(2) + ' Mo (tee, pas de re-fetch)', 'color:#e80');

    return ctx.decodeAudioData(copy).then(function (decoded) {
      chain.scratchBuffer = decoded;
      chain.scratchLoadPromise = null;
      console.log('%c[scratch:' + deckId + '] loadDeckBufferFromBlob ✓ PRÊT'
        + '  duration=' + decoded.duration.toFixed(1) + 's'
        + '  PCM=' + (decoded.length * decoded.numberOfChannels * 4 / 1024 / 1024).toFixed(1) + ' Mo'
        + '  decode=' + (performance.now() - _t0).toFixed(0) + 'ms', 'color:#0a0;font-weight:bold');
      return decoded;
    }).catch(function (err) {
      chain.scratchLoadPromise = null;
      console.error('[scratch:' + deckId + '] loadDeckBufferFromBlob decodeAudioData ÉCHEC:', err);
      throw err;
    });
  }

  // Enregistre la promesse de décodage scratch AVANT que le download ne termine.
  // audio-player.js compose : scratchPromise = fetchDownload.then(decode), puis
  // appelle setDeckBufferLoadPromise(deck, scratchPromise) dès le début du fetch.
  // Ainsi getDeckBufferLoadPromise() retourne non-null pendant tout le download →
  // ensureBuffer() attend le tee au lieu de relancer un XHR parallèle.
  function setDeckBufferLoadPromise(deckId, promise) {
    const chain = chains[deckId];
    if (chain) chain.scratchLoadPromise = promise;
  }

  // Renvoie la promesse de décodage tee en vol (ou null) → scratch.js attend
  // le même décodage au lieu de relancer fetch/XHR.
  function getDeckBufferLoadPromise(deckId) {
    return chains[deckId] ? chains[deckId].scratchLoadPromise : null;
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
    setPitch: setPitch,
    getPitch: getPitch,
    resetPitch: resetPitch,
    getAnalyser: getAnalyser,
    getMasterAnalyser: getMasterAnalyser,
    hasDeck: hasDeck,
    getDeckAudioElement: getDeckAudioElement,
    // Scratch / platine (phase 11)
    decodeDeckBuffer: decodeDeckBuffer,
    engageScratch: engageScratch,
    disengageScratch: disengageScratch,
    setScratchRate: setScratchRate,
    seekScratch: seekScratch,
    getScratchPosition: getScratchPosition,
    isScratchEngaged: isScratchEngaged,
    getDeckBuffer: getDeckBuffer,
    clearDeckBuffer: clearDeckBuffer,
    loadDeckBufferFromBlob: loadDeckBufferFromBlob,
    setDeckBufferLoadPromise: setDeckBufferLoadPromise,
    getDeckBufferLoadPromise: getDeckBufferLoadPromise,
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
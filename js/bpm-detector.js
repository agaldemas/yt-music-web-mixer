/* bpm-detector.js — Détection BPM temps réel + beatmatch (phase 9)
 *
 * Estime le tempo de chaque voie (A / B) en analysant l'AnalyserNode du
 * moteur audio. Algorithme simplifié de détection de beats basé sur
 * l'énergie de la bande bass (kick drum, 20-150 Hz) :
 *   1. Échantillonne analyser.getByteFrequencyData() à ~50 ms
 *   2. Isole les bins correspondant à 20-150 Hz (le kick drum)
 *   3. Calcule l'énergie (somme des amplitudes normalisée)
 *   4. Détecte les pics d'énergie : un beat = pic dépassant un seuil
 *      adaptatif (moyenne mobile + marge)
 *   5. Stocke les timestamps des beats dans une fenêtre glissante (~10 s)
 *   6. Calcule les intervalles inter-beat → médiane = intervalle moyen
 *   7. bpm = 60000 / intervalleMoyen (intervalle en ms)
 *   8. Filtre dans la plage plausible 60-200 BPM
 *
 * beatmatch (SYNC) : ajuste audioB.playbackRate pour matcher le BPM de A.
 *   ratio = bpmA / bpmB → playbackRate = clamp(ratio, 0.92, 1.08).
 *   La préservation de la hauteur (preservesPitch) est déjà posée sur
 *   l'<audio> par audio-player.js → on change la vitesse sans changer
 *   le pitch (pas d'effet "chipmunk").
 *
 * API :
 *   BPMDetector.start(deck)    : démarre la détection sur une voie
 *   BPMDetector.stop(deck)    : stoppe la détection
 *   BPMDetector.startAll()    : démarre A + B
 *   BPMDetector.stopAll()     : stoppe A + B
 *   BPMDetector.getBPM(deck)   : BPM détecté (number, 0 si inconnu)
 *   BPMDetector.getEffectiveBPM(deck) : BPM * playbackRate (effectif)
 *   BPMDetector.syncBtoA()    : ajuste le pitch de B pour matcher A
 *
 * Limitations :
 *   - Détection approximative (±2-3 BPM).
 *   - Les transitions, builds et breaks faussent la détection.
 *   - Le beatmatch n'est pas parfait — un écart résiduel subsiste.
 *   - Pas de sync frame-accurate possible sur YouTube.
 *
 * Conventions : IIFE, vanilla JS, camelCase, window.BPMDetector exposé.
 */

(function () {
  // ===== Constantes =====
  var POLL_MS = 50;                  // échantillonnage ~20 Hz (spec ~50 ms)
  var WINDOW_MS = 10000;             // fenêtre glissante des beats (~10 s)
  var BPM_MIN = 60;                  // plage plausible
  var BPM_MAX = 200;
  var MAX_BEATS = 200;               // borne anti-explosion mémoire
  // Seuil adaptatif : un beat = énergie > moyenne mobile * FACTOR.
  // 1.55 = compromis : assez sensible pour capter les kicks, assez strict
  // pour ignorer le reste du spectre. À ajuster empiriquement.
  var ADAPTIVE_FACTOR = 1.55;
  // Lissage du BPM : on garde un EMA (exponential moving average) pour
  // éviter que le chiffre saute à chaque beat. 0.15 = lissage doux.
  var BPM_EMA_ALPHA = 0.15;
  // Anti-burst : ignore un beat à < 250 ms du précédent (250 ms = 240 BPM,
  // au-dessus du max plausible → faux positif sur du bruit).
  var MIN_BEAT_GAP_MS = 250;
  // Tempo de sync : limite du pitch en % (cohérent avec PITCH_RANGE_PERCENT).
  var SYNC_LIMIT = 0.08;            // ±8 %

  // ===== État par voie =====
  var detectors = { A: null, B: null };
  var timers = { A: null, B: null };

  function makeDetector() {
    return {
      analyser: null,
      freqBuf: null,
      beats: [],               // timestamps (ms) des beats détectés
      lastBeatAt: 0,           // timestamp du dernier beat (anti-burst)
      energyHistory: [],       // fenêtre glissante de l'énergie (moyenne mobile)
      rawBPM: 0,               // BPM issu de la dernière médiane
      smoothBPM: 0,            // BPM lissé (EMA)
      onBeat: null,            // callback optionnel (beat visuel)
    };
  }

  // ===== Helpers =====

  // Retourne l'index de bin [start, end] pour la fréquence donnée, en
  // fonction de fftSize et sampleRate. getByteFrequencyData renvoie
  // (fftSize/2) bins répartis linéairement de 0 Hz à sampleRate/2.
  function binForFreq(freq, fftSize, sampleRate) {
    var nyquist = sampleRate / 2;
    var binCount = fftSize / 2;
    return Math.max(0, Math.min(binCount - 1, Math.round(freq / nyquist * binCount)));
  }

  // Calcul de la médiane d'un tableau de nombres.
  function median(arr) {
    if (!arr || arr.length === 0) return 0;
    var sorted = arr.slice().sort(function (a, b) { return a - b; });
    var n = sorted.length;
    var mid = Math.floor(n / 2);
    return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  // clamp
  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  // source de temps monotone (ms). performance.now() peut être clamped
  // pour le fingerprinting → on garde un compteur de poll comme fallback.
  // Mais pour les intervalles inter-beat, performance.now() reste fiable
  // à la milliseconde près sur la durée (≤ 10 s).
  function now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  // ===== Boucle de détection =====

  // Extrait l'énergie de la bande bass (20-150 Hz) depuis le freqBuf.
  function computeBassEnergy(det) {
    var sr = det.analyser.context.sampleRate;
    var fft = det.analyser.fftSize;
    var binStart = binForFreq(20, fft, sr);
    var binEnd = binForFreq(150, fft, sr);
    var sum = 0;
    var n = 0;
    for (var i = binStart; i <= binEnd; i++) {
      sum += det.freqBuf[i];
      n++;
    }
    // Amplitude moyenne normalisée 0..1 (les valeurs sont 0..255).
    return n > 0 ? sum / (n * 255) : 0;
  }

  // Boucle d'échantillonnage pour une voie. Appelée par setInterval.
  function tick(deck) {
    var det = detectors[deck];
    if (!det || !det.analyser) return;
    try {
      det.analyser.getByteFrequencyData(det.freqBuf);
    } catch (e) {
      return; // AnalyserNode déconnecté → on attend
    }

    var t = now();
    var energy = computeBassEnergy(det);

    // Moyenne mobile de l'énergie (fenêtre ~2 s = ~40 échantillons à 50 ms).
    det.energyHistory.push(energy);
    if (det.energyHistory.length > 40) det.energyHistory.shift();
    var avg = 0;
    for (var i = 0; i < det.energyHistory.length; i++) avg += det.energyHistory[i];
    avg = avg / Math.max(1, det.energyHistory.length);

    // Seuil adaptatif : on exige que l'énergie courante dépasse
    // sensiblement la moyenne mobile. On ignore aussi les beats trop
    // rapprochés (anti-burst).
    var threshold = avg * ADAPTIVE_FACTOR;
    var gap = t - det.lastBeatAt;
    if (energy > threshold && energy > 0.02 && gap >= MIN_BEAT_GAP_MS) {
      det.beats.push(t);
      det.lastBeatAt = t;
      if (typeof det.onBeat === 'function') {
        try { det.onBeat(t); } catch (e) { /* ignore */ }
      }
    }

    // Nettoyage de la fenêtre glissante (~10 s).
    var cutoff = t - WINDOW_MS;
    while (det.beats.length && det.beats[0] < cutoff) det.beats.shift();
    if (det.beats.length > MAX_BEATS) det.beats.splice(0, det.beats.length - MAX_BEATS);

    // Recalcule le BPM si on a au moins 3 beats (besoin d'au moins 2
    // intervalles pour une médiane significative).
    if (det.beats.length >= 3) {
      var intervals = [];
      for (var j = 1; j < det.beats.length; j++) {
        intervals.push(det.beats[j] - det.beats[j - 1]);
      }
      var med = median(intervals);
      if (med > 0) {
        var bpm = 60000 / med;
        // Double/halving : si on capte des beats intercalés (ex: 130 BPM
        // détecté à 65 ou 260), on ramène dans la plage plausible.
        while (bpm < BPM_MIN) bpm *= 2;
        while (bpm > BPM_MAX) bpm /= 2;
        det.rawBPM = bpm;
        // Lissage EMA : évite le saut de chiffre à chaque beat. Le premier
        // BPM détecté est pris directement (smoothBPM = 0 initialement).
        if (det.smoothBPM === 0) det.smoothBPM = bpm;
        else det.smoothBPM = det.smoothBPM + BPM_EMA_ALPHA * (bpm - det.smoothBPM);
      }
    }
  }

  // ===== API =====

  // Démarrer la détection sur une voie. Requiert l'AnalyserNode de la voie,
  // récupéré via AudioEngine.getAnalyser(deck). Idempotent.
  function start(deck) {
    if (!detectors[deck]) detectors[deck] = makeDetector();
    var det = detectors[deck];
    var AudioEngine = window.AudioEngine;
    if (!AudioEngine) return;
    var analyser = AudioEngine.getAnalyser(deck);
    if (!analyser) return; // voie non initialisée (mode IFrame ou pas prête)
    det.analyser = analyser;
    if (!det.freqBuf) {
      det.freqBuf = new Uint8Array(analyser.frequencyBinCount);
    }
    if (timers[deck]) return; // déjà actif
    timers[deck] = setInterval(tick, POLL_MS, deck);
  }

  // Stopper la détection d'une voie (garde le dernier BPM connu).
  function stop(deck) {
    if (timers[deck]) {
      clearInterval(timers[deck]);
      timers[deck] = null;
    }
  }

  function startAll() { start('A'); start('B'); }
  function stopAll() { stop('A'); stop('B'); }

  function getBPM(deck) {
    var det = detectors[deck];
    return det ? Math.round(det.smoothBPM) : 0;
  }

  // BPM effectif = BPM détecté * playbackRate (tient compte du pitch).
  function getEffectiveBPM(deck) {
    var det = detectors[deck];
    if (!det || !det.smoothBPM) return 0;
    var AudioEngine = window.AudioEngine;
    if (!AudioEngine) return Math.round(det.smoothBPM);
    var rate = 1;
    try {
      var el = AudioEngine.getDeckAudioElement(deck);
      if (el && isFinite(el.playbackRate)) rate = el.playbackRate;
    } catch (e) { /* ignore */ }
    return Math.round(det.smoothBPM * rate);
  }

  // Ajuste le playbackRate de B pour matcher le BPM de A (±8 %).
  // Retourne un statut { ok, ratio, bpmA, bpmB, message }.
  function syncBtoA() {
    var AudioEngine = window.AudioEngine;
    if (!AudioEngine) {
      return { ok: false, message: 'AudioEngine indisponible.' };
    }
    var detA = detectors.A;
    var detB = detectors.B;
    var bpmA = detA ? detA.smoothBPM : 0;
    var bpmB = detB ? detB.smoothBPM : 0;
    if (!bpmA || !bpmB) {
      return { ok: false, bpmA: Math.round(bpmA), bpmB: Math.round(bpmB),
        message: 'BPM non encore détecté sur A ou B.' };
    }
    var ratio = bpmA / bpmB;
    var clamped = clamp(ratio, 1 - SYNC_LIMIT, 1 + SYNC_LIMIT);
    if (Math.abs(clamped - ratio) > 0.001) {
      // Le ratio sort de la plage ±8 % → on signale l'impossibilité.
      return { ok: false, ratio: ratio, bpmA: Math.round(bpmA), bpmB: Math.round(bpmB),
        message: 'BPM trop éloigné (' + Math.round(bpmA) + ' vs ' + Math.round(bpmB)
          + '), sync impossible au-delà de ±8%.' };
    }
    // Applique le playbackRate sur l'<audio> de B (preservesPitch déjà posé).
    var elB = AudioEngine.getDeckAudioElement('B');
    if (!elB) {
      return { ok: false, message: 'Voie B non initialisée.' };
    }
    try {
      elB.playbackRate = Math.max(0.0625, clamped);
    } catch (e) {
      return { ok: false, message: 'Impossible de régler le playbackRate de B.' };
    }
    // Reporte le pitch résultant (en %) vers le slider de l'UI si l'app
    // expose un accesseur. Sinon on laisse l'UI se resynchroniser d'elle-même.
    var pitchPct = (clamped - 1) * 100;
    if (window.YTMixerApp && typeof window.YTMixerApp.applyPitch === 'function') {
      try { window.YTMixerApp.applyPitch('B', pitchPct); } catch (e) { /* ignore */ }
    }
    return { ok: true, ratio: ratio, bpmA: Math.round(bpmA), bpmB: Math.round(bpmB),
      message: 'BPM B synchronisé sur A (' + Math.round(bpmA) + ' BPM).' };
  }

  // Réinitialise la détection d'une voie (changement de morceau).
  function reset(deck) {
    if (timers[deck]) { stop(deck); }
    if (detectors[deck]) {
      detectors[deck].beats = [];
      detectors[deck].energyHistory = [];
      detectors[deck].lastBeatAt = 0;
      detectors[deck].rawBPM = 0;
      detectors[deck].smoothBPM = 0;
    }
  }

  window.BPMDetector = {
    start: start,
    stop: stop,
    startAll: startAll,
    stopAll: stopAll,
    getBPM: getBPM,
    getEffectiveBPM: getEffectiveBPM,
    syncBtoA: syncBtoA,
    reset: reset,
    CONST: {
      POLL_MS: POLL_MS,
      BPM_MIN: BPM_MIN,
      BPM_MAX: BPM_MAX,
      SYNC_LIMIT: SYNC_LIMIT,
    },
  };
})();

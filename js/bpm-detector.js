/* bpm-detector.js — Détection BPM temps réel + beatmatch (phase 9)
 *
 * Estime le tempo de chaque voie (A / B) en analysant l'AnalyserNode du
 * moteur audio. Algorithme de détection de beats basé sur le FLUX spectral
 * de la bande bass (kick drum, 20-150 Hz) :
 *   1. Échantillonne analyser.getByteFrequencyData() à ~40 ms
 *   2. Isole les bins correspondant à 20-150 Hz (le kick drum)
 *   3. Calcule l'énergie bass courante
 *   4. Flux = max(0, énergie - énergie précédente)  (onset = hausse brusque)
 *   5. Seuil adaptatif = moyenne + k * écart-type du flux (fenêtre ~1.5 s)
 *      → un beat = flux dépassant le seuil
 *   6. Stocke les timestamps des beats dans une fenêtre glissante (~8 s)
 *   7. Calcule les intervalles inter-beat → médiane = intervalle moyen
 *   8. bpm = 60000 / intervalleMoyen, filtré dans [60..200]
 *
 * PHILOSOPHIE D'AFFICHAGE — on affiche TÔT, on stabilise ensuite.
 * Dès qu'on a quelques beats (~2-3 s), on expose un BPM « provisoire »
 * (orange, état 'estimating') calculé par médiane des intervalles — c'est
 * moins stable que verrouillé mais ça donne une valeur exploitable vite,
 * au lieu de laisser le « — » pendant de longues secondes. En arrière-plan
 * l'histogramme continue d'affiner ; quand il converge (pic net stable sur
 * LOCK_CONSEC cycles), on passe en 'locked' (vert) et la valeur se fige.
 * Le verrouillage n'écrase l'affichage que si le nouveau BPM diffère de
 * plus de UI_CHANGE_TOL % du précédent → le compteur ne clignote pas.
 *
 * beatmatch (SYNC) : ajuste audioB.playbackRate pour matcher le BPM de A.
 *   ratio = bpmA / bpmB → playbackRate = clamp(ratio, 0.92, 1.08).
 *   La préservation de la hauteur (preservesPitch) est déjà posée sur
 *   l'<audio> par audio-player.js → on change la vitesse sans changer
 *   le pitch (pas d'effet "chipmunk").
 *
 * API :
 *   BPMDetector.start(deck)         : démarre la détection sur une voie
 *   BPMDetector.stop(deck)          : stoppe la détection
 *   BPMDetector.startAll() / stopAll()
 *   BPMDetector.getBPM(deck)        : BPM détecté (number, 0 si inconnu)
 *   BPMDetector.getEffectiveBPM(deck) : BPM * playbackRate (effectif)
 *   BPMDetector.getState(deck)      : 'idle' | 'detecting' | 'estimating' | 'locked'
 *   BPMDetector.getProvisionalBPM(deck) : BPM provisoire (orange), 0 si non acquis
 *   BPMDetector.onBPMUpdate(deck)   : callback de transition d'état/valeur (UI)
 *   BPMDetector.syncBtoA()         : ajuste le pitch de B pour matcher A
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
  var POLL_MS = 40;                   // échantillonnage ~25 Hz
  var WINDOW_MS = 8000;               // fenêtre glissante des beats (~8 s)
  var BPM_MIN = 60;                   // plage plausible
  var BPM_MAX = 200;
  var MAX_BEATS = 200;                // borne anti-explosion mémoire
  // Historique du flux spectral pour le seuil adaptatif (moyenne + écart-type).
  // ~1.5 s à 40 ms → ~38 échantillons.
  var FLUX_HISTORY = 38;
  // Seuil : flux > mean + k * std. k=1.4 : sensible mais robuste au bruit.
  var STD_K = 1.4;
  // Énergie bass minimale absolue : en dessous, pas de signal exploitable.
  var MIN_BASS_ENERGY = 0.015;
  // Anti-burst : ignore un beat à < 280 ms du précédent (≈ 214 BPM max).
  var MIN_BEAT_GAP_MS = 280;
  // Tempo de sync : limite du pitch en % (cohérent avec PITCH_RANGE_PERCENT).
  var SYNC_LIMIT = 0.08;              // ±8 %

  // ----- Stabilisation de la mesure -----
  // Seuil MIN_BEATS pour EXPOSER un BPM provisoire (état 'estimating') : dès
  // qu'on a MIN_BEATS_PROVISIONAL beats accumulés (~2 s à 128 BPM), on calcule
  // un BPM provisoire par médiane des intervalles et on l'affiche (orange).
  // Plus petit que le seuil de verrouillage → valeur affichée vite.
  var MIN_BEATS_PROVISIONAL = 4;
  // Nombre minimum de beats accumulés avant d'espérer un BPM fiable pour le
  // VERROUILLAGE. À 128 BPM, ~6 beats (≈ 3 s) pour démarrer l'histogramme.
  var MIN_BEATS_FOR_ANALYSIS = 6;
  // Nombre d'intervalles voisins qu'on regroupe dans l'histogramme (en bins
  // de résolution). Plus c'est grand, plus on tolère le jitter ; plus c'est
  // petit, plus on est précis mais instable. 40 = bin de ~0.6 BPM à 128.
  var HIST_BINS = 40;
  // Un BPM est considéré « confirmé » (verrouillé) si le pic de l'histogramme
  // représente au moins HIST_DOMINANT_FRAC des intervalles totaux. 0.55 =
  // la majorité claire des intervalles converge vers la même période.
  var HIST_DOMINANT_FRAC = 0.55;
  // Pour passer de 'detecting' à 'locked', il faut LOCK_CONSEC cycles
  // consécutifs où le pic de l'histogramme reste dans la même tolérance.
  var LOCK_CONSEC = 3;
  // Tolérance de verrouillage : écart relatif entre le BPM candidat courant
  // et le précédent candidat (3 %).
  var LOCK_TOL = 0.03;
  // Une fois verrouillé, on ne bouge QUE si un nouveau pic émerge très
  // nettement (changement de tempo réel, ex: passage à 140 BPM). 0.08 = le
  // nouveau BPM doit différer de > 8 % du verrouillé pour déverrouiller.
  var RELOCK_TOL = 0.08;

  // ----- Seuil de mise à jour de l'UI -----
  // On ne rafraîchit le chiffre affiché que si le nouveau BPM diffère de plus
  // de UI_CHANGE_TOL % du dernier affiché. Évite que le compteur clignote
  // entre 127/128/129. 3 % → ~3-4 BPM de plage de tolérance à 128 BPM.
  var UI_CHANGE_TOL = 0.03;
  // Tolérance plus large pour le BPM provisoire (orange) : on accepte des
  // sauts un peu plus grands pendant la phase d'estimation (l'affinage
  // continue en arrière-plan), tout en évitant le clignotement permanent.
  var UI_CHANGE_TOL_PROVISIONAL = 0.06;

  // ===== État par voie =====
  var detectors = { A: null, B: null };
  var timers = { A: null, B: null };

  function makeDetector() {
    return {
      analyser: null,
      freqBuf: null,
      prevEnergy: 0,            // énergie bass du poll précédent (pour le flux)
      beats: [],                // timestamps (ms) des beats détectés
      lastBeatAt: 0,            // timestamp du dernier beat (anti-burst)
      fluxHistory: [],          // fenêtre glissante du flux (seuil adaptatif)
      // BPM verrouillé : la valeur stable qu'on expose à l'UI. 0 = non acquis.
      lockedBPM: 0,
      // BPM provisoire (orange, état 'estimating') : exposé tôt par médiane
      // des intervalles, avant le verrouillage. 0 = non acquis.
      provisionalBPM: 0,
      // Dernier BPM verrouillé affiché (pour la comparaison UI_CHANGE_TOL).
      displayedBPM: 0,
      // Dernier BPM provisoire affiché (comparaison UI_CHANGE_TOL_PROVISIONAL).
      displayedProvisional: 0,
      // Compteur de cycles consécutifs stables (pic d'histogramme cohérent).
      stableCount: 0,
      // Dernier BPM candidat issu de l'histogramme (pour le verrouillage).
      lastCandidate: 0,
      state: 'idle',            // 'idle' | 'detecting' | 'estimating' | 'locked'
      onBeat: null,             // callback optionnel (beat visuel)
    };
  }

  // ===== Helpers =====

  function binForFreq(freq, fftSize, sampleRate) {
    var nyquist = sampleRate / 2;
    var binCount = fftSize / 2;
    return Math.max(0, Math.min(binCount - 1, Math.round(freq / nyquist * binCount)));
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  // Ramène un BPM dans la plage [BPM_MIN..BPM_MAX] par octave (halving/
  // doubling). Borné pour éviter une boucle infinie sur une valeur pathologique.
  function foldBPM(bpm) {
    var guard = 0;
    while (bpm < BPM_MIN && guard < 4) { bpm *= 2; guard++; }
    guard = 0;
    while (bpm > BPM_MAX && guard < 4) { bpm /= 2; guard++; }
    return clamp(bpm, BPM_MIN, BPM_MAX);
  }

  // Médiane d'un tableau de nombres (copie triée). Utilisée pour le BPM
  // provisoire : plus robuste que la moyenne face aux intervalles aberrants.
  function median(arr) {
    if (!arr || !arr.length) return 0;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }

  // Callback global de transition d'état/valeur (défini par app.js). Appelé
  // quand l'état d'une voie change ou qu'une nouvelle valeur mérite un
  // rafraîchissement UI. Stocké sur l'objet public pour rester simple.
  function notifyUpdate(deck) {
    if (typeof window.BPMDetector.onBPMUpdate === 'function') {
      try { window.BPMDetector.onBPMUpdate(deck); } catch (e) { /* ignore */ }
    }
  }

  // ===== Boucle de détection =====

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
    return n > 0 ? sum / (n * 255) : 0;
  }

  function tick(deck) {
    var det = detectors[deck];
    if (!det || !det.analyser) return;
    try {
      det.analyser.getByteFrequencyData(det.freqBuf);
    } catch (e) {
      return;
    }

    var t = now();
    var energy = computeBassEnergy(det);

    // Flux spectral (onset) : hausse d'énergie par rapport à l'échantillon
    // précédent. On ne garde que les hausses (une descente n'est pas un beat).
    var flux = energy - det.prevEnergy;
    if (flux < 0) flux = 0;
    det.prevEnergy = energy;

    // Historique du flux pour le seuil adaptatif (moyenne + écart-type).
    det.fluxHistory.push(flux);
    if (det.fluxHistory.length > FLUX_HISTORY) det.fluxHistory.shift();

    var fLen = det.fluxHistory.length;
    var fSum = 0;
    for (var k = 0; k < fLen; k++) fSum += det.fluxHistory[k];
    var fMean = fSum / Math.max(1, fLen);
    var fSumSq = 0;
    for (var m = 0; m < fLen; m++) { var d = det.fluxHistory[m] - fMean; fSumSq += d * d; }
    var fStd = Math.sqrt(fSumSq / Math.max(1, fLen));
    var threshold = fMean + STD_K * fStd;

    var gap = t - det.lastBeatAt;
    if (flux > threshold && energy > MIN_BASS_ENERGY && gap >= MIN_BEAT_GAP_MS) {
      det.beats.push(t);
      det.lastBeatAt = t;
      if (typeof det.onBeat === 'function') {
        try { det.onBeat(t); } catch (e) { /* ignore */ }
      }
    }

    // Nettoyage de la fenêtre glissante (~8 s).
    var cutoff = t - WINDOW_MS;
    while (det.beats.length && det.beats[0] < cutoff) det.beats.shift();
    if (det.beats.length > MAX_BEATS) det.beats.splice(0, det.beats.length - MAX_BEATS);

    // ----- BPM provisoire (orange) : exposé tôt, avant le verrouillage -----
    // Dès qu'on a MIN_BEATS_PROVISIONAL beats (~2 s), on calcule un BPM
    // provisoire par médiane des intervalles inter-beat. C'est moins stable
    // que le verrouillage mais ça donne une valeur à l'UI au lieu du « — ».
    // On recalcule à chaque tick → l'affinage continue en arrière-plan.
    if (det.beats.length >= MIN_BEATS_PROVISIONAL && det.state !== 'locked') {
      var provIntervals = [];
      for (var pi = 1; pi < det.beats.length; pi++) {
        provIntervals.push(det.beats[pi] - det.beats[pi - 1]);
      }
      if (provIntervals.length >= 2) {
        var medItv = median(provIntervals);
        if (medItv > 0) {
          var prov = Math.round(foldBPM(60000 / medItv));
          // On pousse la valeur provisoire seulement si elle a suffisamment
          // bougé (UI_CHANGE_TOL_PROVISIONAL) pour limiter le clignotement,
          // mais on notifie l'UI à chaque transition d'état.
          var changed = det.displayedProvisional === 0
            || Math.abs(prov - det.displayedProvisional) / Math.max(1, det.displayedProvisional) > UI_CHANGE_TOL_PROVISIONAL;
          if (prov !== det.provisionalBPM || changed) {
            det.provisionalBPM = prov;
            det.displayedProvisional = prov;
          }
          if (det.state === 'detecting') {
            det.state = 'estimating';
            notifyUpdate(deck);
          }
        }
      }
    }

    // ----- Analyse d'histogramme : cherche un BPM dominant et stable -----
    // On ne calcule le verrouillage que si on a assez de beats. Pendant la
    // phase d'acquisition, l'UI affiche le BPM provisoire (si acquis) en
    // orange — pas de « — » qui persiste.
    if (det.beats.length < MIN_BEATS_FOR_ANALYSIS) {
      if (det.state === 'idle' || (det.state === 'detecting' && det.provisionalBPM === 0)) {
        det.state = 'detecting';
      }
      return;
    }

    // Calcule les intervalles inter-beat.
    var beats = det.beats;
    var intervals = [];
    for (var j = 1; j < beats.length; j++) {
      intervals.push(beats[j] - beats[j - 1]);
    }
    if (intervals.length < 2) return;

    // Histogramme des BPM : on convertit chaque intervalle en BPM, on plie dans
    // la plage plausible, puis on l'accumule dans un bin. Le pic du code représente
    // la période dominante → beaucoup plus stable que la médiane brute (qui saute
    // dès qu'un beat est manqué ou intercalé).
    var bins = new Array(HIST_BINS);
    for (var b = 0; b < HIST_BINS; b++) bins[b] = 0;
    for (var p = 0; p < intervals.length; p++) {
      var itv = intervals[p];
      if (itv <= 0) continue;
      var bpm = foldBPM(60000 / itv);
      var binIdx = Math.floor((bpm - BPM_MIN) / (BPM_MAX - BPM_MIN) * HIST_BINS);
      if (binIdx < 0) binIdx = 0;
      if (binIdx >= HIST_BINS) binIdx = HIST_BINS - 1;
      bins[binIdx]++;
    }

    // Trouve le bin dominant.
    var bestBin = 0, bestCount = 0;
    for (var c = 0; c < HIST_BINS; c++) {
      if (bins[c] > bestCount) { bestCount = bins[c]; bestBin = c; }
    }
    var total = intervals.length;
    var frac = total > 0 ? bestCount / total : 0;
    // BPM central du bin dominant.
    var candidateBPM = BPM_MIN + (bestBin + 0.5) / HIST_BINS * (BPM_MAX - BPM_MIN);

    // ----- Verrouillage -----
    // Pour passer en 'locked', il faut que le pic de l'histogramme soit net
    // (≥ HIST_DOMINANT_FRAC des intervalles) ET stable sur LOCK_CONSEC cycles.
    if (det.state !== 'locked') {
      if (frac >= HIST_DOMINANT_FRAC) {
        if (det.lastCandidate > 0 && Math.abs(candidateBPM - det.lastCandidate) / det.lastCandidate < LOCK_TOL) {
          det.stableCount++;
        } else {
          det.stableCount = 1;
        }
        det.lastCandidate = candidateBPM;
        if (det.stableCount >= LOCK_CONSEC) {
          det.lockedBPM = Math.round(candidateBPM);
          det.state = 'locked';
          det.displayedBPM = 0; // force le prochain rafraîchissement UI (vert)
          notifyUpdate(deck);
        } else if (det.state !== 'estimating') {
          // Pas encore verrouillé mais on a un candidat : on reste en
          // 'estimating' (provisoire orange) tant qu'on accumule la preuve.
          det.state = 'estimating';
        }
      } else {
        // Pas de pic net : on reste en estimation si on a un provisoire,
        // sinon en détection pure. On ne verrouille pas.
        det.stableCount = 0;
        det.lastCandidate = candidateBPM;
        if (det.provisionalBPM > 0 && det.state !== 'estimating') {
          det.state = 'estimating';
        } else if (det.provisionalBPM === 0) {
          det.state = 'detecting';
        }
      }
    } else {
      // Déjà verrouillé : on ne déverrouille QUE si un nouveau BPM émerge très
      // nettement (changement de tempo réel, ex: passage à 140 BPM). Sinon on
      // garde le BPM verrouillé stable → l'UI ne bouge pas.
      if (frac >= HIST_DOMINANT_FRAC
          && Math.abs(candidateBPM - det.lockedBPM) / det.lockedBPM > RELOCK_TOL) {
        // Changement de tempo significatif : on reprend une phase de
        // détection courte pour confirmer le nouveau tempo avant de l'afficher.
        det.lockedBPM = 0;
        det.stableCount = 0;
        det.state = det.provisionalBPM > 0 ? 'estimating' : 'detecting';
        notifyUpdate(deck);
      }
      // Sinon : on reste verrouillé sur l'ancien BPM (stable).
    }
  }

  // ===== API =====

  function start(deck) {
    if (!detectors[deck]) detectors[deck] = makeDetector();
    var det = detectors[deck];
    var AudioEngine = window.AudioEngine;
    if (!AudioEngine) return;
    var analyser = AudioEngine.getAnalyser(deck);
    if (!analyser) return;
    det.analyser = analyser;
    if (!det.freqBuf) {
      det.freqBuf = new Uint8Array(analyser.frequencyBinCount);
    }
    if (timers[deck]) return;
    timers[deck] = setInterval(tick, POLL_MS, deck);
  }

  function stop(deck) {
    if (timers[deck]) {
      clearInterval(timers[deck]);
      timers[deck] = null;
    }
  }

  function startAll() { start('A'); start('B'); }
  function stopAll() { stop('A'); stop('B'); }

  // Retourne le BPM verrouillé (0 si non acquis).
  function getBPM(deck) {
    var det = detectors[deck];
    return det ? det.lockedBPM : 0;
  }

  // BPM provisoire (orange, état 'estimating'). Exposé tôt, avant le
  // verrouillage. 0 si non acquis. C'est la valeur qu'affiche l'UI pendant
  // la phase d'estimation.
  function getProvisionalBPM(deck) {
    var det = detectors[deck];
    return det ? det.provisionalBPM : 0;
  }

  // BPM effectif = BPM verrouillé * playbackRate (tient compte du pitch).
  function getEffectiveBPM(deck) {
    var det = detectors[deck];
    if (!det || !det.lockedBPM) return 0;
    var AudioEngine = window.AudioEngine;
    if (!AudioEngine) return det.lockedBPM;
    var rate = 1;
    try {
      var el = AudioEngine.getDeckAudioElement(deck);
      if (el && isFinite(el.playbackRate)) rate = el.playbackRate;
    } catch (e) { /* ignore */ }
    return Math.round(det.lockedBPM * rate);
  }

  function getState(deck) {
    var det = detectors[deck];
    return det ? det.state : 'idle';
  }

  // Indique si le BPM effectif a changé depuis le dernier appel → l'UI ne
  // met à jour le badge que si vrai. Comparaison à UI_CHANGE_TOL % de tolérance.
  // Retourne null si pas de changement (l'UI garde sa valeur affichée).
  function getEffectiveBPMIfChanged(deck) {
    var det = detectors[deck];
    if (!det || !det.lockedBPM) return null;
    var eff = getEffectiveBPM(deck);
    if (det.displayedBPM === 0) {
      det.displayedBPM = eff;
      return eff;
    }
    if (Math.abs(eff - det.displayedBPM) / det.displayedBPM > UI_CHANGE_TOL) {
      det.displayedBPM = eff;
      return eff;
    }
    return null;
  }

  function syncBtoA() {
    var AudioEngine = window.AudioEngine;
    if (!AudioEngine) {
      return { ok: false, message: 'AudioEngine indisponible.' };
    }
    var detA = detectors.A;
    var detB = detectors.B;
    var bpmA = detA ? detA.lockedBPM : 0;
    var bpmB = detB ? detB.lockedBPM : 0;
    if (!bpmA || !bpmB) {
      return { ok: false, bpmA: bpmA, bpmB: bpmB,
        message: 'BPM non encore confirmé sur A ou B (laisser tourner quelques secondes).' };
    }
    var ratio = bpmA / bpmB;
    var clamped = clamp(ratio, 1 - SYNC_LIMIT, 1 + SYNC_LIMIT);
    if (Math.abs(clamped - ratio) > 0.001) {
      return { ok: false, ratio: ratio, bpmA: bpmA, bpmB: bpmB,
        message: 'BPM trop éloigné (' + bpmA + ' vs ' + bpmB + '), sync impossible au-delà de ±8%.' };
    }
    var elB = AudioEngine.getDeckAudioElement('B');
    if (!elB) {
      return { ok: false, message: 'Voie B non initialisée.' };
    }
    try {
      elB.playbackRate = Math.max(0.0625, clamped);
    } catch (e) {
      return { ok: false, message: 'Impossible de régler le playbackRate de B.' };
    }
    var pitchPct = (clamped - 1) * 100;
    if (window.YTMixerApp && typeof window.YTMixerApp.applyPitch === 'function') {
      try { window.YTMixerApp.applyPitch('B', pitchPct); } catch (e) { /* ignore */ }
    }
    // Après un sync, le BPM effectif de B change (nouveau playbackRate) → on
    // force le prochain getEffectiveBPMIfChanged à renvoyer la valeur.
    if (detB) detB.displayedBPM = 0;
    return { ok: true, ratio: ratio, bpmA: bpmA, bpmB: bpmB,
      message: 'BPM B synchronisé sur A (' + bpmA + ' BPM).' };
  }

  function reset(deck) {
    if (timers[deck]) { stop(deck); }
    if (detectors[deck]) {
      var keepBuf = detectors[deck].freqBuf;
      var keepAnalyser = detectors[deck].analyser;
      detectors[deck] = makeDetector();
      detectors[deck].freqBuf = keepBuf;
      detectors[deck].analyser = keepAnalyser;
    }
  }

  window.BPMDetector = {
    start: start,
    stop: stop,
    startAll: startAll,
    stopAll: stopAll,
    getBPM: getBPM,
    getProvisionalBPM: getProvisionalBPM,
    getEffectiveBPM: getEffectiveBPM,
    getEffectiveBPMIfChanged: getEffectiveBPMIfChanged,
    getState: getState,
    syncBtoA: syncBtoA,
    reset: reset,
    onBPMUpdate: null,        // callback(deck) — défini par app.js
    CONST: {
      POLL_MS: POLL_MS,
      BPM_MIN: BPM_MIN,
      BPM_MAX: BPM_MAX,
      SYNC_LIMIT: SYNC_LIMIT,
      UI_CHANGE_TOL: UI_CHANGE_TOL,
      UI_CHANGE_TOL_PROVISIONAL: UI_CHANGE_TOL_PROVISIONAL,
      MIN_BEATS_PROVISIONAL: MIN_BEATS_PROVISIONAL,
    },
  };
})();

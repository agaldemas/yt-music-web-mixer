/* mixer.js — crossfader A↔B + contrôles de transport
 *
 * Volume calculé en equal-power : vA = cos(p·π/2), vB = sin(p·π/2)
 * Le master volume s'applique multiplicativement.
 *
 * Mode dual :
 *   - 'iframe' : crossfade via player.setVolume(), avec ramping par paliers
 *                via setInterval (comportement historique).
 *   - 'piped'  : crossfade via AudioEngine.applyCrossfade() (GainNode du
 *                moteur Web Audio). Le ramping par paliers devient obsolète :
 *                la fluidité est gérée nativement par GainNode.setTargetAtTime
 *                (timeConstant=0.015s). On applique donc directement la cible
 *                du slider, le GainNode interpole en interne.
 *
 * Le sync continu utilise un seuil plus serré en mode Piped (0.2s vs 0.5s
 * en IFrame) car les éléments <audio> HTML5 sont synchronisés par l'horloge
 * du navigateur, donc le drift résiduel est plus faible.
 */

(function () {
  var players = null; // { A: wrapper, B: wrapper }
  var mode = 'iframe'; // 'piped' | 'iframe' — défaut = IFrame (avant détection)
  var crossfade = 50; // 0 = full A, 100 = full B (cible affichée)
  var appliedCrossfade = 50; // valeur réellement appliquée aux lecteurs
  var master = 100; // 0-100
  var syncHandle = null; // setInterval pour sync continu
  var stepHandle = null; // setInterval pour crossfade progressif (IFrame only)
  var stepPercent = 100; // palier en % (>= 100 = instantané)
  var stepIntervalMs = 0; // intervalle en ms (<= 0 = instantané)
  var autoXf = false; // tâche 18 : crossfade progressif armé (case « Auto XF »)
                     // true → tout déplacement du slider atteint sa cible par
                     // paliers (palier + intervalle config), même en mode Piped.

  // Seuils de sync continu selon le mode (Piped = plus précis)
  var SYNC_DRIFT_THRESHOLD_PIPED = 0.2; // s
  var SYNC_DRIFT_THRESHOLD_IFRAME = 0.5; // s

  // Equal-power : évite le creux de niveau au centre du crossfade.
  // Calcule les volumes à partir de la valeur *appliquée* (qui peut être
  // intermédiaire lors d'un crossfade progressif par paliers).
  function calcVolumes() {
    var p = appliedCrossfade / 100;
    var m = master / 100;
    return {
      a: Math.cos(p * Math.PI / 2) * 100 * m,
      b: Math.sin(p * Math.PI / 2) * 100 * m,
    };
  }

  // Recalcule et applique les volumes aux deux lecteurs.
  // Selon le mode, route vers AudioEngine (Piped, GainNode, ramping fluide)
  // ou vers les players IFrame (setVolume, paliers manuels).
  function applyVolumes() {
    if (mode === 'piped') {
      var AE = window.AudioEngine;
      if (!AE) return; // AudioEngine pas chargé → fallback silencieux
      // Mode Piped : le crossfade est géré par GainNode.setTargetAtTime
      // (transition fluide en interne). Quand le crossfade progressif est
      // armé (autoXf), appliedCrossfade progresse par paliers — c'est cette
      // valeur intermédiaire que l'on pousse au graphe, pas la cible finale.
      AE.applyCrossfade(appliedCrossfade / 100);
      AE.applyMasterVolume(master);
      return;
    }
    // Mode IFrame : comportement historique (setVolume + paliers).
    var v = calcVolumes();
    if (players && players.A) players.A.setVolume(v.a);
    if (players && players.B) players.B.setVolume(v.b);
  }

  // Arrête l'éventuel crossfade progressif en cours (IFrame only)
  function stopStepping() {
    if (stepHandle) {
      clearInterval(stepHandle);
      stepHandle = null;
    }
  }

  // Définit les paramètres de crossfade progressif (depuis app.js / settings)
  // En mode Piped, ces paramètres sont ignorés : le ramping natif
  // (setTargetAtTime) gère la fluidité.
  function setStepOptions(percent, intervalMs) {
    stepPercent = Math.max(1, Math.min(100, parseInt(percent, 10) || 100));
    stepIntervalMs = Math.max(0, parseInt(intervalMs, 10) || 0);
    // Si on retombe en mode instantané, on applique tout de suite la cible
    if (stepPercent >= 100 || stepIntervalMs <= 0) {
      stopStepping();
      appliedCrossfade = crossfade;
      applyVolumes();
    }
  }

  // Arme / désarme le crossfade progressif (tâche 18, case « Auto XF »).
  //   - true  → tout déplacement du slider crossfade atteint sa cible par
  //             paliers (palier + intervalle config), y compris en mode Piped.
  //   - false → comportement standard (Piped : saut direct à la cible ;
  //             IFrame : paliers seulement si réglé dans les Paramètres).
  // Quand on désarme pendant un ramp-up en cours, on atteint immédiatement
  // la cible (pas d'état intermédiaire bloqué).
  function setAutoXf(enabled) {
    autoXf = !!enabled;
    if (!autoXf) {
      stopStepping();
      appliedCrossfade = crossfade;
      applyVolumes();
    }
  }

  function isAutoXf() {
    return autoXf;
  }

  // Lance le crossfade progressif de appliedCrossfade vers crossfade par paliers.
  //
  // Règles d'application de la cible du slider :
  //   - Si le crossfade progressif est ARMÉ (autoXf = true, case « Auto XF »
  //     cochée) : la cible est atteinte par paliers (stepPercent / stepIntervalMs)
  //     dans les DEUX modes (Piped + IFrame).
  //   - Si désarmé :
  //       · Mode Piped : saut direct à la cible (le ramping fluide est géré
  //         nativement par GainNode.setTargetAtTime → pas de paliers manuels).
  //       · Mode IFrame : comportement historique par paliers SI stepPercent < 100
  //         ET stepIntervalMs > 0 (réglage « crossfade progressif » des
  //         Paramètres), sinon saut direct.
  //   - Toujours : palier >= 100 ou intervalle <= 0 → instantané.
  // Saut direct à la cible du slider (pas de paliers).
  function jumpToTarget() {
    stopStepping();
    appliedCrossfade = crossfade;
    applyVolumes();
  }

  // Ramp-up par paliers de appliedCrossfade vers crossfade.
  // Un seul setInterval partagé : le corps est identique que le ramp-up soit
  // déclenché par « Auto XF » (armé) ou par le réglage historique IFrame.
  function startStepping() {
    stopStepping();
    stepHandle = setInterval(function () {
      var delta = crossfade - appliedCrossfade;
      if (Math.abs(delta) <= stepPercent) {
        // Dernier palier : on atteint la cible exacte
        appliedCrossfade = crossfade;
        applyVolumes();
        stopStepping();
        return;
      }
      // Avance vers la cible par incrément signé
      appliedCrossfade += (delta > 0 ? stepPercent : -stepPercent);
      applyVolumes();
    }, stepIntervalMs);
  }

  // Règles d'application de la cible du slider :
  //   - Si le crossfade progressif est ARMÉ (autoXf = true, case « Auto XF »
  //     cochée) : la cible est atteinte par paliers (stepPercent / stepIntervalMs)
  //     dans les DEUX modes (Piped + IFrame).
  //   - Si désarmé :
  //       · Mode Piped : saut direct à la cible (le ramping fluide est géré
  //         nativement par GainNode.setTargetAtTime → pas de paliers manuels).
  //       · Mode IFrame : comportement historique par paliers SI stepPercent < 100
  //         ET stepIntervalMs > 0 (réglage « crossfade progressif » des
  //         Paramètres), sinon saut direct.
  //   - Toujours : palier >= 100 ou intervalle <= 0 → instantané.
  function stepTowardsTarget() {
    var stepping = stepPercent < 100 && stepIntervalMs > 0;
    if (autoXf) {
      // Crossfade progressif armé : ramp-up par paliers, même en mode Piped.
      if (stepping) startStepping();
      else jumpToTarget();
      return;
    }
    if (mode === 'piped') {
      // En Piped, setTargetAtTime fait la transition fluide en interne.
      // On pousse directement la cible sans paliers.
      jumpToTarget();
      return;
    }
    // Mode IFrame : paliers historiques si réglés, sinon saut direct.
    if (stepping) startStepping();
    else jumpToTarget();
  }

  // Sync ponctuel : B se cale sur la position de A
  function syncBtoA() {
    if (!players || !players.A || !players.B) return;
    var t = players.A.getCurrentTime();
    players.B.seekTo(t);
    if (players.A.getPlayerState() === 1) { // PLAYING
      players.B.playVideo();
    }
  }

  // Sync continu : vérifie le drift périodiquement, re-seek si > seuil.
  // Seuil adaptatif selon le mode (Piped = 0.2s, IFrame = 0.5s).
  function toggleContinuousSync(btn) {
    if (syncHandle) {
      clearInterval(syncHandle);
      syncHandle = null;
      btn.setAttribute('aria-pressed', 'false');
      btn.textContent = '🔁 Sync continu: OFF';
    } else {
      syncHandle = setInterval(function () {
        if (!players || !players.A || !players.B) return;
        var threshold = (mode === 'piped')
          ? SYNC_DRIFT_THRESHOLD_PIPED
          : SYNC_DRIFT_THRESHOLD_IFRAME;
        var tA = players.A.getCurrentTime();
        var tB = players.B.getCurrentTime();
        if (Math.abs(tA - tB) > threshold) {
          players.B.seekTo(tA);
        }
      }, 1000);
      btn.setAttribute('aria-pressed', 'true');
      btn.textContent = '🔁 Sync continu: ON';
    }
  }

  // ===== Mode dual (Piped / IFrame) =====

  // Active le mode de crossfade. Doit être appelé AVANT applyVolumes()
  // pour prendre effet. Re-applique immédiatement les volumes après
  // changement pour respecter l'état UI (crossfade + master).
  //
  // Modes :
  //   'iframe' : IFrame YouTube (volume-only, paliers manuels)
  //   'piped'  : Piped Audio (Web Audio GainNode, ramping natif)
  function setMode(newMode) {
    if (newMode !== 'piped' && newMode !== 'iframe') return;
    if (newMode === mode) return;
    mode = newMode;
    // À chaque changement de mode, on arrête le palier IFrame en cours
    // et on applique immédiatement la cible au nouveau système.
    stopStepping();
    appliedCrossfade = crossfade;
    applyVolumes();
  }

  function getMode() {
    return mode;
  }

  function isPipedMode() {
    return mode === 'piped';
  }

  // Câble tous les contrôles de la barre de mixage
  function wireUI() {
    var xf = document.getElementById('crossfade');
    var xfValA = document.getElementById('xf-value-a');
    var xfValB = document.getElementById('xf-value-b');
    var mv = document.getElementById('master-volume');
    var mvVal = document.getElementById('master-value');
    var playBoth = document.getElementById('play-both');
    var pauseBoth = document.getElementById('pause-both');
    var syncBtn = document.getElementById('sync-ba');
    var resyncBtn = document.getElementById('resync-toggle');

    if (xf) {
      xf.addEventListener('input', function () {
        crossfade = parseInt(xf.value, 10);
        // Affichage toujours synchronisé avec la cible
        if (xfValA) xfValA.textContent = 100 - crossfade;
        if (xfValB) xfValB.textContent = crossfade;
        // Atteinte de la cible par paliers (ou instantanée selon réglages)
        stepTowardsTarget();
      });
    }

    if (mv) {
      mv.addEventListener('input', function () {
        master = parseInt(mv.value, 10);
        if (mvVal) mvVal.textContent = master;
        applyVolumes();
      });
    }

    if (playBoth) {
      playBoth.addEventListener('click', function () {
        if (players && players.A) players.A.playVideo();
        if (players && players.B) players.B.playVideo();
      });
    }

    if (pauseBoth) {
      pauseBoth.addEventListener('click', function () {
        if (players && players.A) players.A.pauseVideo();
        if (players && players.B) players.B.pauseVideo();
      });
    }

    if (syncBtn) syncBtn.addEventListener('click', syncBtoA);

    if (resyncBtn) {
      resyncBtn.addEventListener('click', function () {
        toggleContinuousSync(resyncBtn);
      });
    }
  }

  function init(p) {
    players = p;
    wireUI();
    appliedCrossfade = crossfade;
    applyVolumes();
  }

  window.YTMixer = {
    init: init,
    applyVolumes: applyVolumes,
    setStepOptions: setStepOptions,
    setAutoXf: setAutoXf,
    isAutoXf: isAutoXf,
    setMode: setMode,
    getMode: getMode,
    isPipedMode: isPipedMode,
    syncBtoA: syncBtoA,
    // toggleContinuousSync : non exporté — câblé en interne par wireUI()
    // sur le bouton #resync-toggle.
    // Constantes exportées (debug / tests)
    CONST: {
      SYNC_DRIFT_THRESHOLD_PIPED: SYNC_DRIFT_THRESHOLD_PIPED,
      SYNC_DRIFT_THRESHOLD_IFRAME: SYNC_DRIFT_THRESHOLD_IFRAME,
    },
  };
})();
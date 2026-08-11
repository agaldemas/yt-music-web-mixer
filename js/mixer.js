/* mixer.js — crossfader A↔B + contrôles de transport
 *
 * Volume calculé en equal-power : vA = cos(p·π/2), vB = sin(p·π/2)
 * Le master volume s'applique multiplicativement.
 * Le sync continu n'est jamais parfait (drift 200-500ms normal).
 */
(function () {
  var players = null; // { A: wrapper, B: wrapper }
  var crossfade = 50; // 0 = full A, 100 = full B
  var master = 100; // 0-100
  var syncHandle = null; // setInterval pour sync continu

  // Equal-power : évite le creux de niveau au centre du crossfade
  function calcVolumes() {
    var p = crossfade / 100;
    var m = master / 100;
    return {
      a: Math.cos(p * Math.PI / 2) * 100 * m,
      b: Math.sin(p * Math.PI / 2) * 100 * m,
    };
  }

  // Recalcule et applique les volumes aux deux lecteurs
  function applyVolumes() {
    var v = calcVolumes();
    if (players && players.A) players.A.setVolume(v.a);
    if (players && players.B) players.B.setVolume(v.b);
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

  // Sync continu : vérifie le drift toutes les ~1s, re-seek si > 0.5s
  function toggleContinuousSync(btn) {
    if (syncHandle) {
      clearInterval(syncHandle);
      syncHandle = null;
      btn.setAttribute('aria-pressed', 'false');
      btn.textContent = '🔁 Sync continu: OFF';
    } else {
      syncHandle = setInterval(function () {
        if (!players || !players.A || !players.B) return;
        var tA = players.A.getCurrentTime();
        var tB = players.B.getCurrentTime();
        if (Math.abs(tA - tB) > 0.5) {
          players.B.seekTo(tA);
        }
      }, 1000);
      btn.setAttribute('aria-pressed', 'true');
      btn.textContent = '🔁 Sync continu: ON';
    }
  }

  // Câble tous les contrôles de la barre de mixage
  function wireUI() {
    var xf = document.getElementById('crossfade');
    var xfVal = document.getElementById('xf-value');
    var mv = document.getElementById('master-volume');
    var mvVal = document.getElementById('master-value');
    var playBoth = document.getElementById('play-both');
    var pauseBoth = document.getElementById('pause-both');
    var syncBtn = document.getElementById('sync-ba');
    var resyncBtn = document.getElementById('resync-toggle');

    if (xf) {
      xf.addEventListener('input', function () {
        crossfade = parseInt(xf.value, 10);
        if (xfVal) xfVal.textContent = crossfade;
        applyVolumes();
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
    applyVolumes();
  }

  window.YTMixer = {
    init: init,
    applyVolumes: applyVolumes,
  };
})();

/* deck-controls.js — UI de transport par voie (lecture/pause, seek, temps,
 * now-playing) pour le mode Piped Audio ET le mode IFrame.
 *
 * Pourquoi ce module : en mode Piped, l'élément <audio> est invisible
 * (display:none, pas de controls natifs). Il n'y a donc AUCUN chrome de
 * lecteur — l'utilisateur ne peut ni voir la progression ni reprendre/mettre
 * en pause. Ce module fournit une UI de transport commune aux deux modes,
 * pilotée par l'interface unifiée du lecteur (playVideo/pauseVideo/seekTo,
 * getCurrentTime/getDuration/getPlayerState).
 *
 * API :
 *   DeckTransport.bind(deck, { getPlayer, getReady })
 *     Rattache les éléments DOM du deck (cherchés via [data-deck="<deck>"]),
 *     câble le bouton play/pause + le slider de seek, et stocke les accesseurs.
 *       - getPlayer() : retourne le wrapper lecteur courant (Piped ou IFrame),
 *                       ou null. Comme le wrapper change à chaque bascule de
 *                       mode, on lit toujours l'accesseur plutôt que la valeur.
 *       - getReady()  : true si le lecteur courant est prêt à jouer.
 *   DeckTransport.onStateChange(deck, state)
 *     Notifié par app.js à chaque transition d'état (PLAYING/PAUSED/…).
 *     Met à jour l'icône play/pause + le spinner de buffering immédiatement.
 *   DeckTransport.setNowPlaying(deck, info)
 *     Affiche les métadonnées du morceau courant : { title, uploader,
 *     thumbnailUrl, modeLabel }. Cache le bloc si info est null.
 *   DeckTransport.start()
 *     Lance la boucle de rafraîchissement (requestAnimationFrame throttlé à
 *     ~7 Hz) qui met à jour la barre de seek + les temps, sauf pendant que
 *     l'utilisateur fait glisser le curseur.
 *
 * Conventions : IIFE, vanilla JS, camelCase, window.DeckTransport exposé.
 */

(function () {
  // États unifiés (mêmes valeurs que YTWrapper.STATE / AudioPlayer.STATE).
  var STATE = (window.YTWrapper && window.YTWrapper.STATE) || {
    UNSTARTED: -1,
    ENDED: 0,
    PLAYING: 1,
    PAUSED: 2,
    BUFFERING: 3,
    CUED: 5,
  };

  var POLL_MS = 140;            // ~7 Hz : fluide pour la seek bar sans lourdeur
  var controllers = { A: null, B: null };
  var rafId = null;

  // Formate des secondes en "M:SS" ou "H:MM:SS".
  function fmtTime(sec) {
    var s = Number(sec);
    if (!isFinite(s) || s < 0) s = 0;
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec2 = Math.floor(s % 60);
    var mm = (h > 0 ? String(m).padStart(2, '0') : String(m));
    var ss = String(sec2).padStart(2, '0');
    return h > 0 ? (h + ':' + mm + ':' + ss) : (mm + ':' + ss);
  }

  function $(sel, deck) {
    return document.querySelector(sel + '[data-deck="' + deck + '"]');
  }

  // Rattache les éléments + écouteurs pour un deck.
  function bind(deck, opts) {
    opts = opts || {};
    var getPlayer = opts.getPlayer || function () { return null; };
    var getReady = opts.getReady || function () { return false; };

    var root = $('.deck-transport', deck);
    var playBtn = root ? root.querySelector('.dt-play') : null;
    var seek = root ? root.querySelector('.dt-seek') : null;
    var currentEl = root ? root.querySelector('.dt-current') : null;
    var durationEl = root ? root.querySelector('.dt-duration') : null;
    var iconEl = playBtn ? playBtn.querySelector('.dt-icon') : null;

    var npRoot = $('.deck-nowplaying', deck);
    var npThumb = npRoot ? npRoot.querySelector('.np-thumb') : null;
    var npTitle = npRoot ? npRoot.querySelector('.np-title') : null;
    var npMeta = npRoot ? npRoot.querySelector('.np-meta') : null;

    var c = {
      deck: deck,
      getPlayer: getPlayer,
      getReady: getReady,
      els: {
        root: root, playBtn: playBtn, seek: seek,
        currentEl: currentEl, durationEl: durationEl, iconEl: iconEl,
        npRoot: npRoot, npThumb: npThumb, npTitle: npTitle, npMeta: npMeta,
      },
      dragging: false,    // vrai pendant que l'utilisateur glisse le curseur
      lastState: STATE.UNSTARTED,
    };
    controllers[deck] = c;

    // --- Bouton play / pause ---
    if (playBtn) {
      playBtn.addEventListener('click', function () {
        var p = getPlayer();
        if (!p || !getReady()) return;
        var st = (typeof p.getPlayerState === 'function') ? p.getPlayerState() : STATE.UNSTARTED;
        if (st === STATE.PLAYING) {
          if (typeof p.pauseVideo === 'function') p.pauseVideo();
        } else {
          if (typeof p.playVideo === 'function') p.playVideo();
        }
      });
    }

    // --- Slider de seek ---
    // 'input' = glisser en cours (on prévisualise le temps sans appliquer),
    // 'change' = relâchement (on applique le seek). On ignore les mises à jour
    // automatiques de la valeur tant que l'utilisateur glisse (sinon le curseur
    // saute sous son doigt).
    if (seek) {
      seek.addEventListener('input', function () {
        c.dragging = true;
        var val = Number(seek.value) || 0;
        if (currentEl) currentEl.textContent = fmtTime(val);
      });
      seek.addEventListener('change', function () {
        var val = Number(seek.value) || 0;
        var p = getPlayer();
        if (p && getReady() && typeof p.seekTo === 'function') {
          p.seekTo(val);
        }
        // On relâche après un court délai pour laisser le seek s'appliquer
        // (sinon la loop remet la vieille position avant que currentTime ait bougé).
        setTimeout(function () { c.dragging = false; }, 220);
      });
      // Sécurité : si l'utilisateur quitte le slider en glissant (blur), on débloque.
      seek.addEventListener('blur', function () { c.dragging = false; });
    }

    // Initialise l'icône.
    renderState(c);
  }

  // Met à jour l'icône play/pause + le spinner selon l'état.
  function renderState(c) {
    if (!c.els.iconEl) return;
    var icon = '▶';            // lecture (click = play)
    var buffering = false;
    if (c.lastState === STATE.PLAYING) { icon = '⏸'; }         // click = pause
    else if (c.lastState === STATE.BUFFERING) { buffering = true; icon = '⏸'; }
    else if (c.lastState === STATE.ENDED) { icon = '↻'; }      // click = replay
    c.els.iconEl.textContent = icon;
    if (c.els.root) c.els.root.classList.toggle('is-buffering', buffering);
  }

  // Notifié par app.js à chaque changement d'état du lecteur.
  function onStateChange(deck, st) {
    var c = controllers[deck];
    if (!c) return;
    c.lastState = (typeof st === 'number') ? st : STATE.UNSTARTED;
    renderState(c);
  }

  // Affiche / cache le bloc now-playing.
  function setNowPlaying(deck, info) {
    var c = controllers[deck];
    if (!c || !c.els.npRoot) return;
    if (!info) {
      c.els.npRoot.hidden = true;
      return;
    }
    c.els.npRoot.hidden = false;
    if (c.els.npThumb) {
      if (info.thumbnailUrl) {
        c.els.npThumb.src = info.thumbnailUrl;
        c.els.npThumb.hidden = false;
      } else {
        c.els.npThumb.hidden = true;
      }
    }
    if (c.els.npTitle) c.els.npTitle.textContent = info.title || '—';
    if (c.els.npMeta) c.els.npMeta.textContent = [info.uploader, info.modeLabel].filter(Boolean).join(' · ');
  }

  // Met à jour la seek bar + les temps d'un deck (appelé par la loop).
  function tickDeck(c) {
    var p = c.getPlayer();
    if (!p || !c.getReady()) return;
    var dur = (typeof p.getDuration === 'function') ? p.getDuration() : 0;
    var cur = (typeof p.getCurrentTime === 'function') ? p.getCurrentTime() : 0;
    if (!isFinite(dur) || dur <= 0) dur = 0;
    if (!isFinite(cur) || cur < 0) cur = 0;
    if (cur > dur) cur = dur;

    if (c.els.durationEl) c.els.durationEl.textContent = fmtTime(dur);
    if (c.els.currentEl && !c.dragging) c.els.currentEl.textContent = fmtTime(cur);

    if (c.els.seek && !c.dragging) {
      // Ajuste le max quand la durée devient connue (ou change).
      var maxAttr = Number(c.els.seek.max) || 0;
      if (Math.abs(maxAttr - dur) > 0.5) c.els.seek.max = dur || 0;
      c.els.seek.value = cur;
    }
  }

  // Boucle de rafraîchissement unique pour les deux decks, throttlée.
  function start() {
    if (rafId) return;
    var last = 0;
    function loop(t) {
      rafId = requestAnimationFrame(loop);
      if (t - last < POLL_MS) return;
      last = t;
      tickDeck(controllers.A);
      tickDeck(controllers.B);
    }
    rafId = requestAnimationFrame(loop);
  }

  window.DeckTransport = {
    bind: bind,
    onStateChange: onStateChange,
    setNowPlaying: setNowPlaying,
    start: start,
    fmtTime: fmtTime,
  };
})();

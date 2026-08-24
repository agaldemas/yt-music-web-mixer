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
    var npActions = npRoot ? npRoot.querySelector('.np-actions') : null;
    var npInfoBtn = npRoot ? npRoot.querySelector('.np-info-btn') : null;

    var c = {
      deck: deck,
      getPlayer: getPlayer,
      getReady: getReady,
      els: {
        root: root, playBtn: playBtn, seek: seek,
        currentEl: currentEl, durationEl: durationEl, iconEl: iconEl,
        npRoot: npRoot, npThumb: npThumb, npTitle: npTitle, npMeta: npMeta,
        npInfoBtn: npInfoBtn, npActions: npActions,
      },
      dragging: false,    // vrai pendant que l'utilisateur glisse le curseur
      lastState: STATE.UNSTARTED,
    };
    controllers[deck] = c;

    // --- Bouton play / pause ---
    // On bascule entre lecture et pause selon l'état courant. Pour éviter que
    // l'icône reste désynchronisée (ex: play() rejeté par autoplay, ou
    // transition PLAYING→BUFFERING→PLAYING qui lisse mal), on met à jour
    // l'icône de façon optimiste juste après le clic, puis l'événement réel
    // (onStateChange) confirmera/rectifiera.
    if (playBtn) {
      playBtn.addEventListener('click', function () {
        var p = getPlayer();
        if (!p || !getReady()) return;
        var st = (typeof p.getPlayerState === 'function') ? p.getPlayerState() : STATE.UNSTARTED;
        if (st === STATE.PLAYING || st === STATE.BUFFERING) {
          if (typeof p.pauseVideo === 'function') p.pauseVideo();
          // Optimiste : on affiche 'play' (PAUSED) tout de suite, y compris
          // si on était en BUFFERING (sinon le spinner restait bloqué tant
          // que l'événement 'pause' réel n'arrivait pas — or un <audio> en
          // attente de buffer peut tarder à émettre 'pause' après pause()).
          c.lastState = STATE.PAUSED;
          renderState(c);
        } else {
          if (typeof p.playVideo === 'function') {
            var ret = p.playVideo();
            // Optimiste : on passe en BUFFERING (icône pause + spinner)
            // pendant que le play() se résout. Si ça échoue (autoplay
            // bloqué), playVideo() re-signale PAUSED → onStateChange
            // rectifiera l'icône.
            c.lastState = STATE.BUFFERING;
            renderState(c);
            if (ret && typeof ret.catch === 'function') {
              ret.catch(function () {
                // play() rejeté : on revient à PAUSED.
                c.lastState = STATE.PAUSED;
                renderState(c);
              });
            }
          }
        }
      });
    }    // --- Slider de seek ---
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

    // Échap ferme le popup description s'il est ouvert (geste global).
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeAllDescPopups();
    });

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
  // On accepte Toutes les transitions y compris vers le même état que le
  // précédent (utile quand l'état optimiste posé au clic diffère de l'état
  // réel confirmé par l'<audio>).
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
    // Popup description : attaché au <body> (overlay global), recréé à
    // chaque morceau. Un descendant du deck serait piégé dans le contexte
    // d'empilement du deck (platine/analyser plus hauts) → mauvais z-order.
    if (c.npDesc) c.npDesc.remove();
    var npDesc = document.createElement('div');
    npDesc.className = 'np-desc';
    npDesc.setAttribute('role', 'dialog');
    npDesc.style.position = 'fixed';
    npDesc.style.zIndex = '1000';

    // En-tête du popup : bouton "X" de fermeture (aligné à droite).
    var npDescHead = document.createElement('div');
    npDescHead.className = 'np-desc-head';
    var npDescClose = document.createElement('button');
    npDescClose.type = 'button';
    npDescClose.className = 'np-desc-close';
    npDescClose.textContent = '✕';
    npDescClose.setAttribute('aria-label', 'Fermer la description');
    npDescClose.title = 'Fermer';
    npDescClose.addEventListener('click', function () { hideDesc(c); });
    npDescHead.appendChild(npDescClose);

    // Corps : texte de la description (scrollable si trop long).
    var npDescBody = document.createElement('div');
    npDescBody.className = 'np-desc-body';

    npDesc.appendChild(npDescHead);
    npDesc.appendChild(npDescBody);
    document.body.appendChild(npDesc);
    c.npDesc = npDesc;
    c.npDescBody = npDescBody;
    c._npDescId = info.id || '';
    c._npDescText = '';
    c._npDescFailed = false;
    // Titre : texte (ellipsis). Le bouton YouTube est dans .np-actions,
    // au-dessus du bouton info "!" (colonne alignée à droite).
    if (c.els.npTitle) {
      c.els.npTitle.innerHTML = '';
      var titleSpan = document.createElement('span');
      titleSpan.className = 'np-title-text';
      titleSpan.textContent = info.title || '—';
      c.els.npTitle.appendChild(titleSpan);
    }
    // Boutons d'action alignés à droite : YouTube (haut) + info "!" (dessous).
    if (c.els.npActions) {
      var act = c.els.npActions;
      act.innerHTML = '';
      if (info.id) {
        var ytBtn = document.createElement('a');
        ytBtn.className = 'search-result-youtube-link';
        ytBtn.href = 'https://www.youtube.com/watch?v=' + encodeURIComponent(info.id);
        ytBtn.target = '_blank';
        ytBtn.rel = 'noopener noreferrer';
        ytBtn.setAttribute('aria-label', 'Ouvrir ' + info.id + ' sur YouTube');
        ytBtn.title = 'Ouvrir sur YouTube : ' + info.id;
        ytBtn.innerHTML = '<span class="youtube-play-icon" aria-hidden="true">▶</span>';
        ytBtn.addEventListener('click', function (e) {
          if (!window.confirm('Ouvrir cette vidéo YouTube dans un nouvel onglet ?\n\nID : ' + info.id)) {
            e.preventDefault();
          }
        });
        act.appendChild(ytBtn);
        c.npYtBtn = ytBtn;

        var infoBtn = document.createElement('button');
        infoBtn.type = 'button';
        infoBtn.className = 'np-info-btn';
        infoBtn.textContent = '!';
        infoBtn.setAttribute('aria-label', 'Afficher la description');
        infoBtn.title = 'Afficher la description';
        infoBtn.addEventListener('click', function () {
          toggleDesc(c);
        });
        act.appendChild(infoBtn);
        c.els.npInfoBtn = infoBtn;
      } else {
        c.npYtBtn = null;
        c.els.npInfoBtn = null;
      }
    }
    if (c.els.npMeta) c.els.npMeta.innerHTML = [info.uploader, info.modeLabel].filter(Boolean).join('<br>');
    if (c.els.npThumb) {
      if (info.thumbnailUrl) {
        c.els.npThumb.src = info.thumbnailUrl;
        c.els.npThumb.hidden = false;
      } else {
        c.els.npThumb.hidden = true;
      }
    }
    // ---- Verification hook ----
    // Log the title update for deck verification (visible in console)
    console.log('[title-update] Deck', deck, '->', info.title);
    // Store a timestamp to allow manual verification of per‑deck cycle
    c._lastTitleUpdate = Date.now();
  }

  // Bascule le popup description ouvert/fermé, et charge la description
  // une seule fois par morceau (cache sur c). Le texte va dans le corps
  // (.np-desc-body) pour préserver l'en-tête avec le bouton "X".
  function showDesc(c) {
    var el = c.npDesc;
    if (!el || el.classList.contains('np-desc-visible')) return;
    var id = c._npDescId;
    var body = c.npDescBody;
    // Le popup est attaché au <body> (overlay global, z-index 1000) :
    // il passe TOUJOURS au-dessus de l'analyser et de la platine.
    // Positionne près du bouton "!" de la voie concernée.
    var btn = c.els.npInfoBtn;
    if (btn) {
      var r = btn.getBoundingClientRect();
      var vw = window.innerWidth;
      var vh = window.innerHeight;
      // Largeur connue via le CSS (min(420px, 100vw-16px)) : pas besoin
      // de toggler display pour mesurer (le style inline display:none
      // écraserait la classe .np-desc-visible et cacherait le popup).
      var w = Math.min(420, vw - 16);
      var left = Math.min(Math.max(8, r.right - w), vw - w - 8);
      var top = r.bottom + 8;
      if (top + 500 > vh - 8) top = Math.max(8, r.top - 500 - 8);
      el.style.left = Math.round(left) + 'px';
      el.style.top = Math.round(top) + 'px';
    }
    if (id && !c._npDescText && !c._npDescFailed) {
      if (body) body.textContent = 'Description…';
      el.classList.add('np-desc-visible');
      fetch('/api/description/' + encodeURIComponent(id))
        .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
        .then(function (data) {
          if (data && data.description) {
            c._npDescText = data.description;
            if (body) body.textContent = c._npDescText;
          } else {
            c._npDescFailed = true;
            if (body) body.textContent = 'Description indisponible.';
          }
        })
        .catch(function () {
          c._npDescFailed = true;
          if (body) body.textContent = 'Description indisponible.';
        });
    } else {
      if (body) body.textContent = c._npDescText || 'Description indisponible.';
      el.classList.add('np-desc-visible');
    }
    if (c.els.npInfoBtn) c.els.npInfoBtn.classList.add('is-active');
  }

  // Ferme le popup description s'il est ouvert.
  function hideDesc(c) {
    if (!c) return;
    var el = c.npDesc;
    if (el && el.classList.contains('np-desc-visible')) {
      el.classList.remove('np-desc-visible');
    }
    if (c.els.npInfoBtn) c.els.npInfoBtn.classList.remove('is-active');
  }

  // Bascule la visibilité du popup description.
  function toggleDesc(c) {
    var el = c.npDesc;
    if (!el) return;
    if (el.classList.contains('np-desc-visible')) hideDesc(c);
    else showDesc(c);
  }

  // Ferme tous les popups description (gestes globaux : Échap).
  function closeAllDescPopups() {
    ['A', 'B'].forEach(function (deck) {
      var c = controllers[deck];
      if (c) hideDesc(c);
    });
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

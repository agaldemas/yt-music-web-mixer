/* scratch.js — Scratch / platine vinyle DJ (phase 11)
 *
 * Approche C — Hybride (recommandée par piped-enhancement-tasks-list.md §11) :
 *   - Mode normal : MediaElementAudioSourceNode (streaming, économique).
 *   - À l'engage (pointerdown sur la platine) : bascule vers un
 *     AudioBufferSourceNode (PCM en mémoire) → vrai scratch bidirectionnel,
 *     pitch variable. Le buffer est décodé paresseusement au 1er engage
 *     (état « chargement… »), jamais au chargement du morceau.
 *   - Au relâchement (pointerup) : rebascule vers le streaming, remet
 *     audio.currentTime à la position finale du scratch, reprend si en lecture.
 *
 * Pourquoi un AudioBufferSourceNode : seul lui permet une lecture arrière
 * sample-accurate et un playbackRate négatif (vraie platine). L'<audio>
 * HTML5 ne garantit pas playbackRate < 0 (Safari/mobile l'ignore).
 *
 * API (window.Scratch) :
 *   - enable(deck)     : crée la platine DOM + câble les Pointer Events
 *   - disable(deck)    : détache les handlers (mode IFrame)
 *   - engage(deck)     : décode le buffer + bascule vers AudioBufferSourceNode
 *   - disengage(deck)  : rebascule streaming + reprend la lecture
 *   - setRate(deck, r) : playbackRate du scratch (peut être < 0)
 *   - seek(deck, sec)  : recrée le nœud scratch à sec
 *   - isBufferReady(deck)
 *
 * Dépendances : window.AudioEngine (graphe + buffer), window.PipedStreams
 * (URL CORS-safe du flux courant). Les modules sont chargés avant scratch.js.
 *
 * Conventions : IIFE, vanilla JS, camelCase, window.Scratch exposé.
 */

(function () {
  // ===== Constantes =====
  //
  // Mappage vitesse angulaire → playbackRate. SENS multiplie la vitesse
  // angulaire (rad/ms) pour obtenir un rate de scratch perceptif. MAX_RATE
  // borne le rate (avant/arrière) — cohérent avec AudioEngine.SCRATCH_MAX_RATE.
  // SMOOTH : facteur de lissage (low-pass) du rate pour éviter le jitter
  // des Pointer Events (~60-120 Hz vs audio 44.1 kHz). Bas = réactif.
  // GEAR : rapport rotation platter / angle du curseur pendant un scratch.
  // 1.0 = la platine suit 1:1 le doigt (vraie sensation vinyle attrapé).
  var SENS = 0.020;
  var MAX_RATE = 3;
  var SMOOTH = 0.15;          // 0 = pas de lissage, 1 = figé
  var GEAR = 1.0;             // rotation visuelle par radian de mouvement curseur

  // (Ancien DECODE_TIMEOUT_MS supprimé : le Promise.race/timeout cassait
  // l'état — rejetait l'appelant tout en laissant le decode tourner en
  // arrière-plan → "Erreur" puis "tombe en marche". fetch() échoue de lui-même
  // si le réseau est coupé ; on laisse donc le decode courir jusqu'au bout.)

  // Tolérance de mouvement (px) avant de considérer un vrai drag (évite les
  // micro-clics de bouge pas).
  var MOVE_THRESHOLD_PX = 3;

  // États de la platine pour l'affichage (badge + attribut data-scratch-state).
  var STATE_IDLE = 'idle';
  var STATE_LOADING = 'loading';
  var STATE_ENGAGED = 'engaged';
  var STATE_ERROR = 'error';

  // ===== État par voie =====
  var platters = { A: null, B: null };

  function makeState(deck) {
    return {
      deck: deck,
      el: null,            // élément .platter
      marker: null,        // repère angulaire (.platter-marker)
      statusEl: null,      // badge d'état
      active: false,       // vrai pendant un geste de scratch (pointerdown → up)
      bufferReady: false,  // AudioBuffer décodé dispo
      loading: false,      // décodage en cours
      loadPromise: null,   // promesse du décodage en cours (réutilisée, pas recréée)
      loadVideoId: '',     // videoId pour lequel le buffer a été/est décodé
      lastUrl: '',         // URL décodée (évite de re-décoder si identical)
      precacheStarted: false, // vrai si le préchargement auto a déjà été lancé
      lastAngle: 0,        // dernier angle (rad) du pointeur
      lastTime: 0,         // timestamp du dernier move (ms)
      smoothRate: 0,       // rate lissé (low-pass)
      rotation: 0,         // angle cumulé de la platine (rad, pour le visuel)
      rafId: null,         // boucle de rotation visuelle
    };
  }

  // ===== Helpers =====

  function $(sel, deck) {
    return document.querySelector(sel + '[data-deck="' + deck + '"]');
  }

  // Angle absolu du pointeur par rapport au centre de la platine.
  function angleFromPointer(el, clientX, clientY) {
    var rect = el.getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    return Math.atan2(clientY - cy, clientX - cx);
  }

  // Normalise un delta angulaire dans [-π, π] (pour gérer le passage -π/+π).
  function normalizeDelta(d) {
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  }

  function now() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  function setState(deck, st, label) {
    var p = platters[deck];
    if (!p || !p.el) return;
    p.el.setAttribute('data-scratch-state', st);
    if (p.statusEl) p.statusEl.textContent = label || st;
  }

  // Boucle de rotation visuelle : tourne la platine selon le rate courant
  // (en scratch) ou la position de lecture (en streaming). Légère (~60 Hz).
  function startRotationLoop(deck) {
    var p = platters[deck];
    if (!p || p.rafId) return;
    var lastT = now();
    function tick() {
      p.rafId = requestAnimationFrame(tick);
      var t = now();
      var dt = (t - lastT) / 1000;
      lastT = t;
      var AE = window.AudioEngine;
      if (!AE) return;
      if (AE.isScratchEngaged(deck)) {
        // En scratch : la rotation est pilotée directement par updateRate()
        // (platine collée au doigt, 1:1 via GEAR). On ne fait RIEN ici — sinon
        // on superposerait une rotation "libre" qui brouillerait la sensation.
        // Le marker est déjà mis à jour dans updateRate().
      } else {
        // En streaming : rotation liée à la position de lecture (1 tour = morceau).
        var audio = AE.getDeckAudioElement(deck);
        if (audio && audio.duration && isFinite(audio.duration) && audio.duration > 0) {
          // 2 tours par morceau (rendu visuel, pas besoin d'être exact).
          p.rotation = (audio.currentTime / audio.duration) * 2 * Math.PI * 4;
        }
      }
      if (p.marker) {
        p.marker.style.transform = 'rotate(' + p.rotation + 'rad)';
      }
    }
    p.rafId = requestAnimationFrame(tick);
  }

  function stopRotationLoop(deck) {
    var p = platters[deck];
    if (!p || !p.rafId) return;
    cancelAnimationFrame(p.rafId);
    p.rafId = null;
  }

  // ===== Décodage paresseux du buffer =====
  //
  // Au 1er engage, on doit télécharger le fichier audio complet et le
  // décoder en PCM float32 (decodeAudioData ne supporte pas le streaming).
  // On récupère l'URL CORS-safe du flux courant via PipedStreams. Si le
  // morceau change, le buffer est invalidé (clearDeckBuffer par app.js).

  function getStreamUrlForDeck(deck) {
    var PipedStreams = window.PipedStreams;
    var videoId = window.state && window.state.videoIds ? window.state.videoIds[deck] : '';
    if (!PipedStreams || !videoId) {
      console.warn('[scratch:' + deck + '] getStreamUrlForDeck: PipedStreams=' + !!PipedStreams
        + '  videoId="' + videoId + '" → URL vide');
      return '';
    }
    var entry = PipedStreams.getCachedStream(videoId);
    if (!entry || !entry.bestAudio) {
      console.warn('[scratch:' + deck + '] getStreamUrlForDeck: pas de cache pour videoId="' + videoId + '"'
        + '  entry=' + !!entry + '  bestAudio=' + (entry && !!entry.bestAudio));
      return '';
    }
    var url = PipedStreams.getCorsSafeUrl(entry, entry.bestAudio.stream);
    console.log('%c[scratch:' + deck + '] getStreamUrlForDeck: videoId="' + videoId + '"'
      + '  instance="' + (entry.instance || '?') + '"'
      + '  url=' + (url.length > 80 ? url.slice(0, 80) + '…' : url),
      'color:#08e');
    return url;
  }

  // Lance le décodage du buffer scratch s'il n'est pas déjà prêt ou en cours.
  // RÉUTILISE la promesse en cours (p.loadPromise) : si le préchargement a déjà
  // démarré au premier 'playing', l'engage au clic attend la même promesse au
  // lieu de relancer un 2e fetch+decode. Une seule tentative par videoId/URL.
function ensureBuffer(deck) {
    var AE = window.AudioEngine;
    var p = platters[deck];
    if (!AE || !p) return Promise.reject(new Error('AudioEngine absent'));

    // === Chemins de réutilisation (instantanés) ===
    if (p.bufferReady && AE.getDeckBuffer(deck)) {
      console.log('%c[scratch:' + deck + '] ensureBuffer: ✓ DÉJÀ PRÊT (instantané)', 'color:#0a0;font-weight:bold');
      return Promise.resolve();
    }
    if (p.loadPromise) {
      console.log('%c[scratch:' + deck + '] ensureBuffer: ⟳ réutilise le décodage EN COURS'
        + '  (loading=' + p.loading + '  active=' + p.active + ')', 'color:#e80');
      return p.loadPromise;
    }

    // === Tee : réutilise le buffer déjà décodé par audio-player.js ===
    // audio-player.js fetch() une seule fois le flux → partage les octets avec
    // AudioEngine.loadDeckBufferFromBlob. Si le décodage tee est en vol (ou
    // déjà fini), on l'attend SANS relancer de 2e fetch/XHR (le throttle CDN).
    var teeBuffer = AE.getDeckBuffer(deck);
    if (teeBuffer) {
      p.bufferReady = true;
      p.loading = false;
      console.log('%c[scratch:' + deck + '] ensureBuffer: ✓ TEE buffer récupéré (pas de re-fetch)', 'color:#0a0;font-weight:bold');
      return Promise.resolve();
    }
    var teePromise = (typeof AE.getDeckBufferLoadPromise === 'function') ? AE.getDeckBufferLoadPromise(deck) : null;
    if (teePromise) {
      p.loading = true;
      if (p.active) setState(deck, STATE_LOADING, 'Décodage…');
      console.log('%c[scratch:' + deck + '] ensureBuffer: ⟳ TEE décodage EN COURS → on attend le tee (pas de re-fetch)'
        + '  (active=' + p.active + ')', 'color:#08e;font-weight:bold');
      p.loadPromise = teePromise.then(function (decoded) {
        // decoded=null : AudioEngine indisponible au moment du fetch → le tee
        // n'a pas décodé. On retombe sur le chemin XHR secours ci-dessous.
        if (!decoded) {
          p.loading = false;
          p.loadPromise = null;
          console.warn('[scratch:' + deck + '] ensureBuffer: tee résolu sans buffer → fallback XHR');
          return ensureBuffer(deck);
        }
        p.bufferReady = true;
        p.loading = false;
        p.loadPromise = null;
        console.log('%c[scratch:' + deck + '] ensureBuffer: ✓ TEE buffer PRÊT'
          + '  (duration=' + decoded.duration.toFixed(1) + 's'
          + '  active=' + p.active + ')',
          'color:#0a0;font-weight:bold');
        if (!p.active) setState(deck, STATE_IDLE, 'Prêt');
        return decoded;
      }, function (err) {
        p.loading = false;
        p.loadPromise = null;
        console.warn('[scratch:' + deck + '] ensureBuffer: tee décodage échoué → fallback XHR:', err && err.message);
        // On retombe sur le chemin XHR classique ci-dessous en relançant ensureBuffer.
        return ensureBuffer(deck);
      });
      return p.loadPromise;
    }

    var url = getStreamUrlForDeck(deck);
    if (!url) {
      console.error('[scratch:' + deck + '] ensureBuffer: ✗ URL vide → rejet immédiat');
      return Promise.reject(new Error('Aucun flux audio disponible pour le scratch.'));
    }
    if (p.bufferReady && p.lastUrl === url && AE.getDeckBuffer(deck)) {
      console.log('%c[scratch:' + deck + '] ensureBuffer: ✓ même URL déjà décodée (instantané)', 'color:#0a0');
      return Promise.resolve();
    }

    // === NOUVEAU décodage (XHR + decodeAudioData) ===
    console.log('%c[scratch:' + deck + '] ensureBuffer: ⏳ NOUVEAU décodage démarré'
      + '  active=' + p.active
      + '  url=' + (url.length > 70 ? url.slice(0, 70) + '…' : url),
      'color:#e80;font-weight:bold');
    p.loading = true;
    p.lastUrl = url;
    if (p.active) setState(deck, STATE_LOADING, 'Chargement…');

    // Callback de progression : met à jour le badge de la platine pendant le
    // téléchargement (ex: "↓ 45%"). En préchargement (active=false) on reste
    // discret pour ne pas polluer l'UI.
    function onProgress(fraction) {
      if (p.active) {
        setState(deck, STATE_LOADING, '↓ ' + Math.round(fraction * 100) + '%');
      }
    }

    var t0 = now();
    var decode = AE.decodeDeckBuffer(deck, url, onProgress).then(function (decoded) {
      p.bufferReady = true;
      p.loading = false;
      p.loadPromise = null;
      var totalMs = (now() - t0).toFixed(0);
      console.log('%c[scratch:' + deck + '] ensureBuffer: ✓ buffer PRÊT en ' + totalMs + 'ms'
        + '  (duration=' + decoded.duration.toFixed(1) + 's'
        + '  active=' + p.active + ')',
        'color:#0a0;font-weight:bold');
      if (!p.active) setState(deck, STATE_IDLE, 'Prêt');
      return decoded;
    });

    p.loadPromise = decode.then(null, function (err) {
      p.loading = false;
      p.loadPromise = null;
      var totalMs = (now() - t0).toFixed(0);
      console.error('[scratch:' + deck + '] ensureBuffer: ✗ décodage ÉCHOUÉ après ' + totalMs + 'ms : '
        + (err && err.message || err));
      if (p.active) setState(deck, STATE_ERROR, 'Erreur');
      throw err;
    });

    return p.loadPromise;
  }

  // Préchargement silencieux : décode le buffer en arrière-plan dès le premier
  // lancement du son (événement 'playing' du deck). Objectif : au moment où
  // l'utilisateur clique la platine, le buffer est déjà en mémoire → engage
  // instantané, plus de 'Chargement…' bloquant. Idempotent : ne fait rien si
  // déjà prêt ou en cours. Appelé par app.js (hook sur 'playing').
function precache(deck) {
    var p = platters[deck];
    if (!p) return;
    var videoId = window.state && window.state.videoIds ? window.state.videoIds[deck] : '';
    console.log('%c[scratch:' + deck + '] precache() appelé'
      + '  videoId="' + videoId + '"'
      + '  loadVideoId="' + p.loadVideoId + '"'
      + '  bufferReady=' + p.bufferReady
      + '  loading=' + p.loading
      + '  hasLoadPromise=' + !!p.loadPromise,
      'color:#08e');
    // Si le morceau a changé sans invalidation explicite, on réinvalide.
    if (p.loadVideoId && p.loadVideoId !== videoId) {
      console.log('[scratch:' + deck + '] precache: morceau changé → invalidateBuffer');
      invalidateBuffer(deck);
    }
    p.loadVideoId = videoId;
    if (p.bufferReady || p.loading || p.loadPromise) {
      console.log('[scratch:' + deck + '] precache: déjà prêt/en cours → skip');
      return;
    }
    if (!videoId) {
      console.warn('[scratch:' + deck + '] precache: pas de videoId → skip');
      return;
    }
    console.log('%c[scratch:' + deck + '] precache: lance le décodage en arrière-plan…', 'color:#08e');
    // Lance le décodage en arrière-plan (silencieux : showLoading=false).
    ensureBuffer(deck).catch(function (err) {
      // Erreur de préchargement — silencieuse. L'engage la remontera si besoin.
      if (window.console && console.debug) {
        console.debug('[scratch] precache ' + deck + ' échoué:', err && err.message);
      }
    });
  }

  // ===== Engage / Disengage =====

function engage(deck) {
    var AE = window.AudioEngine;
    var p = platters[deck];
    if (!AE || !p || p.active) return;
    console.log('%c[scratch:' + deck + '] engage() — clic platine'
      + '  bufferReady=' + p.bufferReady
      + '  loading=' + p.loading
      + '  hasLoadPromise=' + !!p.loadPromise,
      'color:#e80;font-weight:bold');
    p.active = true;
    AE.resume().then(function () {
      if (!p.bufferReady) setState(deck, STATE_LOADING, 'Chargement…');
      return ensureBuffer(deck);
    }).then(function () {
      // ⚠️ Race fix : si l'utilisateur a relâché la platine (pointerup) avant
      // que le buffer soit prêt, on n'engage PAS le scratch — sinon le scratch
      // s'active tout seul sans que l'utilisateur tienne la platine.
      if (!p.active) {
        console.log('%c[scratch:' + deck + '] engage: user déjà relâché → ABORT (pas de engageScratch)', 'color:#e80');
        return null;
      }
      console.log('%c[scratch:' + deck + '] engage: buffer prêt → AE.engageScratch()', 'color:#0a0');
      return AE.engageScratch(deck);
    }).then(function (res) {
      if (!res) return; // abort (user relâché avant la fin du chargement)
      p.wasPlaying = res && res.wasPlaying;
      p.smoothRate = 0;
      setState(deck, STATE_ENGAGED, 'Scratch');
      console.log('%c[scratch:' + deck + '] engage: ✓ SCRATCH ACTIF'
        + '  offset=' + (res && typeof res.offset === 'number' ? res.offset.toFixed(2) : '?') + 's'
        + '  wasPlaying=' + p.wasPlaying,
        'color:#0a0;font-weight:bold');
    }).catch(function (err) {
      p.active = false;
      setState(deck, STATE_ERROR, 'Erreur');
      console.error('[scratch:' + deck + '] engage: ✗ ÉCHEC:', err && err.message);
      flashStatus(deck, 'Scratch indisponible : ' + (err && err.message || 'erreur'));
    });
  }

function disengage(deck) {
    var AE = window.AudioEngine;
    var p = platters[deck];
    if (!AE || !p || !p.active) return;
    console.log('%c[scratch:' + deck + '] disengage() — relâchement platine', 'color:#e80');
    p.active = false;
    // ⚠️ Si le scratch n'a JAMAIS été engagé (buffer pas prêt au moment du
    // clic), on ne fait rien côté AudioEngine — on remet juste l'UI à 'Prêt'.
    // Inutile d'appeler disengageScratch qui ferait un duckDown/swap pour rien.
    if (AE.isScratchEngaged(deck)) {
      var pos = AE.getScratchPosition(deck);
      console.log('[scratch:' + deck + '] disengage: pos finale=' + pos.toFixed(2) + 's  wasPlaying=' + p.wasPlaying);
      AE.disengageScratch(deck, pos, p.wasPlaying);
    } else {
      console.log('[scratch:' + deck + '] disengage: scratch pas engagé (buffer pas prêt) → juste UI reset');
    }
    p.smoothRate = 0;
    setState(deck, STATE_IDLE, 'Prêt');
  }

  // ===== Mise à jour du rate pendant le geste =====
  //
  // À chaque pointermove, on calcule le delta angulaire + le delta temps →
  // vitesse angulaire → rate. Low-pass pour lisser le jitter des Pointer
  // Events.

  function updateRate(deck, clientX, clientY) {
    var p = platters[deck];
    if (!p || !p.active) return;
    var AE = window.AudioEngine;
    if (!AE || !AE.isScratchEngaged(deck)) return;

    var angle = angleFromPointer(p.el, clientX, clientY);
    var t = now();
    var dt = t - p.lastTime;
    if (dt <= 0) dt = 1;
    var dAngle = normalizeDelta(angle - p.lastAngle);
    p.lastAngle = angle;
    p.lastTime = t;

    // La platine est "collée" au doigt (vraie sensation vinyle attrapé) :
    // sa rotation visuelle suit 1:1 (× GEAR) le déplacement angulaire du curseur.
    p.rotation += dAngle * GEAR;
    if (p.marker) p.marker.style.transform = 'rotate(' + p.rotation + 'rad)';

    // Vitesse angulaire (rad/ms).
    var vel = dAngle / dt;
    // Rate brut : borne pour la sécurité.
    var raw = vel * SENS * 1000; // rad/ms → rad/s * SENS
    raw = Math.max(-MAX_RATE, Math.min(MAX_RATE, raw));

    // Low-pass : smoothRate = smoothRate + (raw - smoothRate) * (1 - SMOOTH)
    p.smoothRate = p.smoothRate + (raw - p.smoothRate) * (1 - SMOOTH);

    AE.setScratchRate(deck, p.smoothRate);
  }

  // ===== Re-seek scratch (saut de position) =====
  //
  // Si l'utilisateur bouge très vite (dépasse le seuil de continuité), on
  // recrée le nœud à une nouvelle position plutôt que de forcer un rate
  // énorme. Détecté via un delta angulaire trop grand en un seul move.

  function maybeSeek(deck, clientX, clientY) {
    var p = platters[deck];
    if (!p || !p.active) return false;
    var AE = window.AudioEngine;
    if (!AE || !AE.isScratchEngaged(deck)) return false;

    var angle = angleFromPointer(p.el, clientX, clientY);
    var dAngle = normalizeDelta(angle - p.lastAngle);
    // Si on a fait plus d'1/4 de tour en un seul move → c'est un saut, pas
    // un scratch continu. On re-seek proportionnellement.
    if (Math.abs(dAngle) > Math.PI / 2) {
      var buffer = AE.getDeckBuffer(deck);
      if (!buffer) return false;
      var cur = AE.getScratchPosition(deck);
      // 1 tour complet = toute la durée du morceau (rendu intuitif).
      var ratio = dAngle / (2 * Math.PI);
      var next = cur + ratio * buffer.duration;
      next = Math.max(0, Math.min(next, buffer.duration));
      AE.seekScratch(deck, next);
      p.lastAngle = angle;
      p.lastTime = now();
      return true;
    }
    return false;
  }

  // ===== Câblage Pointer Events =====

  function wirePointerEvents(deck) {
    var p = platters[deck];
    if (!p || !p.el) return;
    var el = p.el;

    // touch-action: none → le navigateur ne scroll pas pendant le scratch.
    el.style.touchAction = 'none';

    function onDown(e) {
      // Ignore si bouton droit / middle.
      if (e.button != null && e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      p.lastAngle = angleFromPointer(el, e.clientX, e.clientY);
      p.lastTime = now();
      p._startX = e.clientX;
      p._startY = e.clientY;
      p._moved = false;
      engage(deck);
    }

    function onMove(e) {
      if (!p.active && p._startX != null) {
        // Seuil de mouvement avant de considérer un vrai drag.
        var dx = e.clientX - p._startX;
        var dy = e.clientY - p._startY;
        if (Math.sqrt(dx * dx + dy * dy) < MOVE_THRESHOLD_PX) return;
      }
      // Tente d'abord un re-seek (saut), sinon mise à jour du rate continu.
      if (!maybeSeek(deck, e.clientX, e.clientY)) {
        updateRate(deck, e.clientX, e.clientY);
      }
    }

    function onUp(e) {
      if (el.hasPointerCapture && el.hasPointerCapture(e.pointerId)) {
        el.releasePointerCapture(e.pointerId);
      }
      p._startX = null;
      disengage(deck);
    }

    function onCancel(e) {
      onUp(e);
    }

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    el.addEventListener('lostpointercapture', onCancel);

    // Stocke les handlers pour pouvoir les retirer (disable).
    p._handlers = { down: onDown, move: onMove, up: onUp, cancel: onCancel };
  }

  // ===== Construction de la platine DOM =====
  //
  // La structure HTML attendue dans index.html :
  //   <div class="deck-scratch" data-deck="A">
  //     <div class="platter" data-deck="A">
  //       <div class="platter-marker"></div>
  //     </div>
  //     <span class="platter-status">—</span>
  //   </div>
  // Si la platine n'existe pas, on la crée ici (robustesse).

  function ensurePlatterDOM(deck) {
    var root = $('.deck-scratch', deck);
    if (!root) return null;
    var platter = root.querySelector('.platter');
    if (!platter) {
      platter = document.createElement('div');
      platter.className = 'platter';
      platter.setAttribute('data-deck', deck);
      root.insertBefore(platter, root.firstChild);
    }
    var marker = platter.querySelector('.platter-marker');
    if (!marker) {
      marker = document.createElement('div');
      marker.className = 'platter-marker';
      platter.appendChild(marker);
    }
    var status = root.querySelector('.platter-status');
    if (!status) {
      status = document.createElement('span');
      status.className = 'platter-status';
      status.textContent = '—';
      root.appendChild(status);
    }
    return { root: root, platter: platter, marker: marker, status: status };
  }

  function enable(deck) {
    var dom = ensurePlatterDOM(deck);
    if (!dom) return false;
    if (!platters[deck]) platters[deck] = makeState(deck);
    var p = platters[deck];
    p.el = dom.platter;
    p.marker = dom.marker;
    p.statusEl = dom.status;
    wirePointerEvents(deck);
    setState(deck, STATE_IDLE, 'Prêt');
    startRotationLoop(deck);
    return true;
  }

  function disable(deck) {
    var p = platters[deck];
    if (!p) return;
    stopRotationLoop(deck);
    // Désengage proprement si un scratch était actif.
    if (p.active) {
      try { disengage(deck); } catch (e) {}
    }
    if (p._handlers && p.el) {
      var h = p._handlers;
      p.el.removeEventListener('pointerdown', h.down);
      p.el.removeEventListener('pointermove', h.move);
      p.el.removeEventListener('pointerup', h.up);
      p.el.removeEventListener('pointercancel', h.cancel);
      p.el.removeEventListener('lostpointercapture', h.cancel);
    }
    p.el = null;
    p._handlers = null;
  }

  // ===== Divers =====

  // Réutilise la zone de statut sync (comme cue/loop) pour flasher un
  // message d'erreur scratch.
  function flashStatus(deck, msg) {
    var statusEl = document.getElementById('sync-status');
    if (statusEl) {
      statusEl.textContent = msg;
      statusEl.hidden = false;
      clearTimeout(statusEl._t);
      statusEl._t = setTimeout(function () { statusEl.hidden = true; }, 2500);
    }
  }

  function setRate(deck, rate) { window.AudioEngine && window.AudioEngine.setScratchRate(deck, rate); }
  function seek(deck, sec) { window.AudioEngine && window.AudioEngine.seekScratch(deck, sec); }
  function isBufferReady(deck) { return !!(platters[deck] && platters[deck].bufferReady); }

  // Invalide le buffer (changement de morceau). Appelé par app.js.
  function invalidateBuffer(deck) {
    var p = platters[deck];
    if (!p) return;
    p.bufferReady = false;
    p.loading = false;
    p.loadPromise = null;
    p.lastUrl = '';
    p.precacheStarted = false;
    if (window.AudioEngine && typeof window.AudioEngine.clearDeckBuffer === 'function') {
      try { window.AudioEngine.clearDeckBuffer(deck); } catch (e) {}
    }
    setState(deck, STATE_IDLE, 'Prêt');
  }

  // ===== API publique =====
  window.Scratch = {
    enable: enable,
    disable: disable,
    engage: engage,
    disengage: disengage,
    setRate: setRate,
    seek: seek,
    isBufferReady: isBufferReady,
    invalidateBuffer: invalidateBuffer,
    precache: precache,
    STATE: { IDLE: STATE_IDLE, LOADING: STATE_LOADING, ENGAGED: STATE_ENGAGED, ERROR: STATE_ERROR },
  };
})();

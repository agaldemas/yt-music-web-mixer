/* audio-player.js — Lecteur audio Piped (mode DSP)
 *
 * Wrapper <audio> + Web Audio API qui expose la même interface que
 * YTWrapper.createPlayer (loadVideoById, playVideo, pauseVideo, seekTo,
 * setVolume, mute, unMute, getCurrentTime, getDuration, getPlayerState).
 *
 * Cycle de vie :
 *   1. createAudioPlayer(deckId, opts)
 *      - Crée un <audio crossOrigin="anonymous" preload="auto"> dans le DOM
 *        (rattaché au conteneur .deck-player du deck, ou au body si absent).
 *      - Appelle AudioEngine.createDeckChain(deckId, audio) pour brancher
 *        l'élément dans le graphe Web Audio.
 *      - Retourne un wrapper `p` avec les méthodes de contrôle.
 *   2. p.loadVideoById(id)
 *      - Demande PipedStreams.fetchStreamInfo(id) (cascade d'instances).
 *      - Construit le src CORS-safe via PipedStreams.getCorsSafeUrl(entry, best).
 *      - Affecte audio.src = corsUrl + audio.load().
 *      - Si le kind est 'video-fallback', l'<audio> lira quand même le MP4
 *        (le décodeur ignore la piste vidéo — l'app devient audio-only).
 *   3. p.playVideo() appelle AudioEngine.resume() puis audio.play()
 *   4. Événements <audio> → onStateChange(state) avec mappage vers
 *      YTWrapper.STATE (unified) :
 *         loadstart/emptied → UNSTARTED (-1)
 *         canplay/loadedmetadata → CUED (5)
 *         playing → PLAYING (1)
 *         pause → PAUSED (2)
 *         waiting/stalled → BUFFERING (3)
 *         ended → ENDED (0)
 *   5. Expiration : si audio.error.code === MEDIA_ERR_NETWORK ou
 *      MEDIA_ERR_SRC_NOT_SUPPORTED, on appelle PipedStreams.refreshStream(id)
 *      → nouveau src → on restaure currentTime → on reprend si PLAYING.
 *
 * Conventions : IIFE, vanilla JS, camelCase, window.AudioPlayer exposé.
 */

(function () {
  // ===== Accès à app.js pour mettre à jour l'UI now-playing =====
  var appJsExposed = (typeof app !== 'undefined') ? app : null;

  // ===== Accès à app.js pour mettre à jour l'UI now-playing =====
  // ===== États unifiés (mêmes valeurs que YTWrapper.STATE) =====
  // On réutilise YTWrapper.STATE s'il est déjà chargé pour éviter une
  // divergence entre les deux backends. Sinon, on définit un fallback local.
  const STATE = (window.YTWrapper && window.YTWrapper.STATE) || {
    UNSTARTED: -1,
    ENDED: 0,
    PLAYING: 1,
    PAUSED: 2,
    BUFFERING: 3,
    CUED: 5,
  };

  // Codes d'erreur <audio> qui déclenchent un refresh de l'URL Piped.
  // MEDIA_ERR_ABORTED (1) = on a annulé nous-mêmes (loadVideoById suivant).
  // MEDIA_ERR_NETWORK (2) = URL morte ou expirée.
  // MEDIA_ERR_DECODE (3) = format non supporté par <audio> (rare : mp4 muxé).
  // MEDIA_ERR_SRC_NOT_SUPPORTED (4) = MIME/extension refusée.
  const RETRYABLE_AUDIO_ERRORS = new Set([2, 3, 4]);

  // ===== Helpers =====

  // Trouve le conteneur DOM où attacher l'élément <audio>. On le cache dans
  // le .deck-player (à côté de l'iframe YouTube IFrame) pour qu'il soit
  // mutuellement exclusif : quand on bascule en mode Piped, l'iframe peut
  // être masquée. Si le conteneur .deck-player n'existe pas, on retombe sur
  // body (le <audio> n'a pas besoin d'être visible pour jouer).
  function resolveDeckContainer(deckId) {
    const byId = document.getElementById('player-' + deckId);
    if (byId) return byId;
    const byDeck = document.querySelector('.deck-player[data-deck="' + deckId + '"]');
    if (byDeck) return byDeck;
    const byData = document.querySelector('[data-deck="' + deckId + '"]');
    if (byData) return byData;
    return document.body;
  }

  // Crée l'élément <audio> dédié au deck. crossOrigin="anonymous" est
  // OBLIGATOIRE sinon le MediaElementAudioSourceNode reçoit du silence
  // (audio tainted). preload="auto" force la mise en buffer pour fluidité.
  function createAudioElement() {
    const audio = document.createElement('audio');
    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';
    audio.playsInline = true;
    // Pas d'attribut controls : on contrôle tout depuis l'UI.
    // Style invisible : le <audio> n'a pas besoin d'être affiché.
    audio.style.display = 'none';
    // Fixe preservesPitch sur tous les moteurs (Chrome/Firefox/Safari).
    try { audio.preservesPitch = true; } catch (e) { /* non supporté */ }
    try { audio.mozPreservesPitch = true; } catch (e) { /* non supporté */ }
    try { audio.webkitPreservesPitch = true; } catch (e) { /* non supporté */ }
    return audio;
  }

  // Mappage d'événement <audio> → STATE (cf. spec section 3)
  function audioEventToState(evtType) {
    switch (evtType) {
      case 'loadstart':
      case 'emptied':
        return STATE.UNSTARTED;
      case 'loadedmetadata':
      case 'loadeddata':
      case 'canplay':
      case 'canplaythrough':
        return STATE.CUED;
      case 'playing':
        return STATE.PLAYING;
      case 'pause':
        return STATE.PAUSED;
      case 'waiting':
      case 'stalled':
        return STATE.BUFFERING;
      case 'ended':
        return STATE.ENDED;
      default:
        return null; // événement neutre, pas d'état
    }
  }

  // ===== Création du lecteur =====

  // createAudioPlayer(deckId, { videoId, onReady, onStateChange, onError })
  // Retourne un wrapper `p` qui imite l'API de YTWrapper.
  function createAudioPlayer(deckId, opts) {
    opts = opts || {};
    const onReady = opts.onReady || function () {};
    const onStateChange = opts.onStateChange || function () {};
    const onError = opts.onError || function () {};

    // Accès paresseux aux modules (chargés dans l'ordre dans index.html).
    const PipedStreams = window.PipedStreams;
    const AudioEngine = window.AudioEngine;

    if (!PipedStreams) {
      throw new Error('audio-player.js: window.PipedStreams manquant (charger piped-streams.js avant)');
    }
    if (!AudioEngine) {
      throw new Error('audio-player.js: window.AudioEngine manquant (charger audio-engine.js avant)');
    }

    const audio = createAudioElement();
    const container = resolveDeckContainer(deckId);
    if (container) container.appendChild(audio);

    // État interne du wrapper
    const state = {
      deckId: deckId,
      currentVideoId: '',
      // playerType sera mis à jour par app.js et loadLocalFile
      lastKnownTime: 0,
      // Vrai si playVideo() a été demandé pendant loading (à appliquer au ready)
      pendingPlay: false,
      // Vrai si on a déclenché une lecture avant que l'AudioEngine soit prêt
      wasPlayingBeforeError: false,
      // Compteur de refresh (anti-boucle en cas d'URL toujours invalide)
      refreshCount: 0,
      // blobUrl: URL same-origin (blob:) actuellement branchée sur audio.src.
      // Tee du flux : un seul fetch → Blob pour la lecture + décodage scratch.
      blobUrl: null,
      // Dédup : si l'utilisateur relance loadVideoById pendant qu'un download
      // est en cours, on attend la même promesse au lieu de relancer un fetch.
      loadPromise: null,
      loadAbort: null,
      disposed: false,
      sourceKind: 'youtube',
      // Numéro de chargement : ignore les réponses réseau d'une ancienne
      // sélection qui arriveraient après un nouveau morceau.
      loadGeneration: 0,
    };

    // Crée la chaîne Web Audio pour cette voie. ⚠️ À faire ICI (au moment
    // de createAudioPlayer) plutôt qu'au premier loadVideoById, car un
    // élément <audio> ne peut être connecté à un MediaElementAudioSourceNode
    // qu'UNE SEULE FOIS. Si on crée le src avant la chaîne, l'audio sort
    // directement vers les haut-parleurs (sans DSP), et on ne peut plus
    // l'attacher ensuite. Donc on branche la chaîne dès maintenant.
    //
    // Exception défensive : si createDeckChain échoue (autre cas déjà
    // connecté), on log et on continue sans DSP. La voie reste utilisable
    // en mode <audio> direct (volume only via setVolume natif).
    try {
      AudioEngine.createDeckChain(deckId, audio);
    } catch (e) {
      // On ne peut pas créer deux chaînes pour le même deck. Si le caller
      // a déjà créé une chaîne (ex: re-création du player), on continue
      // quand même : l'élément <audio> sera déjà dans le graphe existant.
      // Sinon, on propage l'erreur (vraie condition d'erreur).
      if (!AudioEngine.hasDeck(deckId)) throw e;
    }

    // ===== Mapping STATE =====
    // On notifie onStateChange à chaque transition d'état. On garde une
    // mémoire du dernier état publié, mais on autorise quand même à
    // republier le MÊME état si le caller l'exige (ex: le bouton play/pause
    // pose un état optimiste au clic, puis l'événement réel confirme le
    // même état → il faut quand même rafraîchir l'icône). C'est reportState
    // qui est appelé par les listeners <audio>.
    let lastReportedState = STATE.UNSTARTED;
    function reportState(newState) {
      if (newState == null) return;
      lastReportedState = newState;
      try { onStateChange({ data: newState }); } catch (e) { /* ignore */ }
    }

    // ===== Cycle de vie unifié des chargements =====

    function isCurrent(generation) {
      return !state.disposed && generation === state.loadGeneration;
    }

    function clearLocalMetadata() {
      var playerObj = window.state && window.state.players ? window.state.players[deckId] : null;
      if (!playerObj) return;
      if (playerObj.lastLocalCover) {
        try { URL.revokeObjectURL(playerObj.lastLocalCover); } catch (_) {}
      }
      playerObj.lastLocalTitle = '';
      playerObj.lastLocalArtist = '';
      playerObj.lastLocalFileName = '';
      playerObj.lastLocalCover = null;
    }

    function resetSource(options) {
      options = options || {};
      if (options.abort !== false && state.loadAbort) {
        try { state.loadAbort.abort(); } catch (_) {}
        state.loadAbort = null;
      }
      if (state.blobUrl) {
        try { URL.revokeObjectURL(state.blobUrl); } catch (_) {}
        state.blobUrl = null;
      }
      state.loadPromise = null;
      if (options.clearBuffer !== false && AudioEngine && typeof AudioEngine.clearDeckBuffer === 'function') {
        try { AudioEngine.clearDeckBuffer(deckId); } catch (_) {}
      }
      if (options.detachMedia !== false) {
        try { audio.pause(); } catch (_) {}
        try { audio.removeAttribute('src'); audio.load(); } catch (_) {}
      }
    }

    function beginLoad(id, sourceKind, pendingPlay) {
      resetSource({ abort: true, clearBuffer: true, detachMedia: true });
      const generation = ++state.loadGeneration;
      const ctrl = new AbortController();
      state.loadAbort = ctrl;
      state.currentVideoId = id;
      state.sourceKind = sourceKind;
      state.lastKnownTime = 0;
      state.refreshCount = 0;
      state.pendingPlay = !!pendingPlay;
      state.wasPlayingBeforeError = !!pendingPlay;
      if (window.state) {
        if (window.state.sourceKind) window.state.sourceKind[deckId] = sourceKind;
        if (window.state.backendMode) window.state.backendMode[deckId] = 'piped';
      }
      if (sourceKind !== 'local') clearLocalMetadata();
      return { generation: generation, signal: ctrl.signal };
    }

    function reportLoadError(err) {
      if (err && err.name === 'AbortError') return;
      const classified = PipedStreams.classifyError(err);
      try {
        onError({ code: 0, message: classified.message || (err && err.message) || 'Erreur du mode DJ.', originalEvent: err });
      } catch (_) {}
    }

    function prepareScratchDecode(AE, buffer, generation, scratchEnabled) {
      if (!AE || typeof AE.loadDeckBufferFromBlob !== 'function') return Promise.resolve(null);
      var promise = new Promise(function (resolve) {
        function decodeWhenReady() {
          audio.removeEventListener('loadedmetadata', decodeWhenReady);
          if (!isCurrent(generation)) return resolve(null);
          AE.loadDeckBufferFromBlob(deckId, buffer).then(resolve, function () { resolve(null); });
        }
        if (audio.readyState >= 1 && audio.duration) {
          decodeWhenReady();
        } else {
          audio.addEventListener('loadedmetadata', decodeWhenReady);
        }
      });
      promise.catch(function () {});
      if (typeof AE.setDeckBufferLoadPromise === 'function') AE.setDeckBufferLoadPromise(deckId, promise);
      return promise;
    }

    function loadDeckArrayBuffer(url, operation, scratchEnabled) {
      const generation = operation.generation;
      const signal = operation.signal;
      if (!isCurrent(generation)) return Promise.resolve(null);
      var _t0 = performance.now();
      var AE = window.AudioEngine;
      var fetcher = (window.LocalAPI && window.LocalAPI.fetch) ? window.LocalAPI.fetch : fetch;

      // Polling de la progression de l'extraction backend tant que la réponse HTTP n'est pas arrivée
      var progressPollTimer = null;
      var isLocalAudio = /^\/api\/audio\//.test(url) || (typeof location !== 'undefined' && url.indexOf(location.origin + '/api/audio/') === 0);
      if (isLocalAudio) {
        var videoIdMatch = url.match(/\/api\/audio\/([a-zA-Z0-9_-]+)/);
        var targetVideoId = videoIdMatch ? videoIdMatch[1] : null;
        if (targetVideoId) {
          progressPollTimer = setInterval(function () {
            if (!isCurrent(generation)) {
              clearInterval(progressPollTimer);
              return;
            }
            fetcher('/api/progress/' + encodeURIComponent(targetVideoId), { signal: signal }).then(function (r) {
              return r.ok ? r.json() : null;
            }).then(function (data) {
              if (!isCurrent(generation) || !data || !data.progress) return;
              var p = data.progress;
              if (window.DeckTransport && typeof window.DeckTransport.setDownloadProgress === 'function') {
                window.DeckTransport.setDownloadProgress(deckId, p.percent > 0 ? p.percent : null, 0, 0, p.label);
              }
            }).catch(function () {});
          }, 300);
        }
      }

      var full = fetcher(url, { headers: { Range: 'bytes=0-' }, signal: signal }).then(async function (res) {
        if (progressPollTimer) { clearInterval(progressPollTimer); progressPollTimer = null; }
        if (!res.ok && res.status !== 206) {
          var errorMessage = 'download HTTP ' + res.status;
          try {
            if (typeof res.json === 'function') {
              var errData = await res.json();
              if (errData && (errData.error || errData.message)) {
                errorMessage = errData.error || errData.message;
              }
            } else if (typeof res.text === 'function') {
              var errText = await res.text();
              if (errText) errorMessage = errText;
            }
          } catch (e) { /* ignore parse error */ }
          if (window.DeckTransport && typeof window.DeckTransport.setDownloadError === 'function') {
            window.DeckTransport.setDownloadError(deckId, errorMessage);
          }
          throw new Error(errorMessage);
        }
        var mime = res.headers.get('content-type') || 'audio/mpeg';
        var contentLength = res.headers.get('content-length');
        var contentRange = res.headers.get('content-range');
        var total = 0;
        if (contentRange) {
          var m = contentRange.match(/\/(\d+)$/);
          if (m) total = parseInt(m[1], 10);
        }
        if (!total && contentLength) {
          total = parseInt(contentLength, 10);
        }
        if (isNaN(total)) total = 0;

        if (res.body && typeof res.body.getReader === 'function') {
          var reader = res.body.getReader();
          var chunks = [];
          var loaded = 0;
          var lastProgressUpdate = performance.now();
          // Émission immédiate du 1er tick dès la réception de la réponse HTTP
          if (window.DeckTransport && typeof window.DeckTransport.setDownloadProgress === 'function') {
            window.DeckTransport.setDownloadProgress(deckId, total > 0 ? 0 : null, 0, total);
          }
          while (true) {
            var result = await reader.read();
            if (result.done) break;
            if (result.value) {
              chunks.push(result.value);
              loaded += result.value.length || result.value.byteLength || 0;
              var now = performance.now();
              // Mise à jour de l'affichage 1 fois par seconde (1000ms) pour éviter les re-renders excessifs du DOM
              if (now - lastProgressUpdate >= 1000) {
                lastProgressUpdate = now;
                var percent = total > 0 ? Math.min(99, Math.round((loaded / total) * 100)) : null;
                if (window.DeckTransport && typeof window.DeckTransport.setDownloadProgress === 'function') {
                  window.DeckTransport.setDownloadProgress(deckId, percent, loaded, total);
                }
              }
            }
          }
          // Notification à la fin de la réception HTTP : passage au décodage / initialisation
          if (window.DeckTransport && typeof window.DeckTransport.setDownloadProgress === 'function') {
            window.DeckTransport.setDownloadProgress(deckId, null, 0, 0, '⏳ Décodage audio…');
          }
          var combined = new Uint8Array(loaded);
          var offset = 0;
          for (var i = 0; i < chunks.length; i++) {
            combined.set(chunks[i], offset);
            offset += chunks[i].length || chunks[i].byteLength || 0;
          }
          return { buf: combined.buffer, mime: mime };
        } else {
          return res.arrayBuffer().then(function (buf) {
            if (window.DeckTransport && typeof window.DeckTransport.setDownloadProgress === 'function') {
              window.DeckTransport.setDownloadProgress(deckId, null, 0, 0, '⏳ Décodage audio…');
            }
            return { buf: buf, mime: mime };
          });
        }
      }).then(function (r) {
        if (!isCurrent(generation) || !r) return null;
        var blob = new Blob([r.buf], { type: r.mime });
        state.blobUrl = URL.createObjectURL(blob);
        prepareScratchDecode(AE, r.buf, generation, scratchEnabled);
        audio.src = state.blobUrl;
        audio.load();
        // Restaure le titre une fois que l'élément audio a chargé les métadonnées et peut jouer
        audio.addEventListener('loadedmetadata', function onLoaded() {
          audio.removeEventListener('loadedmetadata', onLoaded);
          if (isCurrent(generation) && window.DeckTransport && typeof window.DeckTransport.clearDownloadStatus === 'function') {
            window.DeckTransport.clearDownloadStatus(deckId);
          }
        });
        console.debug('[audio:' + deckId + '] chargé en ' + (performance.now() - _t0).toFixed(0) + 'ms');
        return null;
      }).catch(function (err) {
        if (!isCurrent(generation) || (err && err.name === 'AbortError')) return null;
        var isLocal = /^\/api\//.test(url) || (typeof location !== 'undefined' && url.indexOf(location.origin + '/api/') === 0);
        if (!isLocal) {
          audio.src = url;
          audio.load();
          return null;
        }
        reportLoadError(err);
        return null;
      }).finally(function () {
        if (isCurrent(generation)) {
          state.loadPromise = null;
          state.loadAbort = null;
        }
        if (progressPollTimer) {
          clearInterval(progressPollTimer);
          progressPollTimer = null;
        }
      });
      state.loadPromise = full;
      return full;
    }

    // ===== Gestion de l'expiration =====
    //
    // Quand audio.error est set (URL expirée, 403, réseau coupé, format non
    // supporté), on tente PipedStreams.refreshStream() → nouveau src.
    // On restaure lastKnownTime, on reprend la lecture si elle était active.
    // refreshCount évite les boucles infinies (max 2 tentatives).
    async function handleMediaError() {
      if (!audio.error) return;
      const code = audio.error.code || 0;
      if (!RETRYABLE_AUDIO_ERRORS.has(code)) return; // pas une erreur réseau
      if (state.refreshCount >= 2) {
        // refreshCount atteint avant l'incrément = on a déjà tenté 2 fois
        // sans succès. On signale l'échec définitif.
        const err = {
          code: code,
          message: 'Flux audio indisponible après 2 tentatives de rafraîchissement. '
            + 'Vidéo peut-être expirée ou supprimée.',
          originalEvent: audio.error,
        };
        try { onError(err); } catch (e) { /* ignore */ }
        return;
      }
      state.refreshCount += 1;
      const id = state.currentVideoId;
      if (!id) return;
      try {
        const entry = await PipedStreams.refreshStream(id);
        const newUrl = PipedStreams.getCorsSafeUrl(entry, entry.bestAudio && entry.bestAudio.stream);
        if (!newUrl) {
          throw new Error('Le mode DJ n\'a pas renvoyé d\'URL audio pour ' + id);
        }
        const operation = beginLoad(id, 'youtube', state.wasPlayingBeforeError);
        loadDeckArrayBuffer(newUrl, operation, entry.scratchEligible !== false);
        // Restaurer la position une fois le nouveau buffer prêt.
        audio.addEventListener('loadedmetadata', function once() {
          audio.removeEventListener('loadedmetadata', once);
          try { audio.currentTime = state.lastKnownTime; } catch (e) { /* ignore */ }
          if (state.wasPlayingBeforeError) {
            audio.play().catch(function () { /* autoplay */ });
          }
        }, { once: true });
      } catch (err) {
        const classified = PipedStreams.classifyError(err);
        try {
          onError({
            code: code,
            message: classified.message || 'Erreur de rafraîchissement du flux DJ.',
            originalEvent: audio.error,
          });
        } catch (e) { /* ignore */ }
      }
    }

    // ===== Câblage des événements <audio> =====
    //
    // On écoute le strict nécessaire pour le mapping STATE + la gestion
    // d'erreur. 'timeupdate' sert juste à mémoriser lastKnownTime pour
    // la reprise après refresh (sans déclencher onStateChange — c'est un
    // événement haute fréquence).
    //
    // ⚠️ Bug historique play/pause : les événements 'canplay' /
    // 'canplaythrough' / 'loadeddata' / 'loadedmetadata' sont émis par
    // l'élément <audio> CHAQUE FOIS que suffisamment de données sont
    // bufferisées — y compris en plein playback (re-buffering après un
    // seek, ou quand le buffer se remplit pendant la lecture). Si on
    // signale CUED à ce moment, l'icône revient à '▶' (play) alors que
    // l'audio joue → l'utilisateur clique "play" en pensant que c'est en
    // pause, et le bouton se désynchronise. On ne signale donc CUED que
    // si l'audio est effectivement en pause (pas en lecture). En lecture,
    // on garde l'état PLAYING et on ne rétrograde pas.
    audio.addEventListener('loadstart', function () { reportState(STATE.UNSTARTED); });
    audio.addEventListener('emptied', function () { reportState(STATE.UNSTARTED); });
    audio.addEventListener('loadedmetadata', function () {
      if (audio.paused) reportState(STATE.CUED);
    });
    audio.addEventListener('loadeddata', function () {
      if (audio.paused) reportState(STATE.CUED);
    });
    audio.addEventListener('canplay', function () {
      if (audio.paused) reportState(STATE.CUED);
    });
    audio.addEventListener('canplaythrough', function () {
      if (audio.paused) reportState(STATE.CUED);
    });
    audio.addEventListener('playing', function () { reportState(STATE.PLAYING); });
    audio.addEventListener('pause', function () { reportState(STATE.PAUSED); });
    audio.addEventListener('waiting', function () { reportState(STATE.BUFFERING); });
    audio.addEventListener('stalled', function () { reportState(STATE.BUFFERING); });
    audio.addEventListener('ended', function () { reportState(STATE.ENDED); });

    audio.addEventListener('timeupdate', function () {
      if (isFinite(audio.currentTime)) state.lastKnownTime = audio.currentTime;
    });

    audio.addEventListener('error', function () { handleMediaError(); });

    // canplay → onReady (équivalent de l'événement "lecteur prêt à jouer"
    // de YTWrapper). À ce stade l'audio est bufferisé, on peut appeler
    // play() sans attente supplémentaire. Si pendingPlay est true (l'user
    // a cliqué play avant que le buffer soit prêt, ou a sélectionné un
    // morceau en mode Piped → autoplay demandé), on lance la lecture.
    audio.addEventListener('canplay', function () {
      if (state.refreshCount === 0) {
        // 1er ready de la session — on notifie le caller pour débloquer l'init
        try { onReady({ target: audio }); } catch (e) { /* ignore */ }
      }
      if (state.pendingPlay) {
        state.pendingPlay = false;
        AudioEngine.resume().then(function () {
          audio.play().catch(function () { /* autoplay bloqué */ });
        });
      }
    });

    // ===== Wrapper public =====
    //
    // Mêmes méthodes que YTWrapper.createPlayer. C'est cette interface
    // commune qui permet le dual mode transparent.
    const p = {
      _audio: audio,
      _state: state,
      _ready: false,
      // Drapeau d'autoplay : positionné par le caller (app.js) AVANT
      // loadVideoById pour demander la lecture auto au prochain canplay.
      // Initialisé ici (et non juste posé à la volée) pour que le check
      // `'_pendingPlayRequested' in player` côté app.js fonctionne.
      _pendingPlayRequested: false,

      // loadVideoById(id) → fetch Piped → audio.src = CORS-safe → load()
      // Si autoplay/lecture en cours avant ce load, on la reprend après ready.
      loadVideoById: function (id) {
        if (!id || state.disposed) return;
        const shouldPlay = (p._pendingPlayRequested === true) || (!audio.paused);
        p._pendingPlayRequested = false;
        const operation = beginLoad(id, 'youtube', shouldPlay);
        if (window.DeckTransport && typeof window.DeckTransport.setDownloadProgress === 'function') {
          window.DeckTransport.setDownloadProgress(deckId, 0, 0, 0);
        }
        PipedStreams.fetchStreamInfo(id, operation.signal).then(function (entry) {
          if (!isCurrent(operation.generation)) return;
          const best = entry.bestAudio && entry.bestAudio.stream;
          const newUrl = PipedStreams.getCorsSafeUrl(entry, best);
          if (!newUrl) throw new Error('Aucun flux audio disponible pour cette vidéo.');
          return loadDeckArrayBuffer(newUrl, operation, entry.scratchEligible !== false);
        }).catch(function (err) {
          if (isCurrent(operation.generation)) reportLoadError(err);
        });
      },

      // cueVideoById(id) → comme loadVideoById, mais sans lecture auto.
      // En mode Piped, la différence est uniquement sur le pendingPlay : on
      // ne lance pas la lecture même si playVideo() a été demandé avant.
      cueVideoById: function (id) {
        if (!id || state.disposed) return;
        p._pendingPlayRequested = false;
        const operation = beginLoad(id, 'youtube', false);
        PipedStreams.fetchStreamInfo(id, operation.signal).then(function (entry) {
          if (!isCurrent(operation.generation)) return;
          const best = entry.bestAudio && entry.bestAudio.stream;
          const newUrl = PipedStreams.getCorsSafeUrl(entry, best);
          if (!newUrl) throw new Error('Aucun flux audio disponible.');
          return loadDeckArrayBuffer(newUrl, operation, entry.scratchEligible !== false);
        }).catch(function (err) {
          if (isCurrent(operation.generation)) reportLoadError(err);
        });
      },

      // playVideo() → AudioEngine.resume() puis audio.play()
      // resume() débloque l'AudioContext après le 1er geste utilisateur.
      // On retourne la promesse de play() pour que le caller puisse
      // réagir à un échec (ex: bouton play/pause qui ne se met pas à jour).
      playVideo: function () {
        return AudioEngine.resume().then(function () {
          var pr = audio.play();
          if (pr && typeof pr.catch === 'function') {
            return pr.catch(function (err) {
              // Autoplay bloqué : on signale l'état PAUSED pour que l'UI
              // reste cohérente (le bouton montre 'play' au lieu de 'pause').
              reportState(STATE.PAUSED);
              throw err;
            });
          }
          return undefined;
        });
      },

      pauseVideo: function () { audio.pause(); },

      seekTo: function (sec) {
        try { audio.currentTime = Math.max(0, Number(sec) || 0); } catch (e) { /* ignore */ }
      },

      // setVolume : en mode Piped, le volume est géré par le GainNode du
      // crossfader (AudioEngine.deckGain). On garde cette méthode pour
      // l'interface commune avec YTWrapper, mais elle ne fait rien (la voie
      // est pilotée par Mixer.applyVolumes() → AudioEngine.applyCrossfade).
      setVolume: function () { /* no-op : géré par AudioEngine */ },

      // mute/unMute : sur Piped, on ne mute pas l'élément <audio> (ça
      // stopperait le graphe Web Audio), on met le gain de la voie à 0
      // via AudioEngine.deckGain. On garde la même API que YTWrapper.
      mute: function () {
        state.muted = true;
        audio.volume = 1.0;
        if (AudioEngine && typeof AudioEngine.setMuted === 'function') AudioEngine.setMuted(deckId, true);
      },

      unMute: function () {
        state.muted = false;
        audio.volume = 1.0;
        if (AudioEngine && typeof AudioEngine.setMuted === 'function') AudioEngine.setMuted(deckId, false);
      },

      getCurrentTime: function () {
        return isFinite(audio.currentTime) ? audio.currentTime : 0;
      },

      getDuration: function () {
        const d = audio.duration;
        return isFinite(d) ? d : 0;
      },

      // getPlayerState retourne le dernier état connu (mapping <audio>).
      // Initialisé à UNSTARTED (-1). Le mapping est cohérent avec
      // YTWrapper.STATE — un seul mapping pour toute l'app.
      getPlayerState: function () { return lastReportedState; },

      // loadLocalFile(file) : charge un fichier audio local (MP3, WAV, M4A, …).
      // Pas de réseau : on lit directement le File → ArrayBuffer → Blob +
      // décodage scratch, comme pour un flux YouTube. Même pipeline unifié.
      // Accepte un objet File (input[type=file] ou showOpenFilePicker) ou un
      // Blob déjà en mémoire. La piste est marquée currentVideoId='local' pour
      // que le scratch sache qu'il n'y a pas de re-fetch Piped à faire.
      loadLocalFile: function (file) {
        if (!file) return Promise.reject(new Error('loadLocalFile: fichier manquant'));
        if (typeof file === 'string') {
          const operation = beginLoad('local', 'local', false);
          if (!isCurrent(operation.generation)) return Promise.resolve();
          audio.src = file;
          audio.load();
          return Promise.resolve();
        }
        if (file.size > 256 * 1024 * 1024) {
          return Promise.reject(new Error('Fichier local trop volumineux (maximum 256 Mo).'));
        }
        const operation = beginLoad('local', 'local', false);
        var AE = window.AudioEngine;
        var full = file.arrayBuffer().then(function (rawBuf) {
          if (!isCurrent(operation.generation)) return null;
          var mime = file.type || 'audio/mpeg';
          state.blobUrl = URL.createObjectURL(new Blob([rawBuf.slice(0)], { type: mime }));
          // Stocke le buffer brut complet sur le player pour les découpes de scratch ultérieures
          state.localArrayBuffer = rawBuf;
          
          prepareScratchDecode(AE, rawBuf.slice(0), operation.generation, true);
          audio.addEventListener('loadedmetadata', function validateDuration() {
            audio.removeEventListener('loadedmetadata', validateDuration);
            var max = (window.YT_CONFIG && window.YT_CONFIG.MAX_TRACK_DURATION_SEC) || 14400;
            if (Number(audio.duration) > max && isCurrent(operation.generation)) {
              resetSource({ abort: true, clearBuffer: true, detachMedia: true });
              reportLoadError(new Error('Cette piste dépasse la limite de ' + Math.round(max / 60) + ' minutes.'));
            }
          });
          audio.src = state.blobUrl;
          audio.load();
          var fileName = file.name || 'audio-local';
          var meta = window.extractAudioMetadata ? window.extractAudioMetadata(rawBuf.slice(0), mime, fileName) : { title: fileName, artist: '' };
          var playerObj = window.state && window.state.players ? window.state.players[deckId] : null;
          if (playerObj) {
            playerObj.lastLocalTitle = meta.title || fileName;
            playerObj.lastLocalArtist = meta.artist || '';
            playerObj.lastLocalFileName = fileName;
            playerObj.lastLocalCover = window.extractCoverImage ? window.extractCoverImage(rawBuf.slice(0), mime) : null;
          }
          if (typeof window.updateNowPlaying === 'function') window.updateNowPlaying(deckId);
          return null;
        }).finally(function () {
          if (isCurrent(operation.generation)) state.loadPromise = null;
        });
        state.loadPromise = full;
        return full;
      },

      dispose: function () {
        if (state.disposed) return;
        state.disposed = true;
        state.loadGeneration += 1;
        resetSource({ abort: true, clearBuffer: true, detachMedia: true });
        clearLocalMetadata();
        try { if (audio.parentNode) audio.parentNode.removeChild(audio); } catch (_) {}
      },

      // Accès techniques (debug / tests)
      _getAudioElement: function () { return audio; },
      _getState: function () { return state; },
    };

    // Si videoId fourni à la création → on lance loadVideoById après
    // que la chaîne soit prête. Mais le caller préfère souvent appeler
    // loadVideoById() lui-même au moment de onReady → on laisse ce
    // comportement à l'app.js (cohérent avec youtube.js).
    // (Pas d'auto-load ici, voir comment YTWrapper.createPlayer gère : il
    // passe videoId au constructeur de YT.Player qui cue auto.)

    return p;
  }

  // ===== API publique =====
  window.AudioPlayer = {
    createAudioPlayer: createAudioPlayer,
    STATE: STATE,
    // Pour tests / introspection
    _audioEventToState: audioEventToState,
  };
})();

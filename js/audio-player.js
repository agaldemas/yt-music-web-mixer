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
      // Position de lecture mémorisée pour reprise après refresh d'URL
      lastKnownTime: 0,
      // Vrai si playVideo() a été demandé pendant loading (à appliquer au ready)
      pendingPlay: false,
      // Vrai si on a déclenché une lecture avant que l'AudioEngine soit prêt
      wasPlayingBeforeError: false,
      // Compteur de refresh (anti-boucle en cas d'URL toujours invalide)
      refreshCount: 0,
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
        audio.src = newUrl;
        audio.load();
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
    audio.addEventListener('loadstart', function () { reportState(STATE.UNSTARTED); });
    audio.addEventListener('emptied', function () { reportState(STATE.UNSTARTED); });
    audio.addEventListener('loadedmetadata', function () { reportState(STATE.CUED); });
    audio.addEventListener('loadeddata', function () { reportState(STATE.CUED); });
    audio.addEventListener('canplay', function () { reportState(STATE.CUED); });
    audio.addEventListener('canplaythrough', function () { reportState(STATE.CUED); });
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
        // 1er ready de la session — on notifie le caller
        try { onReady({ target: audio }); } catch (e) { /* ignore */ }
      }
      if (state.pendingPlay) {
        state.pendingPlay = false;
        // resume() débloque l'AudioContext (politique autoplay) AVANT play().
        // Sans cela, l'AudioContext reste suspended et le son ne sort pas.
        AudioEngine.resume().then(function () {
          var pr = audio.play();
          if (pr && typeof pr.catch === 'function') {
            pr.catch(function (err) {
              // Autoplay peut être bloqué si l'AudioContext n'a pas encore
              // été débloqué par un geste utilisateur. On retente une fois
              // après un court délai — le geste de sélection de recherche
              // compte normalement comme interaction.
              setTimeout(function () {
                audio.play().catch(function () { /* échec définitif — silencieux */ });
              }, 150);
            });
          }
        }).catch(function () {
          // resume() a échoué : on tente quand même le play (le son sortira
          // peut-être en direct si le contexte est déjà actif).
          audio.play().catch(function () { /* silencieux */ });
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
        if (!id) return;
        state.currentVideoId = id;
        state.lastKnownTime = 0;
        state.refreshCount = 0;
        // On capture l'intention d'autoplay MAINTENANT (avant le fetch réseau)
        // pour éviter une race : si le caller a posé _pendingPlayRequested=true
        // juste avant cet appel, on le gèle dans pendingPlay. Sinon, si l'audio
        // joue déjà, on veut reprendre après le changement de src.
        state.pendingPlay = (p._pendingPlayRequested === true) || (!audio.paused);
        p._pendingPlayRequested = false;
        // Si l'audio joue actuellement, on mémorise pour reprendre après load.
        state.wasPlayingBeforeError = !audio.paused;

        PipedStreams.fetchStreamInfo(id).then(function (entry) {
          const best = entry.bestAudio && entry.bestAudio.stream;
          const newUrl = PipedStreams.getCorsSafeUrl(entry, best);
          if (!newUrl) {
            const err = {
              code: 0,
              message: 'Aucun flux audio disponible pour cette vidéo.',
              originalEvent: null,
            };
            try { onError(err); } catch (e) { /* ignore */ }
            return;
          }
          audio.src = newUrl;
          audio.load();
        }).catch(function (err) {
          const classified = PipedStreams.classifyError(err);
          const uiErr = {
            code: 0,
            message: classified.message || 'Erreur du mode DJ.',
            originalEvent: err,
          };
          try { onError(uiErr); } catch (e) { /* ignore */ }
        });
      },

      // cueVideoById(id) → comme loadVideoById, mais sans lecture auto.
      // En mode Piped, la différence est uniquement sur le pendingPlay : on
      // ne lance pas la lecture même si playVideo() a été demandé avant.
      cueVideoById: function (id) {
        if (!id) return;
        state.currentVideoId = id;
        state.lastKnownTime = 0;
        state.refreshCount = 0;
        state.wasPlayingBeforeError = false;
        p._pendingPlayRequested = false;

        PipedStreams.fetchStreamInfo(id).then(function (entry) {
          const best = entry.bestAudio && entry.bestAudio.stream;
          const newUrl = PipedStreams.getCorsSafeUrl(entry, best);
          if (!newUrl) {
            try {
              onError({ code: 0, message: 'Aucun flux audio disponible.', originalEvent: null });
            } catch (e) { /* ignore */ }
            return;
          }
          audio.src = newUrl;
          audio.load();
        }).catch(function (err) {
          const classified = PipedStreams.classifyError(err);
          try {
            onError({
              code: 0,
              message: classified.message || 'Erreur du mode DJ.',
              originalEvent: err,
            });
          } catch (e) { /* ignore */ }
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
        const chain = AudioEngine.hasDeck(deckId);
        if (!chain) return;
        // On ne mute pas via le gain master ni crossfade : on stocke
        // l'état mute séparément et on l'applique dans applyVolumes().
        // Pour cette implémentation de section 3, on agit directement
        // sur deckGain en gardant en mémoire l'ancienne valeur via
        // window.__mutedDecks (state global simple). L'intégration avec
        // mixer.js (section 5) remplacera cette logique par un GainNode
        // de mute dédié.
        state.muted = true;
        // Fixe le gain de deck à 0 (mute). Le crossfader reprendra la
        // main au prochain applyVolumes(). Cf. note en commentaire.
        // Note : pour une vraie séparation mute/crossfade, il faudra
        // un muteGain séparé dans audio-engine.js (voir roadmap).
        try {
          const chainRef = AudioEngine.getAnalyser(deckId) && AudioEngine.getContext();
          // Accès indirect via l'AudioEngine : on tire deckGain via
          // un accesseur interne. Pour l'instant, on agit sur l'élément
          // audio (volume natif) en complément :
          audio.volume = 0;
        } catch (e) { /* ignore */ }
      },

      unMute: function () {
        state.muted = false;
        audio.volume = 1.0;
        // ⚠️ Le caller (app.js) appellera Mixer.applyVolumes() après
        // unMute() pour ré-appliquer le crossfade.
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
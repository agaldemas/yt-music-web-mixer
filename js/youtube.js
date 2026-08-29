/* youtube.js — wrapper YouTube IFrame API (simplifié)
 *
 * Charge l'API IFrame YouTube et expose YTWrapper.createPlayer().
 * Les créations de lecteurs sont mises en file tant que l'API n'est pas prête.
 *
 * Pas de soucis CORS avec l'IFrame API : le script est chargé via <script>,
 * le lecteur est un <iframe>, et la communication passe par postMessage.
 * Aucun de ces mécanismes n'est soumis à CORS.
 */
(function () {
  var CFG = window.YT_CONFIG;

  var _ready = false;
  var _queue = [];
  var _onApiError = null;
  var _loading = false;

  var ERROR_MESSAGES = {
    2: 'Paramètre de vidéo invalide.',
    5: 'Erreur de lecture HTML5.',
    100: 'Vidéo supprimée, privée ou inaccessible.',
    101: 'Intégration refusée par le propriétaire.',
    150: 'Contenu restreint (intégration non autorisée).',
  };

  // Charge le script de l'API IFrame (une seule fois)
  function loadApi() {
    if (window.YT && window.YT.Player) {
      _ready = true;
      flushQueue();
      return;
    }

    if (_loading) return;
    _loading = true;
    var tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.onerror = function () {
      if (_onApiError) _onApiError('Impossible de charger le script YouTube IFrame.');
    };
    document.head.appendChild(tag);

    // Timeout : si l'API n'est pas prête après 10s, une dernière vérification
    // (certains bloqueurs interceptent le callback global mais laissent le script)
    setTimeout(function () {
      if (_ready) return;
      if (window.YT && window.YT.Player) {
        _ready = true;
        flushQueue();
      } else if (_onApiError) {
        _onApiError(
          'Impossible de charger YouTube. Vérifier votre connexion ou les bloqueurs de pub.'
        );
      }
    }, CFG.API_LOAD_TIMEOUT_MS);
  }

  function flushQueue() {
    var q = _queue;
    _queue = [];
    q.forEach(function (fn) {
      try { fn(); } catch (e) { /* erreur individuelle ignorée */ }
    });
  }

  // Callback global requis par l'API IFrame YouTube
  window.onYouTubeIframeAPIReady = function () {
    _ready = true;
    flushQueue();
  };

  // createPlayer(elementId, { videoId, onReady, onStateChange, onError })
  // Retourne un wrapper avec les méthodes de contrôle.
  function createPlayer(elementId, opts) {
    opts = opts || {};
    var videoId = opts.videoId || '';
    var onReady = opts.onReady || function () {};
    var onStateChange = opts.onStateChange || function () {};
    var onError = opts.onError || function () {};

    // mute:1 au démarrage → autorise l'autoplay malgré la politique du navigateur
    var playerVars = Object.assign({ mute: 1 }, CFG.PLAYER_VARS);
    // origin uniquement en http(s) — en file:// il vaut "null" → erreur 153
    if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
      playerVars.origin = window.location.origin;
    }

    // Wrapper minimal — délègue vers YT.Player quand _ready passe à true
    var p = {
      _yt: null,
      _ready: false,
      _disposed: false,
      loadVideoById: function (id) { if (this._ready) this._yt.loadVideoById(id); },
      cueVideoById: function (id) { if (this._ready) this._yt.cueVideoById(id); },
      playVideo: function () { if (this._ready) this._yt.playVideo(); },
      pauseVideo: function () { if (this._ready) this._yt.pauseVideo(); },
      seekTo: function (sec) { if (this._ready) this._yt.seekTo(sec, true); },
      setVolume: function (v) { if (this._ready) this._yt.setVolume(v); },
      mute: function () { if (this._ready) this._yt.mute(); },
      unMute: function () { if (this._ready) this._yt.unMute(); },
      getCurrentTime: function () { return this._ready ? this._yt.getCurrentTime() : 0; },
      getDuration: function () { return this._ready ? this._yt.getDuration() : 0; },
      getPlayerState: function () { return this._ready ? this._yt.getPlayerState() : -1; },
      dispose: function () {
        if (this._disposed) return;
        this._disposed = true;
        this._ready = false;
        if (this._yt && typeof this._yt.destroy === 'function') {
          try { this._yt.destroy(); } catch (_) {}
        }
        this._yt = null;
      },
    };

    function build() {
      if (p._disposed) return;
      p._yt = new window.YT.Player(elementId, {
        videoId: videoId,
        playerVars: playerVars,
        events: {
          onReady: function (e) {
            if (p._disposed) { try { e.target.destroy(); } catch (_) {} return; }
            p._ready = true;
            onReady(e);
          },
          onStateChange: function (event) { if (!p._disposed) onStateChange(event); },
          onError: function (e) {
            var code = (e && e.data) || 0;
            onError({
              code: code,
              message: ERROR_MESSAGES[code] || 'Erreur de lecture YouTube inconnue.',
              originalEvent: e,
            });
          },
        },
      });
    }

    if (_ready && window.YT && window.YT.Player) {
      build();
    } else {
      _queue.push(build);
    }

    return p;
  }

  function init(onApiError) {
    _onApiError = onApiError || null;
    loadApi();
  }

  window.YTWrapper = {
    init: init,
    createPlayer: createPlayer,
    isReady: function () { return _ready; },
    STATE: {
      UNSTARTED: -1, ENDED: 0, PLAYING: 1,
      PAUSED: 2, BUFFERING: 3, CUED: 5,
    },
    ERROR_MESSAGES: ERROR_MESSAGES,
  };
})();

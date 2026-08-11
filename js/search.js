/* search.js — recherche YouTube Data API + fallback URL/ID + affichage résultats
 *
 * Module pur vanilla. Expose window.YTSearch avec :
 *   - create(deck, { onSelect, onError }) : instance de recherche par voie
 *   - extractVideoId(input)              : parse une URL ou un ID brut
 *   - parseISODuration(iso)              : "PT3M45S" → "3:45"
 *   - getApiKey() / setApiKey(key)       : localStorage
 *   - UI_STATE                           : { IDLE, LOADING, RESULTS, ERROR, NO_RESULTS }
 */

(function () {
  const CFG = window.YT_CONFIG;

  // ===== Constantes =====

  const UI_STATE = {
    IDLE: 'idle',
    LOADING: 'loading',
    RESULTS: 'results',
    ERROR: 'error',
    WARNING: 'warning', // état non bloquant (pas de clé API, quota dépassé…)
    NO_RESULTS: 'no-results',
  };

  const API_BASE = 'https://www.googleapis.com/youtube/v3';

  // ===== Helpers =====

  // Échappement HTML basique (titres, messages d'erreur)
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Garde uniquement les URLs http(s) (sécurité pour <img src>)
  function safeImgUrl(url) {
    if (!url) return '';
    return (/^https?:\/\//.test(url)) ? escapeHtml(url) : '';
  }

  // Convertit une durée ISO 8601 (PT3M45S) en M:SS ou H:MM:SS
  function parseISODuration(iso) {
    if (!iso) return '';
    const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
    if (!m) return '';
    const h = parseInt(m[1] || '0', 10);
    const min = parseInt(m[2] || '0', 10);
    const s = parseInt(m[3] || '0', 10);
    if (h > 0) return h + ':' + String(min).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    return min + ':' + String(s).padStart(2, '0');
  }

  // Extrait un videoId depuis une URL YouTube ou un ID brut (11 caractères typiquement)
  function extractVideoId(input) {
    if (!input) return null;
    const s = String(input).trim();
    if (!s) return null;

    // ID brut (6 à 15 caractères alphanumériques, tirets, underscores)
    if (/^[a-zA-Z0-9_-]{6,15}$/.test(s)) return s;

    // youtu.be/<id>
    let m = /youtu\.be\/([a-zA-Z0-9_-]{6,15})/.exec(s);
    if (m) return m[1];

    // youtube.com/watch?v=<id> (ou /shorts/<id>, /embed/<id>)
    m = /[?&]v=([a-zA-Z0-9_-]{6,15})/.exec(s)
      || /\/embed\/([a-zA-Z0-9_-]{6,15})/.exec(s)
      || /\/shorts\/([a-zA-Z0-9_-]{6,15})/.exec(s);
    if (m) return m[1];

    return null;
  }

  // Lit la clé API depuis localStorage
  function getApiKey() {
    try { return localStorage.getItem(CFG.STORAGE_KEYS.API_KEY) || ''; }
    catch (e) { return ''; }
  }

  // Écrit / supprime la clé API dans localStorage
  function setApiKey(key) {
    try {
      if (key) localStorage.setItem(CFG.STORAGE_KEYS.API_KEY, key);
      else localStorage.removeItem(CFG.STORAGE_KEYS.API_KEY);
    } catch (e) { /* localStorage indisponible */ }
  }

  // Sauvegarde une valeur dans localStorage (best-effort)
  function persist(key, value) {
    try {
      if (value === null || value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) { /* ignore */ }
  }

  // ===== Rendu =====

  // Construit le DOM d'un résultat (bouton cliquable : vignette + titre + durée)
  function buildResultEl(video, onSelect, onMarkPlayed) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'search-result';
    btn.dataset.videoId = video.id;
    btn.setAttribute('aria-label', 'Charger ' + video.title);

    const thumbs = video.thumbnails || {};
    const thumb = thumbs.medium || thumbs.high || thumbs.default || {};
    const thumbUrl = safeImgUrl(thumb.url);

    let html = '';
    if (thumbUrl) {
      html += '<img class="search-result-thumb" src="' + thumbUrl + '" alt="" loading="lazy" />';
    } else {
      html += '<div class="search-result-thumb search-result-thumb-empty" aria-hidden="true">🎵</div>';
    }
    html += '<div class="search-result-info">';
    html += '<span class="search-result-title">' + escapeHtml(video.title) + '</span>';
    if (video.duration) {
      html += '<span class="search-result-duration">' + escapeHtml(video.duration) + '</span>';
    }
    html += '</div>';

    btn.innerHTML = html;
    btn.addEventListener('click', function () {
      // On NE vide PAS le panneau de résultats après sélection : on conserve
      // la grille pour que l'utilisateur puisse changer de piste rapidement.
      // Le panneau sera remplacé à la prochaine recherche, ou vidé via "✕ Effacer".
      onSelect(video.id);
      if (typeof onMarkPlayed === 'function') onMarkPlayed(video.id);
    });
    return btn;
  }

  // Rendu du panneau selon l'état UI (data-state sur .deck-results)
  function renderPanel(panelEl, state, payload) {
    panelEl.dataset.state = state;
    panelEl.innerHTML = '';

    switch (state) {
      case UI_STATE.IDLE:
        return;
      case UI_STATE.LOADING:
        panelEl.innerHTML = '<div class="search-state search-state-loading">⏳ Recherche en cours…</div>';
        return;
      case UI_STATE.RESULTS:
        // Les vidéos sont appendChild() après l'appel renderPanel(RESULTS)
        return;
      case UI_STATE.NO_RESULTS:
        panelEl.innerHTML = '<div class="search-state search-state-no-results">'
          + escapeHtml(payload || 'Aucun résultat pour cette recherche.') + '</div>';
        return;
      case UI_STATE.WARNING:
        panelEl.innerHTML = '<div class="search-state search-state-warning">⚠️ '
          + escapeHtml(payload || 'Avertissement.') + '</div>';
        return;
      case UI_STATE.ERROR:
        panelEl.innerHTML = '<div class="search-state search-state-error">⚠️ '
          + escapeHtml(payload || 'Erreur inconnue.') + '</div>';
        return;
    }
  }

  // ===== Appels API =====

  // /search?part=snippet&type=video&videoCategoryId=10&q=...&key=...
  async function callSearchApi(query, apiKey, signal, pageToken) {
    const params = new URLSearchParams({
      part: 'snippet',
      type: 'video',
      videoCategoryId: '10', // Musique
      q: query,
      maxResults: '10',
      key: apiKey,
    });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await fetch(API_BASE + '/search?' + params.toString(), { signal });
    if (!res.ok) {
      // On tente de lire le body d'erreur pour classer précisément
      let body = {};
      try { body = await res.json(); } catch (e) { /* body non JSON */ }
      const code = (body.error && body.error.code) || res.status;
      const reason = (body.error && body.error.message) || res.statusText;
      const err = new Error(reason);
      err.code = code;
      err.kind = 'api';
      throw err;
    }
    return res.json();
  }

  // /videos?part=contentDetails&id=ID1,ID2,... — pour les durées
  async function callVideosApi(videoIds, apiKey, signal) {
    if (!videoIds.length) return {};
    const params = new URLSearchParams({
      part: 'contentDetails',
      id: videoIds.join(','),
      key: apiKey,
    });
    const res = await fetch(API_BASE + '/videos?' + params.toString(), { signal });
    if (!res.ok) return {};
    const data = await res.json();
    const map = {};
    (data.items || []).forEach(function (item) {
      const iso = item.contentDetails && item.contentDetails.duration;
      map[item.id] = parseISODuration(iso);
    });
    return map;
  }

  // Transforme une erreur brute en message localisé + type
  function classifyError(err) {
    if (err && err.name === 'AbortError') {
      return { kind: 'abort', message: '' };
    }
    if (err && err.code === 400) {
      return { kind: 'invalid-key', message: 'Clé API invalide. Vérifier la clé dans ⚙️ Paramètres.' };
    }
    if (err && (err.code === 403 || err.code === 429)) {
      return { kind: 'quota', message: 'Quota API dépassé ou clé non autorisée. Réessayer plus tard, '
        + 'ou utiliser une URL YouTube (youtu.be/…).' };
    }
    if (err && err.kind === 'api') {
      return { kind: 'api', message: 'Erreur API YouTube (' + err.code + '). Réessayer plus tard.' };
    }
    // Erreur réseau / CORS / fetch a échoué
    return { kind: 'network', message: 'Impossible de contacter l\'API YouTube (réseau ou CORS). '
      + 'Servir l\'app via un serveur local (python3 -m http.server) '
      + 'ou coller directement une URL YouTube.' };
  }

  // ===== Factory par voie =====

  function createDeckSearch(deck, callbacks) {
    callbacks = callbacks || {};
    const onSelect = callbacks.onSelect || function () {};
    const onError = callbacks.onError || function () {};

    const panelEl = document.querySelector('.deck-results[data-deck="' + deck + '"]');
    const inputEl = document.querySelector('.search-input[data-deck="' + deck + '"]');
    const btnEl = document.querySelector('.search-btn[data-deck="' + deck + '"]');

    if (!panelEl || !inputEl || !btnEl) {
      // Pas d'éléments DOM = on ne peut rien faire. Retourne une instance no-op.
      return {
        search: function () {},
        clear: function () {},
        setApiKey: setApiKey,
        getApiKey: getApiKey,
        UI_STATE: UI_STATE,
      };
    }

    let abortController = null;
    var prevPageToken = null;
    var nextPageToken = null;
    var lastQuery = '';

    function setState(state, payload) {
      renderPanel(panelEl, state, payload);
      syncToolbar(state);
    }

    // Marque un résultat comme "en cours de lecture" (badge ▶).
    // Appelé après chaque sélection et au reload si lastVideoId est connu.
    function markActive(videoId) {
      if (!videoId) return;
      panelEl.querySelectorAll('.search-result.is-active').forEach(function (el) {
        el.classList.remove('is-active');
        const badge = el.querySelector('.search-result-badge');
        if (badge) badge.remove();
      });
      const el = panelEl.querySelector('.search-result[data-video-id="' + videoId + '"]');
      if (!el) return;
      el.classList.add('is-active');
      // Ajoute un badge "▶ En cours" si pas déjà présent
      if (!el.querySelector('.search-result-badge')) {
        const badge = document.createElement('span');
        badge.className = 'search-result-badge';
        badge.textContent = '▶ En cours';
        el.appendChild(badge);
      }
    }

    // Barre d'outils résultats : boutons pagination ‹ › + bouton effacer ✕
    var SVG_PREV = '<svg viewBox="0 0 12 12" width="12" height="12" fill="currentColor"><polygon points="10,1 2,6 10,11"/></svg>';
    var SVG_NEXT = '<svg viewBox="0 0 12 12" width="12" height="12" fill="currentColor"><polygon points="2,1 10,6 2,11"/></svg>';

    function ensureToolbar() {
      var toolbar = panelEl.parentElement.querySelector('.deck-results-toolbar[data-deck="' + deck + '"]');
      if (toolbar) return toolbar;
      toolbar = document.createElement('div');
      toolbar.className = 'deck-results-toolbar';
      toolbar.dataset.deck = deck;
      toolbar.hidden = true;

      var prevBtn = document.createElement('button');
      prevBtn.type = 'button';
      prevBtn.className = 'deck-nav-btn deck-nav-prev';
      prevBtn.setAttribute('aria-label', 'Résultats précédents');
      prevBtn.title = 'Résultats précédents';
      prevBtn.innerHTML = SVG_PREV;
      prevBtn.addEventListener('click', function () { loadPage('prev'); });

      var nextBtn = document.createElement('button');
      nextBtn.type = 'button';
      nextBtn.className = 'deck-nav-btn deck-nav-next';
      nextBtn.setAttribute('aria-label', 'Résultats suivants');
      nextBtn.title = 'Résultats suivants';
      nextBtn.innerHTML = SVG_NEXT;
      nextBtn.addEventListener('click', function () { loadPage('next'); });

      var clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'deck-results-clear';
      clearBtn.setAttribute('aria-label', 'Effacer les résultats de la voie ' + deck);
      clearBtn.title = 'Effacer les résultats';
      clearBtn.textContent = '✕';
      clearBtn.addEventListener('click', function () { clear(); });

      toolbar.appendChild(prevBtn);
      toolbar.appendChild(nextBtn);
      toolbar.appendChild(clearBtn);
      panelEl.insertAdjacentElement('beforebegin', toolbar);
      return toolbar;
    }

    function syncToolbar(state) {
      var toolbar = ensureToolbar();
      if (!toolbar) return;
      toolbar.hidden = state !== UI_STATE.RESULTS;
      var prevBtn = toolbar.querySelector('.deck-nav-prev');
      var nextBtn = toolbar.querySelector('.deck-nav-next');
      if (prevBtn) prevBtn.disabled = !prevPageToken;
      if (nextBtn) nextBtn.disabled = !nextPageToken;
    }

    // Charge la page précédente ou suivante via le pageToken de l'API YouTube
    function loadPage(direction) {
      var token = (direction === 'next') ? nextPageToken : prevPageToken;
      if (!token || !lastQuery) return;
      performSearch(lastQuery, token);
    }

    // Persistance de la dernière requête (par voie)
    function persistQuery(q) {
      const key = (deck === 'A') ? CFG.STORAGE_KEYS.LAST_QUERY_A : CFG.STORAGE_KEYS.LAST_QUERY_B;
      persist(key, q);
    }

    async function performSearch(query, pageToken) {
      query = String(query || '').trim();
      if (!query) {
        if (abortController) abortController.abort();
        setState(UI_STATE.IDLE);
        return;
      }

      // 1) Fallback URL / ID brut : pas besoin de clé API (pas de pagination)
      const directId = extractVideoId(query);
      if (directId) {
        if (abortController) abortController.abort();
        persistQuery(query);
        prevPageToken = null;
        nextPageToken = null;
        setState(UI_STATE.IDLE);
        onSelect(directId);
        return;
      }

      // 2) Sinon, recherche API — il faut une clé
      const apiKey = getApiKey();
      if (!apiKey) {
        // Pas de clé : non bloquant, on affiche un warning et on reste utilisable.
        setState(UI_STATE.WARNING,
          'Aucune clé API configurée — la recherche par mot-clé est indisponible. '
          + 'Coller une URL YouTube (youtu.be/…, watch?v=…) ou un ID vidéo dans le champ, '
          + 'ou ouvrir ⚙️ Paramètres pour ajouter une clé.');
        return;
      }

      // Annuler une recherche précédente en cours
      if (abortController) abortController.abort();
      abortController = new AbortController();
      const signal = abortController.signal;

      setState(UI_STATE.LOADING);
      lastQuery = query;
      persistQuery(query);

      try {
        const data = await callSearchApi(query, apiKey, signal, pageToken);
        // Stocker les tokens de pagination renvoyés par l'API YouTube
        nextPageToken = data.nextPageToken || null;
        prevPageToken = data.prevPageToken || null;
        const items = (data && data.items) || [];
        const videoIds = items
          .map(function (i) { return i.id && i.id.videoId; })
          .filter(Boolean);

        if (!videoIds.length) {
          setState(UI_STATE.NO_RESULTS, 'Aucun résultat pour « ' + query + ' ».');
          return;
        }

        // Durées — best-effort (échec toléré)
        let durations = {};
        try {
          durations = await callVideosApi(videoIds, apiKey, signal);
        } catch (e) {
          if (e && e.name === 'AbortError') return; // nouvelle recherche
          // autre erreur → on continue sans les durées
        }

        const videos = items
          .filter(function (i) { return i.id && i.id.videoId; })
          .map(function (i) {
            const id = i.id.videoId;
            return {
              id: id,
              title: (i.snippet && i.snippet.title) || 'Sans titre',
              thumbnails: (i.snippet && i.snippet.thumbnails) || {},
              duration: durations[id] || '',
            };
          });

        if (!videos.length) {
          setState(UI_STATE.NO_RESULTS, 'Aucun résultat valide.');
          return;
        }

        setState(UI_STATE.RESULTS);
        videos.forEach(function (v) {
          panelEl.appendChild(buildResultEl(
            v,
            function (id) { onSelect(id); },
            markActive
          ));
        });
      } catch (err) {
        const info = classifyError(err);
        if (info.kind === 'abort') return; // silencieux, une nouvelle requête a pris le relais
        // Quota / rate limiting : non bloquant. L'utilisateur peut retenter
        // ou coller une URL directement. On affiche un warning, pas une erreur.
        if (info.kind === 'quota') {
          setState(UI_STATE.WARNING, info.message);
          onError(info);
          return;
        }
        setState(UI_STATE.ERROR, info.message);
        onError(info);
      }
    }

    function clear() {
      if (abortController) abortController.abort();
      prevPageToken = null;
      nextPageToken = null;
      lastQuery = '';
      setState(UI_STATE.IDLE);
      inputEl.value = '';
    }

    // Wire input + bouton
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        performSearch(inputEl.value);
      }
    });
    btnEl.addEventListener('click', function () {
      performSearch(inputEl.value);
    });

    // État initial = idle (data-state pour le CSS)
    setState(UI_STATE.IDLE);

    return {
      search: performSearch,
      clear: clear,
      markActive: markActive,
      setApiKey: setApiKey,
      getApiKey: getApiKey,
      UI_STATE: UI_STATE,
    };
  }

  // ===== API publique =====
  window.YTSearch = {
    create: createDeckSearch,
    extractVideoId: extractVideoId,
    parseISODuration: parseISODuration,
    getApiKey: getApiKey,
    setApiKey: setApiKey,
    UI_STATE: UI_STATE,
  };
})();
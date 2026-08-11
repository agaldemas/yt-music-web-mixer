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
      case UI_STATE.ERROR:
        panelEl.innerHTML = '<div class="search-state search-state-error">⚠️ '
          + escapeHtml(payload || 'Erreur inconnue.') + '</div>';
        return;
    }
  }

  // ===== Appels API =====

  // /search?part=snippet&type=video&videoCategoryId=10&q=...&key=...
  async function callSearchApi(query, apiKey, signal) {
    const params = new URLSearchParams({
      part: 'snippet',
      type: 'video',
      videoCategoryId: '10', // Musique
      q: query,
      maxResults: '10',
      key: apiKey,
    });
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

    function setState(state, payload) {
      renderPanel(panelEl, state, payload);
      syncClearButton(state);
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

    // Bouton "✕ Effacer les résultats" : visible uniquement en état 'results'.
    function ensureClearButton() {
      let btn = panelEl.parentElement.querySelector('.deck-results-clear[data-deck="' + deck + '"]');
      if (btn) return btn;
      // On l'insère juste avant le panneau (dans .deck-search ou son parent)
      const container = panelEl.parentElement;
      if (!container) return null;
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'deck-results-clear';
      btn.dataset.deck = deck;
      btn.setAttribute('aria-label', 'Effacer les résultats de la voie ' + deck);
      btn.title = 'Effacer les résultats';
      btn.textContent = '✕';
      btn.hidden = true;
      btn.addEventListener('click', function () {
        clear();
      });
      panelEl.insertAdjacentElement('beforebegin', btn);
      return btn;
    }

    function syncClearButton(state) {
      const btn = ensureClearButton();
      if (!btn) return;
      btn.hidden = state !== UI_STATE.RESULTS;
    }

    // Persistance de la dernière requête (par voie)
    function persistQuery(q) {
      const key = (deck === 'A') ? CFG.STORAGE_KEYS.LAST_QUERY_A : CFG.STORAGE_KEYS.LAST_QUERY_B;
      persist(key, q);
    }

    async function performSearch(query) {
      query = String(query || '').trim();
      if (!query) {
        if (abortController) abortController.abort();
        setState(UI_STATE.IDLE);
        return;
      }

      // 1) Fallback URL / ID brut : pas besoin de clé API
      const directId = extractVideoId(query);
      if (directId) {
        if (abortController) abortController.abort();
        persistQuery(query);
        setState(UI_STATE.IDLE);
        onSelect(directId);
        return;
      }

      // 2) Sinon, recherche API — il faut une clé
      const apiKey = getApiKey();
      if (!apiKey) {
        setState(UI_STATE.ERROR,
          'Aucune clé API configurée. Ouvrir ⚙️ Paramètres pour en ajouter une, '
          + 'ou coller une URL YouTube (youtu.be/…) dans le champ.');
        return;
      }

      // Annuler une recherche précédente en cours
      if (abortController) abortController.abort();
      abortController = new AbortController();
      const signal = abortController.signal;

      setState(UI_STATE.LOADING);
      persistQuery(query);

      try {
        const data = await callSearchApi(query, apiKey, signal);
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
        setState(UI_STATE.ERROR, info.message);
        onError(info);
      }
    }

    function clear() {
      if (abortController) abortController.abort();
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
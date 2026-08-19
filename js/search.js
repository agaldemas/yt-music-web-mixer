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

  // Instances Piped + timeout : partagés avec piped-streams.js (cf. config.js).
  // Sentinelle de pageToken : "première page" Piped. Elle se recharge via
  // /search (qui n'accepte pas de token), pas via /nextpage/search.
  const PIPED_INSTANCES = CFG.PIPED_INSTANCES || [];
  const PIPED_INSTANCE_TIMEOUT_MS = CFG.PIPED_INSTANCE_TIMEOUT_MS || 8000;
  const PIPED_FIRST_PAGE = '__piped_first__';

  // ===== Helpers =====

  // Convertit une durée en secondes vers "M:SS" ou "H:MM:SS"
  function secondsToDuration(total) {
    const s = parseInt(total, 10);
    if (isNaN(s) || s < 0) return '';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
    return m + ':' + String(sec).padStart(2, '0');
  }

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

  // Extrait un videoId depuis une URL YouTube ou un ID brut.
  // Un ID YouTube brut fait exactement 11 caractères ; une chaîne plus courte
  // (ex. « africando ») reste donc une requête de recherche.
  function extractVideoId(input) {
    if (!input) return null;
    const s = String(input).trim();
    if (!s) return null;

    // ID brut YouTube (11 caractères alphanumériques, tirets, underscores).
    if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;

    // youtu.be/<id>
    let m = /youtu\.be\/([a-zA-Z0-9_-]{11})(?:[?&#/]|$)/.exec(s);
    if (m) return m[1];

    // youtube.com/watch?v=<id> (ou /shorts/<id>, /embed/<id>)
    m = /[?&]v=([a-zA-Z0-9_-]{11})(?:[?&#/]|$)/.exec(s)
      || /\/embed\/([a-zA-Z0-9_-]{11})(?:[?&#/]|$)/.exec(s)
      || /\/shorts\/([a-zA-Z0-9_-]{11})(?:[?&#/]|$)/.exec(s);
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

  // Mode PipedSearch : forcer la recherche via l'API Piped même si une clé
  // API YouTube est configurée. Utile pour préserver le quota Google ou quand
  // l'API officielle est bloquée. Persisté en localStorage (global, pas par voie).
  function isPipedForced() {
    try { return localStorage.getItem(CFG.STORAGE_KEYS.FORCE_PIPED) === '1'; }
    catch (e) { return false; }
  }

  function setPipedForced(forced) {
    try {
      if (forced) localStorage.setItem(CFG.STORAGE_KEYS.FORCE_PIPED, '1');
      else localStorage.removeItem(CFG.STORAGE_KEYS.FORCE_PIPED);
    } catch (e) { /* ignore */ }
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
    if (video.uploaderName) {
      html += '<span class="search-result-uploader">' + escapeHtml(video.uploaderName) + '</span>';
    }
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

  // Message d'avertissement inline (affiché au-dessus des résultats conservés,
  // par exemple quand une page suivante Piped échoue).
  function buildInlineWarning(message) {
    const div = document.createElement('div');
    div.className = 'search-state search-state-warning search-state-inline';
    div.textContent = '⚠️ ' + message;
    return div;
  }

  // Message d'avertissement inline (affiché au-dessus des résultats conservés,
  // par exemple quand une page suivante Piped échoue).
  function buildInlineWarning(message) {
    const div = document.createElement('div');
    div.className = 'search-state search-state-warning search-state-inline';
    div.textContent = '⚠️ ' + message;
    return div;
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

  // ===== Recherche sans clé via Piped API =====
  //
  // Piped est un frontend YouTube alternatif qui expose une API JSON publique
  // avec CORS activé. On n'a pas besoin de clé Google. On envoie la requête
  // de l'utilisateur, on récupère une liste de vidéos (videoId, titre,
  // vignette, durée, auteur), et on les affiche comme les résultats YouTube
  // Data API. Essai en cascade sur plusieurs instances (elles tombent souvent).

  // fetch() avec timeout : abandonne après ms millisecondes.
  function fetchWithTimeout(url, ms, signal) {
    // Combiner le signal d'abort externe (nouvelle recherche) avec un timeout
    // propre à cette instance : si le serveur ne répond pas vite, on passe à
    // la suivante plutôt que de bloquer l'utilisateur.
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, ms);
    if (signal) {
      if (signal.aborted) ctrl.abort();
      else signal.addEventListener('abort', function () { ctrl.abort(); });
    }
    return fetch(url, {
      signal: ctrl.signal,
      headers: { 'Accept': 'application/json' },
    }).finally(function () { clearTimeout(timer); });
  }

  // Appelle une instance Piped et renvoie { videos, nextpage }.
  // - Sans nextpageToken : GET /search?q=… (première page)
  // - Avec nextpageToken : GET /nextpage/search?nextpage=…&q=… (page suivante,
  //   le token venant du champ `nextpage` de la page précédente).
  // Ref. OpenAPI Piped : /search et /nextpage/search (paramètres nextpage, q, filter).
  async function callPipedInstance(instance, query, signal, nextpageToken) {
    const url = nextpageToken
      ? 'https://' + instance + '/nextpage/search?nextpage=' + encodeURIComponent(nextpageToken)
        + '&q=' + encodeURIComponent(query) + '&filter=videos'
      : 'https://' + instance + '/search?q=' + encodeURIComponent(query) + '&filter=videos';
    const res = await fetchWithTimeout(url, PIPED_INSTANCE_TIMEOUT_MS, signal);
    if (!res.ok) {
      const err = new Error('Piped ' + instance + ' HTTP ' + res.status);
      err.code = res.status;
      throw err;
    }
    const data = await res.json();
    const items = (data && data.items) || [];
    const videos = items.map(function (it) {
      const id = extractVideoId(it.url) || '';
      // La vignette passe souvent par un proxy Piped (proxy.<instance>/vi/ID/...).
      // On garde l'URL telle quelle (safeImgUrl validera le https://).
      return {
        id: id,
        title: it.title || 'Sans titre',
        uploaderName: it.uploaderName || '',
        thumbnails: {
          medium: it.thumbnail ? { url: it.thumbnail } : null,
          high: it.thumbnail ? { url: it.thumbnail } : null,
          default: it.thumbnail ? { url: it.thumbnail } : null,
        },
        duration: secondsToDuration(it.duration),
      };
    }).filter(function (v) { return !!v.id; });
    // Token de page suivante (null sur la dernière page)
    return { videos: videos, nextpage: (data && data.nextpage) || null };
  }

  // Essaie chaque instance Piped en cascade, renvoie le premier résultat non
  // vide : { videos, nextpage, instance }. Si toutes échouent, lance une
  // erreur (kind 'network' ou 'piped-nextpage' si c'est une page suivante).
  // Pour une page suivante (nextpageToken fourni), on retente d'abord
  // l'instance qui a servi la page courante (le token vient d'elle), puis on
  // retombe sur la cascade si elle ne répond plus.
  async function callPipedSearch(query, signal, nextpageToken, preferredInstance) {
    const instances = PIPED_INSTANCES.slice();
    if (preferredInstance) {
      const idx = instances.indexOf(preferredInstance);
      if (idx > 0) {
        instances.splice(idx, 1);
        instances.unshift(preferredInstance);
      } else if (idx === -1) {
        instances.unshift(preferredInstance);
      }
    }
    let lastErr = null;
    for (let i = 0; i < instances.length; i++) {
      const instance = instances[i];
      try {
        const page = await callPipedInstance(instance, query, signal, nextpageToken);
        if (page.videos.length) {
          page.instance = instance; // première instance qui répond + résultats
          return page;
        }
        // instance OK mais 0 résultats → on continue au cas où une autre ait
        // une meilleure indexation (rare, mais coûte peu)
        lastErr = new Error('Piped ' + instance + ' : aucun résultat');
      } catch (err) {
        if (err && err.name === 'AbortError') throw err; // nouvelle recherche/recherche annulée
        lastErr = err;
        // instance suivante
      }
    }
    const err = new Error(lastErr ? lastErr.message : 'Toutes les instances Piped ont échoué.');
    // Kind 'piped*' → messages adaptés dans classifyError :
    // - première page : aucune instance n'a répondu
    // - page suivante : token possiblement invalide d'une instance à l'autre
    err.kind = nextpageToken ? 'piped-nextpage' : 'piped';
    throw err;
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
    // Mode PipedSearch : échec du chargement d'une page suivante (les tokens
    // nextpage sont propres à chaque instance et peuvent expirer).
    if (err && err.kind === 'piped-nextpage') {
      return { kind: 'piped-nextpage', message: 'Page suivante indisponible via Piped '
        + '(instance injoignable ou token expiré). Réessayer avec › ou relancer la recherche.' };
    }
    // Mode PipedSearch : aucune instance publique n'a répondu.
    if (err && err.kind === 'piped') {
      return { kind: 'piped', message: 'Aucune instance publique Piped n\'a répondu (réseau ou CORS). '
        + 'Réessayer plus tard, ou coller directement une URL YouTube (youtu.be/…).' };
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
    const onSearchStart = callbacks.onSearchStart || function () {};

    const panelEl = document.querySelector('.deck-results[data-deck="' + deck + '"]');
    const inputEl = document.querySelector('.search-input[data-deck="' + deck + '"]');
    const btnEl = document.querySelector('.search-btn[data-deck="' + deck + '"]');
    const modeBtnEl = document.querySelector('.search-mode-btn[data-deck="' + deck + '"]');
    const clearResultsBtnEl = document.querySelector('.deck-results-clear[data-deck="' + deck + '"]');

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
    // Pagination Piped : l'API n'offre que /nextpage/search (vers l'avant),
    // donc on garde l'historique des tokens des pages visitées + le cache de
    // leurs résultats pour pouvoir revenir en arrière (bouton ‹).
    // pipedHistory[i] = token permettant de (re)charger la page i (0 = page 1
    // = sentinelle PIPED_FIRST_PAGE, qui se recharge via /search).
    var pipedNextpage = null;
    var pipedInstance = null; // instance qui a servi la dernière page réseau
    var pipedHistory = [];
    var pipedPageIndex = 0;
    var pipedPageCache = []; // pipedPageCache[i] = vidéos de la page i
    var pipedCacheQuery = ''; // requête associée au cache
    var lastWasPiped = false; // les résultats affichés viennent de Piped
    var lastActiveId = null; // dernier videoId sélectionné (badge "En cours")
    var resultsCollapsed = false; // panneau replié sans vider son contenu

    function setState(state, payload) {
      renderPanel(panelEl, state, payload);
      syncToolbar(state);
      if (clearResultsBtnEl) {
        clearResultsBtnEl.hidden = state !== UI_STATE.RESULTS
          && state !== UI_STATE.WARNING
          && state !== UI_STATE.ERROR
          && state !== UI_STATE.NO_RESULTS;
      }
    }

    // Marque un résultat comme "en cours de lecture" (badge ▶).
    // Appelé après chaque sélection et au reload si lastVideoId est connu.
    function markActive(videoId) {
      if (!videoId) return;
      lastActiveId = videoId;
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

      var toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'deck-results-toggle';
      toggleBtn.setAttribute('aria-label', 'Masquer les résultats');
      toggleBtn.title = 'Masquer les résultats';
      toggleBtn.textContent = '▲';
      toggleBtn.setAttribute('aria-expanded', 'true');
      toggleBtn.addEventListener('click', function () {
        resultsCollapsed = !resultsCollapsed;
        panelEl.classList.toggle('is-collapsed', resultsCollapsed);
        toggleBtn.textContent = resultsCollapsed ? '▼' : '▲';
        toggleBtn.setAttribute('aria-expanded', resultsCollapsed ? 'false' : 'true');
        toggleBtn.setAttribute('aria-label', resultsCollapsed ? 'Afficher les résultats' : 'Masquer les résultats');
        toggleBtn.title = resultsCollapsed ? 'Afficher les résultats' : 'Masquer les résultats';
      });

      toolbar.appendChild(prevBtn);
      toolbar.appendChild(nextBtn);
      toolbar.appendChild(toggleBtn);
      panelEl.insertAdjacentElement('beforebegin', toolbar);
      if (clearResultsBtnEl) clearResultsBtnEl.addEventListener('click', function () { clear(); });
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

    // Charge la page précédente ou suivante.
    // - API YouTube : pageToken officiel (prev/next fournis par l'API).
    // - Piped : l'API ne va que vers l'avant (/nextpage/search), mais on
    //   conserve l'historique des tokens des pages visitées pour pouvoir
    //   revenir en arrière.
    function loadPage(direction) {
      if (!lastQuery) return;

      if (lastWasPiped) {
        var idx = pipedPageIndex + (direction === 'next' ? 1 : -1);
        var token = pipedHistory[idx];
        // Page suivante jamais visitée → token fourni par la page courante
        if (!token && direction === 'next' && pipedNextpage) token = pipedNextpage;
        if (!token) return;
        // (la sentinelle PIPED_FIRST_PAGE est convertie en page 1 par performSearch)
        performSearch(lastQuery, token);
        return;
      }

      var ytToken = (direction === 'next') ? nextPageToken : prevPageToken;
      if (!ytToken) return;
      performSearch(lastQuery, ytToken);
    }

    // Persistance de la dernière requête (par voie)
    function persistQuery(q) {
      const key = (deck === 'A') ? CFG.STORAGE_KEYS.LAST_QUERY_A : CFG.STORAGE_KEYS.LAST_QUERY_B;
      persist(key, q);
    }

    async function performSearch(query, pageToken) {
      query = String(query || '').trim();
      // Sentinelle "page 1 Piped" → pas de token (on repasse par /search)
      if (pageToken === PIPED_FIRST_PAGE) pageToken = null;
      if (!query) {
        if (abortController) abortController.abort();
        setState(UI_STATE.IDLE);
        return;
      }

      // Toute nouvelle recherche invalide l'erreur de lecture précédente :
      // l'erreur du deck concerne le morceau chargé, pas la recherche.
      onSearchStart(query);

      // 1) Fallback URL / ID brut : pas besoin de clé API (pas de pagination)
      const directId = extractVideoId(query);
      if (directId) {
        if (abortController) abortController.abort();
        persistQuery(query);
        prevPageToken = null;
        nextPageToken = null;
        pipedNextpage = null;
        pipedInstance = null;
        pipedHistory = [];
        pipedPageCache = [];
        pipedPageIndex = 0;
        lastWasPiped = false;
        setState(UI_STATE.IDLE);
        onSelect(directId);
        return;
      }

      // 2) Sinon, recherche par mot-clé.
      //    - Si l'utilisateur a configuré une clé API YouTube Data ET n'a pas
      //      basculé en mode PipedSearch → on utilise l'API officielle
      //      (résultats les plus pertinents pour la musique, pagination officielle).
      //    - Sinon (pas de clé OU mode PipedSearch activé) → API publique Piped
      //      (CORS activé, JSON propre, pas de quota). On obtient quand même
      //      videoId + titre + vignette + durée, comme avec l'API officielle.
      const apiKey = getApiKey();
      const forcePiped = isPipedForced();

      // Annuler une recherche précédente en cours
      if (abortController) abortController.abort();
      abortController = new AbortController();
      const signal = abortController.signal;

      setState(UI_STATE.LOADING);
      lastQuery = query;
      persistQuery(query);

      try {
        let videos;
        if (apiKey && !forcePiped) {
          // Recherche via l'API YouTube Data officielle (résultats musique,
          // pagination par pageToken).
          lastWasPiped = false;
          const data = await callSearchApi(query, apiKey, signal, pageToken);
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

          videos = items
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
        } else {
          // Pas de clé API, OU mode PipedSearch activé par l'utilisateur :
          // API publique Piped. Pagination via /nextpage/search, uniquement
          // vers l'avant côté API → l'historique pipedHistory permet le ‹.
          lastWasPiped = true;

          // Nouvelle recherche (page 1) : réinitialiser historique + cache
          if (!pageToken) {
            pipedHistory = [PIPED_FIRST_PAGE];
            pipedPageCache = [];
            pipedCacheQuery = query;
          }

          // Page déjà visitée ET en cache → restitution immédiate, pas d'appel réseau
          const visitedIdx = pageToken ? pipedHistory.indexOf(pageToken) : 0;
          if (visitedIdx >= 0 && pipedPageCache[visitedIdx] && pipedCacheQuery === query) {
            pipedPageIndex = visitedIdx;
            // Le token "page suivante" : celui historisé si on a déjà avancé
            // depuis cette page, sinon celui renvoyé lors de sa première charge
            nextPageToken = pipedHistory[visitedIdx + 1] || pipedNextpage;
            prevPageToken = visitedIdx > 0 ? pipedHistory[visitedIdx - 1] : null;
            renderPipedPage(pipedPageCache[visitedIdx]);
            return;
          }

          const page = await callPipedSearch(query, signal, pageToken, pipedInstance);
          pipedNextpage = page.nextpage;
          pipedInstance = page.instance;
          videos = page.videos;

          if (!videos.length) {
            setState(UI_STATE.NO_RESULTS, 'Aucun résultat pour « ' + query + ' ».');
            return;
          }

          // Historique : index de la page chargée + token pour la suivante
          if (pageToken) {
            pipedPageIndex = visitedIdx >= 0 ? visitedIdx : pipedHistory.length;
          } else {
            pipedPageIndex = 0;
          }
          pipedHistory[pipedPageIndex] = pageToken || PIPED_FIRST_PAGE;
          pipedPageCache[pipedPageIndex] = videos;
          if (pipedNextpage && !pipedHistory[pipedPageIndex + 1]) {
            pipedHistory[pipedPageIndex + 1] = pipedNextpage;
          }
          prevPageToken = pipedPageIndex > 0 ? pipedHistory[pipedPageIndex - 1] : null;
          nextPageToken = pipedHistory[pipedPageIndex + 1] || null;
        }

        if (!videos.length) {
          setState(UI_STATE.NO_RESULTS, 'Aucun résultat pour « ' + query + ' ».');
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
        // Échec d'un changement de page en mode Piped : on ne perd pas les
        // résultats déjà affichés, on affiche juste un avertissement au-dessus.
        if (info.kind === 'piped-nextpage' && panelEl.querySelectorAll('.search-result').length) {
          panelEl.insertAdjacentElement('afterbegin', buildInlineWarning(info.message));
          syncToolbar(UI_STATE.RESULTS); // toolbar reste visible, ‹ › reflètent l'état courant
          onError(info);
          return;
        }
        // Échec Piped sur la première page : ce n'est pas une erreur de
        // lecture du deck. Le panneau de recherche doit rester le seul endroit
        // qui informe l'utilisateur, sous forme d'avertissement non bloquant.
        if (info.kind === 'piped') {
          setState(UI_STATE.WARNING, info.message);
          onError(info);
          return;
        }
        setState(UI_STATE.ERROR, info.message);
        onError(info);
      }
    }

    // Affiche une page Piped (du cache, sans appel réseau)
    function renderPipedPage(videos) {
      setState(UI_STATE.RESULTS);
      videos.forEach(function (v) {
        panelEl.appendChild(buildResultEl(
          v,
          function (id) { onSelect(id); },
          markActive
        ));
      });
      if (lastActiveId) markActive(lastActiveId);
    }

    function clear() {
      if (abortController) abortController.abort();
      prevPageToken = null;
      nextPageToken = null;
      pipedNextpage = null;
      pipedInstance = null;
      pipedHistory = [];
      pipedPageCache = [];
      pipedPageIndex = 0;
      pipedCacheQuery = '';
      lastWasPiped = false;
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

    // ===== Bouton bascule mode PipedSearch =====
    //
    // Quand une clé API YouTube est présente, ce bouton permet de forcer la
    // recherche via l'API publique Piped (sans consommer de quota Google).
    // Visible uniquement quand une clé API est configurée : sans clé, Piped
    // est déjà le seul chemin, le bouton n'aurait aucun sens.
    function syncModeButton() {
      if (!modeBtnEl) return;
      const hasKey = !!getApiKey();
      const forced = isPipedForced();
      // Sans clé API : on masque le bouton (Piped est déjà le défaut).
      modeBtnEl.hidden = !hasKey;
      modeBtnEl.setAttribute('aria-pressed', forced ? 'true' : 'false');
      if (forced) {
        modeBtnEl.textContent = '🟢 Recherche Piped';
        modeBtnEl.title = 'Recherche via l\'API Piped (sans quota Google). '
          + 'Cliquez pour revenir à l\'API YouTube Data.';
      } else {
        modeBtnEl.textContent = '⚪ YouTube API';
        modeBtnEl.title = 'Recherche via l\'API YouTube Data officielle. '
          + 'Cliquez pour forcer la recherche via Piped (préserve le quota).';
      }
    }

    if (modeBtnEl) {
      modeBtnEl.addEventListener('click', function () {
        setPipedForced(!isPipedForced());
        syncModeButton();
      });
    }
    syncModeButton();

    // État initial = idle (data-state pour le CSS)
    setState(UI_STATE.IDLE);

    return {
      search: performSearch,
      clear: clear,
      markActive: markActive,
      setApiKey: setApiKey,
      getApiKey: getApiKey,
      syncModeButton: syncModeButton,
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
    isPipedForced: isPipedForced,
    setPipedForced: setPipedForced,
    UI_STATE: UI_STATE,
  };
})();

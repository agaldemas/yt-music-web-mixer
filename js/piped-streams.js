/* piped-streams.js — client Piped /streams/{videoId}
 *
 * Module pur vanilla. Expose window.PipedStreams avec :
 *   - fetchStreamInfo(videoId, signal) : récupère les infos + URLs de flux
 *     audio/vidéo pour un videoId, via les instances Piped en cascade.
 *     Retourne { videoId, title, duration, uploader, thumbnailUrl,
 *                audioStreams, videoStreams, proxyUrl, bestAudio, instance }.
 *     bestAudio = { stream, kind: 'audio' | 'video-fallback' } | null
 *   - selectBestAudio(entry)           : choisit le meilleur flux audio.
 *     Prend un entry (ou {audioStreams, videoStreams}) et renvoie
 *     { stream, kind, list } ou null. kind='audio' = flux audio-only
 *     séparé, kind='video-fallback' = MP4 muxé (lu par <audio> quand même).
 *   - buildCorsSafeUrl(stream, proxyUrl) : proxifie via Piped si nécessaire.
 *   - getCorsSafeUrl(entry, stream)    : raccourci (utilise entry.proxyUrl).
 *   - getCachedStream(videoId)         : lit le cache mémoire (sans fetch).
 *   - refreshStream(videoId, signal)   : force un re-fetch (expiration).
 *   - clearCache(videoId?)             : vide le cache (tout, ou un videoId).
 *   - classifyError(err)               : { kind, message } localisé pour l'UI.
 *
 * Conventions : see search.js (camelCase, IIFE, window.X = { ... } exposé).
 */

(function () {
  const CFG = window.YT_CONFIG;

  // ===== Backend d'extraction local (server/server.js — yt-dlp) =====
  //
  // Contourne le blocage anti-bot YouTube des instances Piped publiques.
  // L'extraction yt-dlp tourne en local (IP de l'utilisateur) ; le serveur
  // sert en prime le frontend en statique, donc app + API sont same-origin.
  //
  // On n'active ce backend QUE si l'app est servie en http(s) — l'endpoint
  // /api/streams/:id est relatif et n'existe pas en file://. En cas d'échec
  // (yt-dlp absent, 503, anti-bot, réseau), on retombe sur la cascade Piped.

  function localBackendAvailable() {
    try { return !!(window.LocalAPI && window.LocalAPI.available && window.LocalAPI.available()); }
    catch (_) { return false; }
  }

  // ===== Helpers =====

  // Détecte la signature d'un blocage anti-bot YouTube. Quand YouTube bloque
  // l'IP de l'instance Piped (ou yt-dlp sans résolveur PO-Token) pour
  // certaines vidéos, l'erreur remonte (« Sign in to confirm you're not a
  // bot »). C'est un échec SPÉCIFIQUE À LA VIDÉO/au moment, à distinguer
  // d'une instance vraiment down (502/timeout/réseau).
  function isAntiBotMessage(s) {
    if (!s) return false;
    return /Sign in to confirm|SignInConfirmNotBot|LOGIN_REQUIRED|not a bot/i.test(String(s));
  }


  // Garde uniquement les URLs http(s) (sécurité pour <audio src> / <img src>)
  function safeHttpUrl(url) {
    if (!url) return '';
    return (/^https?:\/\//.test(url)) ? url : '';
  }

  // Convertit une durée en secondes vers "M:SS" ou "H:MM:SS"
  function secondsToDuration(total) {
    const s = Number(total);
    if (!isFinite(s) || s < 0) return '';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
    return m + ':' + String(sec).padStart(2, '0');
  }

  // fetch() avec timeout : abandonne après ms millisecondes. Combine le
  // signal externe (annulation par l'appelant) avec un timeout propre à la
  // requête (si le serveur ne répond pas vite, on enchaîne sur l'instance
  // suivante au lieu de bloquer l'utilisateur).
  function fetchWithTimeout(url, ms, signal) {
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, ms);
    if (signal) {
      if (signal.aborted) ctrl.abort();
      else signal.addEventListener('abort', function () { ctrl.abort(); });
    }
    var fetcher = (window.LocalAPI && window.LocalAPI.fetch) ? window.LocalAPI.fetch : fetch;
    return fetcher(url, {
      signal: ctrl.signal,
      headers: { 'Accept': 'application/json' },
    }).finally(function () { clearTimeout(timer); });
  }

  // ===== Cache en mémoire =====
  //
  // Forme : { videoId: <entry complet retourné par buildStreamEntry> }
  // où chaque entry contient déjà audioStreams + videoStreams annotés
  // (chacun avec .corsUrl), bestAudio pré-calculé, fetchedAt, expiresAt.
  // Le cache évite les re-fetches pendant la durée de validité estimée
  // (PIPED_STREAM_TTL_MS). À l'expiration, fetchStreamInfo re-fetche
  // automatiquement (le cache est invalidé pour cette entrée).
  const cache = Object.create(null);

  function getCachedStream(videoId) {
    if (!videoId) return null;
    const entry = cache[videoId];
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      delete cache[videoId];
      return null;
    }
    return entry;
  }

  function setCacheEntry(videoId, entry) {
    if (!videoId || !entry) return;
    cache[videoId] = entry;
  }

  function clearCache(videoId) {
    if (videoId) delete cache[videoId];
    else for (const k in cache) delete cache[k];
  }

  // ===== Sélection du meilleur flux audio =====
  //
  // Stratégie en 2 temps :
  // 1. Priorité aux `audioStreams` audio-only séparés (OPUS > M4A > WEBMA,
  //    meilleur bitrate). C'est l'idéal quand l'instance Piped les expose
  //    encore (versions historiques ou self-hosted).
  // 2. Fallback sur les `videoStreams` non `videoOnly: true` (MP4 muxé
  //    audio+vidéo). Les instances Piped récentes (ex: api.piped.private.coffee)
  //    ne renvoient plus que des flux combinés — un <audio> peut quand même
  //    les lire (le décodeur ignore la piste vidéo).
  //
  // On renvoie { stream, kind, list } où `kind` est 'audio' ou 'video-fallback'
  // pour que l'appelant sache ce qu'il a obtenu.

  // Score de préférence de format (plus petit = préféré)
  function formatScore(format, mimeType) {
    const f = (String(format || '') + ' ' + String(mimeType || '')).toLowerCase();
    if (f.indexOf('opus') !== -1 || f.indexOf('webm/opus') !== -1) return 0;
    if (f.indexOf('m4a') !== -1 || f.indexOf('mp4a') !== -1) return 1;
    if (f.indexOf('webma') !== -1 || f.indexOf('webm') !== -1) return 2;
    // MP4 muxé (audio+vidéo combinés) : en dernier recours
    if (f.indexOf('mp4') !== -1 || f.indexOf('mpeg_4') !== -1 || f.indexOf('mpeg4') !== -1) return 5;
    return 10;
  }

  function selectBestAudio(entry) {
    if (!entry) return null;
    const audioList = Array.isArray(entry.audioStreams) ? entry.audioStreams : [];
    const videoList = Array.isArray(entry.videoStreams) ? entry.videoStreams : [];

    // 1) audio-only séparés (préférés)
    const audioOnly = audioList.filter(function (s) { return s && s.url && !s.videoOnly; });
    if (audioOnly.length) {
      audioOnly.sort(function (a, b) {
        const fa = formatScore(a.format, a.mimeType);
        const fb = formatScore(b.format, b.mimeType);
        if (fa !== fb) return fa - fb;
        return (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0);
      });
      return { stream: audioOnly[0], kind: 'audio', list: audioList };
    }

    // 2) Fallback : videoStreams non videoOnly (MP4 muxé, mais lisible en <audio>)
    const muxed = videoList.filter(function (s) { return s && s.url && !s.videoOnly; });
    if (muxed.length) {
      // Préférer le plus petit bitrate (lourd inutile de télécharger 4K pour de l'audio)
      muxed.sort(function (a, b) {
        const ba = Number(a.bitrate) || Infinity;
        const bb = Number(b.bitrate) || Infinity;
        return ba - bb;
      });
      return { stream: muxed[0], kind: 'video-fallback', list: videoList };
    }

    return null;
  }

  // ===== Construction d'URL CORS-safe =====
  //
  // Les flux Piped sont de plusieurs types selon l'instance :
  // - directs (`*.googlevideo.com`) : CORS généralement bloqué → tainted,
  //   AnalyserNode reçoit du silence.
  // - proxifiés "classiques" (`pipedproxy.<instance>` dans le hostname) :
  //   CORS `*` activé par Piped, OK pour Web Audio API.
  // - proxifiés "inline" (`proxy.<instance>/videoplayback?...` ou
  //   `proxy.<instance>/...?url=...`) : certaines instances récentes
  //   (ex: api.piped.private.coffee) renvoient directement des URLs déjà
  //   proxifiées (CORS `*` dans les headers).
  //
  // On détecte tous ces formats et on proxifie via `proxyUrl` UNIQUEMENT si
  // l'URL pointe vers un CDN externe direct. Si elle est déjà servie par
  // un proxy Piped (quel que soit le format), on la garde telle quelle.

  function isProxiedUrl(url) {
    if (typeof url !== 'string') return false;
    // Proxy "classique" dans le hostname
    if (url.indexOf('pipedproxy.') !== -1) return true;
    // Proxy "inline" : hostname commence par "proxy." et finit par ".piped.*"
    // ou contient "/videoplayback" (chemin YouTube CDN proxifié)
    if (/^https?:\/\/proxy\.[^/]*piped\./.test(url)) return true;
    if (url.indexOf('/videoplayback?') !== -1 && /proxy\./.test(url)) return true;
    return false;
  }

  function isDirectUrl(url) {
    if (typeof url !== 'string') return false;
    return /\.googlevideo\.com/.test(url)
      || /\.youtube\.com/.test(url)
      || /\.odycdn\.com/.test(url)  // CDN Odysee/LBRY — pas de CORS depuis le browser
      || /\.lbry\.com/.test(url);
  }

  function buildCorsSafeUrl(stream, proxyUrl) {
    if (!stream || !stream.url) return '';
    const original = stream.url;
    // Déjà proxifié (peu importe le format) → utilisable directement
    if (isProxiedUrl(original)) return original;
    // CDN externe direct → proxifier via Piped
    if (isDirectUrl(original) && proxyUrl) {
      const base = proxyUrl.replace(/\/+$/, '');
      // Format du proxy Piped : {base}/?url={encoded} (le plus courant).
      // Si ça échoue côté instance (HTTP 500), audio-player.js émettra une
      // erreur → refreshStream() sera appelé, ce qui re-fetcher une autre
      // instance.
      return base + '/?url=' + encodeURIComponent(original);
    }
    // URL inconnue : on tente telle quelle. Si elle échoue en CORS, l'élément
    // <audio> émettra une erreur → audio-player.js appellera refreshStream.
    return original;
  }

  // ===== Appels API =====

  // GET /api/streams/{videoId} sur le backend local (server/server.js → yt-dlp).
  // Même contrat de retour que callStreamsInstance (JSON compatible Piped) mais
  // l'URL audio renvoyée est déjà relative/same-origin (/api/audio/:id), donc
  // buildCorsSafeUrl la garde telle quelle (ni direct ni proxifiée) → le
  // navigateur la résout en same-origin, Web Audio n'est pas tainted.
  // `instance` est marqué 'local' pour distinguer la source dans l'entry.
  async function callLocalStreams(videoId, signal) {
    const url = '/api/streams/' + encodeURIComponent(videoId);
    let res;
    try {
      res = await fetchWithTimeout(url, CFG.LOCAL_BACKEND_TIMEOUT_MS, signal);
    } catch (err) {
      const e = new Error('Backend local : ' + (err.message || 'fetch failed'));
      e.code = 0;
      throw e;
    }
    if (!res.ok) {
      let reason = '';
      try { reason = await res.text(); } catch (_) { /* corps illisible */ }
      let parsed = reason;
      try { parsed = (JSON.parse(reason).error) || reason; } catch (_) { /* keep raw */ }
      const e = new Error('Backend local HTTP ' + res.status
        + (parsed ? ' — ' + String(parsed).slice(0, 140) : ''));
      e.code = res.status;
      e.reason = String(parsed).slice(0, 200);
      e.isAntiBot = isAntiBotMessage(parsed);
      throw e;
    }
    let data;
    try {
      data = await res.json();
    } catch (err) {
      const e = new Error('Backend local : réponse non JSON');
      e.code = -1;
      throw e;
    }
    if (!data || data.audioAvailable === false || !Array.isArray(data.audioStreams) || !data.audioStreams.length) {
      const e = new Error('Backend local : aucun flux pour ' + videoId);
      e.code = -2;
      throw e;
    }
    return data;
  }


  // GET /streams/{videoId} sur une instance Piped.
  // Retourne la réponse JSON brute (audioStreams, videoStreams, etc.).
  // Lance une erreur typée si l'instance échoue (timeout, HTTP non-2xx, JSON
  // invalide, ou réponse sans audioStreams — signal typique d'une vidéo
  // supprimée/privée sur cette instance).
  async function callStreamsInstance(instance, videoId, signal) {
    const url = 'https://' + instance + '/streams/' + encodeURIComponent(videoId);
    let res;
    try {
      res = await fetchWithTimeout(url, CFG.PIPED_INSTANCE_TIMEOUT_MS, signal);
    } catch (err) {
      const e = new Error('Piped ' + instance + ' : ' + (err.message || 'fetch failed'));
      e.code = 0;
      throw e;
    }
    if (!res.ok) {
      // On lit le corps : Piped renvoie souvent un JSON d'erreur applicatif
      // (ex: anti-bot YouTube "Sign in to confirm you're not a bot", vidéo
      // supprimée…). Garder ce motif permet à classifyError() de distinguer
      // un blocage anti-bot (instance vivante, vidéo bloquée) d'une instance
      // vraiment down (502/timeout) — et d'afficher un message clair au lieu
      // d'un cryptique "HTTP 500".
      let reason = '';
      try { reason = await res.text(); } catch (_) { /* corps illisible */ }
      let parsed = reason;
      try { parsed = (JSON.parse(reason).error) || reason; } catch (_) { /* keep raw */ }
      const e = new Error('Piped ' + instance + ' HTTP ' + res.status
        + (parsed ? ' — ' + String(parsed).slice(0, 140) : ''));
      e.code = res.status;
      e.reason = String(parsed).slice(0, 200);
      e.isAntiBot = isAntiBotMessage(parsed);
      throw e;
    }
    let data;
    try {
      data = await res.json();
    } catch (err) {
      const e = new Error('Piped ' + instance + ' : réponse non JSON');
      e.code = -1;
      throw e;
    }
    // Piped renvoie parfois un objet d'erreur (ex: vidéo supprimée) sans
    // audioStreams. On traite ça comme un échec d'instance (l'instance
    // suivante peut avoir un cache différent).
    if (!data || (!data.audioStreams && !data.videoStreams)) {
      const e = new Error('Piped ' + instance + ' : aucun flux pour ' + videoId);
      e.code = -2;
      throw e;
    }
    return data;
  }

  // Essaie chaque instance Piped en cascade pour /streams/{videoId}. Renvoie
  // la première réponse valide enrichie avec `instance`. Si toutes échouent,
  // lance une erreur (kind 'piped-streams') que l'appelant peut classer.
  //
  // `videoId` est normalisé (11 caractères alphanumériques + - _). On
  // refuse les entrées manifestement invalides avec une erreur 'invalid-id'.
  function normalizeVideoId(videoId) {
    if (!videoId) return null;
    const s = String(videoId).trim();
    if (/^[a-zA-Z0-9_-]{6,15}$/.test(s)) return s;
    return null;
  }

  async function fetchStreamInfo(videoId, signal) {
    const id = normalizeVideoId(videoId);
    if (!id) {
      const err = new Error('videoId invalide');
      err.kind = 'invalid-id';
      throw err;
    }

    // 1) Cache hit → on ressert l'entrée telle quelle, sans toucher au réseau.
    // L'appelant peut forcer un re-fetch via refreshStream().
    const cached = getCachedStream(id);
    if (cached) return cached;

    // 2) Backend local d'abord (yt-dlp), quand l'app est servie en http(s).
    // C'est la voie privilégiée : l'extraction tourne sur l'IP de l'utilisateur,
    // contourne l'anti-bot qui frappe les instances Piped, et l'audio relayé
    // en same-origin évite le taint Web Audio. En cas d'échec (yt-dlp absent,
    // 503, anti-bot, réseau), on retombe sur la cascade Piped ci-dessous.
    let localErr = null;
    if (localBackendAvailable()) {
      try {
        const data = await callLocalStreams(id, signal);
        const entry = buildStreamEntry(id, 'local', data);
        setCacheEntry(id, entry);
        return entry;
      } catch (err) {
        if (err && err.name === 'AbortError') throw err; // annulé par l'appelant
        localErr = err;
        // on continue sur la cascade Piped
      }
    }

    // 3) Cascade d'instances Piped.
    const instances = (CFG.PIPED_INSTANCES || []).slice();
    let lastErr = null;
    for (let i = 0; i < instances.length; i++) {
      const instance = instances[i];
      try {
        const data = await callStreamsInstance(instance, id, signal);
        const entry = buildStreamEntry(id, instance, data);
        setCacheEntry(id, entry);
        return entry;
      } catch (err) {
        if (err && err.name === 'AbortError') throw err; // annulé par l'appelant
        lastErr = err;
        // instance suivante
      }
    }

    // Aucune source n'a marché. On privilégie l'erreur la plus parlante :
    // l'anti-bot (local ou Piped) explique POURQUOI la vidéo est bloquée et
    // oriente l'utilisateur vers le mode IFrame. Sinon on garde la dernière
    // erreur Piped, ou à défaut l'erreur locale.
    const antibotErr = (localErr && localErr.isAntiBot) ? localErr
      : (lastErr && lastErr.isAntiBot) ? lastErr : null;
    const baseErr = lastErr || localErr;
    const err = new Error(antibotErr
      ? (antibotErr.message)
      : (baseErr ? baseErr.message : 'Aucune source disponible pour /streams/' + id));
    err.kind = 'piped-streams';
    err.videoId = id;
    // Propage la signature anti-bot : utile à l'app (probe) et à classifyError.
    err.isAntiBot = !!antibotErr;
    err.reason = (antibotErr && antibotErr.reason) || (baseErr && baseErr.reason);
    throw err;
  }

  // Construit l'objet mis en cache et renvoyé à l'appelant à partir de la
  // réponse Piped brute. Normalise les champs, sélectionne les flux et
  // construit les URLs CORS-safe.
  function buildStreamEntry(videoId, instance, data) {
    const audioStreams = Array.isArray(data.audioStreams) ? data.audioStreams.slice() : [];
    const videoStreams = Array.isArray(data.videoStreams) ? data.videoStreams.slice() : [];
    const proxyUrl = safeHttpUrl(data.proxyUrl || '');
    const title = String(data.title || '').trim();
    const uploader = String(data.uploader || data.uploaderName || '').trim();
    const duration = secondsToDuration(data.duration);
    const thumbnailUrl = safeHttpUrl(
      (data.thumbnailUrl && safeHttpUrl(data.thumbnailUrl))
      || (data.thumbnails && safeHttpUrl(data.thumbnails))
      || ''
    );

    // Pré-calcul des URLs CORS-safe pour CHAQUE flux (audio + vidéo non
    // videoOnly), pour que l'appelant puisse switcher entre flux sans
    // recalculer. On enrichit chaque stream avec .corsUrl.
    function annotate(streams) {
      for (let i = 0; i < streams.length; i++) {
        const s = streams[i];
        s.corsUrl = buildCorsSafeUrl(s, proxyUrl);
      }
    }
    annotate(audioStreams);
    annotate(videoStreams);

    const partial = {
      audioStreams: audioStreams,
      videoStreams: videoStreams,
      proxyUrl: proxyUrl,
    };

    // bestAudio : { stream, kind, list } où `kind` est 'audio' (audio-only
    // séparé, idéal) ou 'video-fallback' (MP4 muxé, lit en <audio> quand
    // même). `null` si aucun flux utilisable → l'appelant doit basculer IFrame.
    const bestAudio = selectBestAudio(partial);

    const fetchedAt = Date.now();
    const expiresAt = fetchedAt + (CFG.PIPED_STREAM_TTL_MS || 0);

    return {
      videoId: videoId,
      title: title,
      duration: duration,
      durationSeconds: Number(data.duration) || 0,
      scratchEligible: (Number(data.duration) || 0) > 0 && (Number(data.duration) || 0) <= (CFG.SCRATCH_MAX_DURATION_SEC || 600),
      uploader: uploader,
      thumbnailUrl: thumbnailUrl,
      audioStreams: audioStreams,
      videoStreams: videoStreams,
      proxyUrl: proxyUrl,
      bestAudio: bestAudio,
      instance: instance,
      fetchedAt: fetchedAt,
      expiresAt: expiresAt,
      // Métadonnées du popup (vues, date ISO, description) — servies par le
      // backend local /api/streams (cache disque). Présentes → le popup les
      // affiche SANS fetch /api/description (zéro requête). Si absentes,
      // search.js retombe sur fetchDescription (fallback Piped).
      views: Number(data.views) || 0,
      uploadDate: String(data.uploadDate || ''),
      uploadDateLabel: formatFrenchDate(data.uploadDate),
      description: String(data.description || '').trim(),
    };
  }

  // Formate une date YouTube (YYYY-MM-DD, YYYYMMDD ou timestamp) en
  // français : "18 avr. 2008". Renvoie '' si invalide. Identique au
  // formateur de search.js (DRY : exporté du module pour réutilisation).
  function formatFrenchDate(input) {
    if (!input) return '';
    let y = 0, m = 0, d = 0;
    const s = String(input).trim();
    let mm = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (mm) { y = +mm[1]; m = +mm[2]; d = +mm[3]; }
    else {
      mm = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
      if (mm) { y = +mm[1]; m = +mm[2]; d = +mm[3]; }
      else {
        const ts = Number(s);
        if (isFinite(ts) && ts > 0 && ts < 1000000000000) {
          const dt = new Date(ts * 1000);
          y = dt.getUTCFullYear(); m = dt.getUTCMonth() + 1; d = dt.getUTCDate();
        }
      }
    }
    if (!y) return '';
    const MONTHS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
    return d + ' ' + (MONTHS_FR[m - 1] || '') + ' ' + y;
  }

  // Helper public : retourne l'URL CORS-safe d'un flux audio donné, ou ''
  // si non disponible. Utilisé par audio-player.js pour construire le src
  // de l'élément <audio>.
  function getCorsSafeUrl(entry, audioStream) {
    if (!entry || !audioStream) return '';
    if (audioStream.corsUrl) return audioStream.corsUrl;
    return buildCorsSafeUrl(audioStream, entry.proxyUrl);
  }

  // Force un re-fetch (ignore le cache). Utilisé par audio-player.js quand
  // l'élément <audio> émet une erreur (URL expirée, 403, network).
  // Renvoie la même forme que fetchStreamInfo et met à jour le cache.
  async function refreshStream(videoId, signal) {
    const id = normalizeVideoId(videoId);
    if (!id) {
      const err = new Error('videoId invalide');
      err.kind = 'invalid-id';
      throw err;
    }
    clearCache(id);
    return fetchStreamInfo(id, signal);
  }

  // ===== Classification des erreurs =====
  //
  // Renvoie { kind, message } adapté pour l'UI. Les kinds courants :
  //   - 'abort'           : requête annulée par l'appelant (silencieux)
  //   - 'invalid-id'      : videoId manquant ou malformé
  //   - 'piped-streams'   : toutes les instances Piped ont échoué
  //   - 'piped-not-found' : aucune instance n'a renvoyé de flux (vidéo
  //                         supprimée/privée probable)
  //   - 'network'         : autre erreur réseau / CORS
  function classifyError(err) {
    if (err && err.name === 'AbortError') {
      return { kind: 'abort', message: '' };
    }
    if (err && err.kind === 'invalid-id') {
      return { kind: 'invalid-id', message: 'Identifiant vidéo invalide.' };
    }
    if (err && err.kind === 'piped-streams') {
      // Blocage anti-bot YouTube : l'instance Piped est vivante, mais YouTube
      // refuse cette vidéo pour son IP ("Sign in to confirm you're not a bot").
      // C'est spécifique à la vidéo/au moment — le mode IFrame (YouTube direct)
      // ou une autre vidéo contourne le blocage.
      if (err.isAntiBot) {
        return {
          kind: 'piped-antibot',
          message: 'YouTube bloque cette vidéo sur l\'instance Piped '
            + '(vérification anti-bot « Sign in to confirm you\'re not a bot »). '
            + 'La lecture Piped n\'est pas possible pour ce titre — '
            + 'passer en mode IFrame (📺, lecture directe YouTube) ou essayer une autre vidéo.',
        };
      }
      return {
        kind: 'piped-streams',
        message: 'Aucun flux Piped disponible pour cette vidéo (réseau, CORS ou vidéo supprimée). '
          + 'Réessayer plus tard, ou utiliser une autre vidéo.',
      };
    }
    return {
      kind: 'network',
      message: 'Impossible de récupérer le flux audio (réseau ou CORS). '
        + 'Réessayer plus tard, ou utiliser une autre vidéo.',
    };
  }

  // ===== API publique =====
  window.PipedStreams = {
    fetchStreamInfo: fetchStreamInfo,
    refreshStream: refreshStream,
    selectBestAudio: selectBestAudio,
    buildCorsSafeUrl: buildCorsSafeUrl,
    getCorsSafeUrl: getCorsSafeUrl,
    getCachedStream: getCachedStream,
    clearCache: clearCache,
    classifyError: classifyError,
    formatFrenchDate: formatFrenchDate,
    // Constantes exportées pour les tests / debug
    FORMATS: { OPUS: 'opus', M4A: 'm4a', WEBMA: 'webma' },
  };
})();
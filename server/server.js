/* server/server.js — Serveur local du mixer (Express)
 *
 * Sert le frontend en statique + 5 routes API pour le mode DJ.
 *
 * PRINCIPE : l'audio YouTube est téléchargé UNE FOIS par morceau via
 * `yt-dlp -x` (qui gère lui-même le contournement des verrous YouTube),
 * extrait en MP3 par ffmpeg, puis CACHÉ sur disque. Les chargements
 * suivants resservent le fichier → instantané. Plus de relais CDN fragile.
 *
 * Routes :
 *   GET /api/health       → { ffmpeg, cache:"disk" }. Pas de yt-dlp ici.
 *   GET /api/streams/:id  → métadonnées (titre, vignette, auteur) via
 *                           oEmbed YouTube. Rapide (~0,15 s). PAS de yt-dlp.
 *                           + views/uploadDate/description (cache disque,
 *                           best-effort) pour le popup.
 *   GET /api/meta/:id     → métadonnées enrichies (vues, date ISO, durée,
 *                           uploader, description). Cache disque : 1re
 *                           génération oEmbed + yt-dlp --skip-download,
 *                           ensuite lecture directe, zéro requête upstream.
 *   GET /api/audio/:id    → sert le MP3. 1er appel : yt-dlp -x + ffmpeg
 *                           (~10-15 s) puis cache disque. Suivants : direct.
 *   GET /api/download/:id → comme /api/audio mais en téléchargement
 *                           (Content-Disposition).
 *   GET /api/description/:id → description seule (cache mémoire 24 h).
 *
 * yt-dlp n'est appelé QUE paresseusement (audio à la 1re demande,
 * métadonnées enrichies à la 1re demande). Le démarrage du serveur ne
 * l'attend pas → l'HTML s'affiche vite.
 *
 * Dépendances : express (npm), yt-dlp + ffmpeg (binaires système).
 *   yt-dlp ≥ nightly 2026.08.18 requis (la stable 2026.07.04 est cassée).
 *   Sans yt-dlp → l'app bascule sur Piped/IFrame.
 *   Sans ffmpeg → yt-dlp -x échoue → 502 sur /api/audio.
 *
 * Cache : ./cache/audio/<videoId>.mp3 et ./cache/meta/<videoId>.json
 * (au .gitignore). Persistant.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const { TaskQueue } = require('./task-queue');
const { createCacheManager } = require('./cache-manager');

let express;
try {
  express = require('express');
} catch (_) {
  console.error('\n[ERREUR] Module "express" introuvable. Lancez :  npm install\n');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 5400;
const HOST = process.env.HOST || '127.0.0.1';
const CACHE_DIR = path.join(__dirname, '..', 'cache', 'audio');
try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch (_) {}

// yt-dlp : appelé paresseusement (uniquement dans extractAudio).
const YTDLP_BIN = process.env.YTDLP_BIN || 'yt-dlp';
let YTDLP_BIN_TIMEOUT_MS = Math.max(10000, Number(process.env.YTDLP_BIN_TIMEOUT_MS) || 600000); // 10 min
const FFMPEG_TIMEOUT_MS = 60000;
let MAX_TRACK_DURATION_SEC = Math.max(60, Number(process.env.MAX_TRACK_DURATION_SEC) || 14400); // 4h
let SCRATCH_MAX_DURATION_SEC = Math.max(60, Number(process.env.SCRATCH_MAX_DURATION_SEC) || 600); // 10 min
const CACHE_MAX_BYTES = Math.max(1024 * 1024, Number(process.env.CACHE_MAX_BYTES) || 2 * 1024 * 1024 * 1024);
const CACHE_MAX_ENTRIES = Math.max(1, Number(process.env.CACHE_MAX_ENTRIES) || 100);
const EXTRACT_CONCURRENCY = Math.max(1, Number(process.env.EXTRACT_CONCURRENCY) || 2);
const EXTRACT_MAX_PENDING = Math.max(1, Number(process.env.EXTRACT_MAX_PENDING) || 16);
const LOCAL_TOKEN = crypto.randomBytes(32).toString('hex');

// Détecte le blocage anti-bot YouTube dans la sortie yt-dlp.
const RE_ANTIBOT = /sign in to confirm|not a bot|botguard|po[-_]?token/i;
const RE_VIDEOID = /^[a-zA-Z0-9_-]{6,15}$/;

// Cookies navigateur : certaines vidéos YouTube exigent une session
// (playability LOGIN_REQUIRED) même avec le client VISIONOS de la nightly.
// yt-dlp lit les cookies du navigateur indiqué. Défaut : chrome (celui de
// l'utilisateur). Désactiver : YTDLP_COOKIES_BROWSER=none.
//   ex : YTDLP_COOKIES_BROWSER=safari  (ou firefox, edge, brave…)
const YTDLP_COOKIES_BROWSER = process.env.YTDLP_COOKIES_BROWSER || 'none';

// Échec d'extraction des cookies NAVIGATEUR (Chrome fermé, trousseau bloqué,
// base verrouillée…) — distinct de l'anti-bot vidéo. Dans ce cas on retente
// l'extraction SANS --cookies-from-browser (certaines vidéos passent quand même).
const RE_COOKIES_ERR = /unable to (extract|retrieve|read).*cookie|could not find.*cookie|failed to decrypt|keyring|keychain|trousseau|not found in (chrome|safari|firefox|edge|brave|opera|arc)/i;

let ffmpegAvailable = null;
let ytdlpAvailable = null;
let httpServer = null;
const extractQueue = new TaskQueue({ concurrency: EXTRACT_CONCURRENCY, maxPending: EXTRACT_MAX_PENDING });
const cacheManager = createCacheManager({ dir: CACHE_DIR, maxBytes: CACHE_MAX_BYTES, maxEntries: CACHE_MAX_ENTRIES });

// Chemin du MP3 en cache pour un videoId.
function cachePathFor(videoId) { return path.join(CACHE_DIR, videoId + '.mp3'); }

// Le fichier de cache existe-t-il et est-il non vide ?
function hasCached(videoId) {
  try {
    const st = fs.statSync(cachePathFor(videoId));
    return st.isFile() && st.size > 0;
  } catch (_) { return false; }
}

// Métadonnées via oEmbed YouTube (PAS de yt-dlp). ~0,15 s, sans clé.
// Renvoie { title, thumbnailUrl, uploader }. duration=0 (oEmbed ne la donne
// pas ; le client la récupère via l'<audio> une fois le MP3 chargé).
function fetchMeta(videoId) {
  return new Promise((resolve, reject) => {
    const oembedUrl = 'https://www.youtube.com/oembed?url='
      + encodeURIComponent('https://www.youtube.com/watch?v=' + videoId)
      + '&format=json';
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 5000);
    fetch(oembedUrl, { signal: ctrl.signal })
      .then((r) => { clearTimeout(to); return r.json(); })
      .then((data) => {
        if (!data || !data.title) {
          const e = new Error('Vidéo indisponible ou oEmbed vide.');
          e.code = 'notfound';
          return reject(e);
        }
        resolve({
          title: String(data.title || '').trim(),
          thumbnailUrl: 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg',
          uploader: String(data.author_name || '').trim(),
          duration: 0,
        });
      })
      .catch((err) => {
        clearTimeout(to);
        const e = new Error('Vidéo indisponible (privée, supprimée ou restreinte).');
        e.code = 'notfound';
        reject(e);
      });
  });
}

// ===== Métadonnées enrichies (vues, date ISO, description) — cache disque =====
//
// L'utilisateur veut éviter les requêtes répétées vers l'upstream (yt-dlp /
// oEmbed / Piped) : chaque info est récupérée UNE fois, écrite sur disque
// dans cache/meta/<videoId>.json, puis servie sans jamais retoucher le
// réseau. C'est la source unique de vérité pour le popup (vues, date,
// description) ET pour l'enrichissement du MP3.
//
// Contenu du JSON : { id, title, uploader, duration, thumbnailUrl, views,
// uploadDate, description, fetchedAt }. Note : `views` sert au popup et à
// /api/meta — il n'est PAS embarqué dans le MP3 (inutile dans un fichier
// audio).
//
// TTL : 24 h succès, 30 min échec (négatif caché, comme descCache).
const META_DIR = path.join(__dirname, '..', 'cache', 'meta');
try { fs.mkdirSync(META_DIR, { recursive: true }); } catch (_) {}
const META_OK_TTL_MS = 24 * 3600 * 1000;
const META_ERR_TTL_MS = 30 * 60 * 1000;
const META_TIMEOUT_MS = 25000;

// Dédup en vol + sérialisation : un seul yt-dlp meta à la fois.
const metaFetching = new Map();   // videoId → Promise
let metaQueue = Promise.resolve(); // chaîne globale

function metaPathFor(videoId) { return path.join(META_DIR, videoId + '.json'); }

// Lit le cache disque. Renvoie l'objet ou null (absent/expiré).
function readMetaCache(videoId) {
  try {
    const raw = fs.readFileSync(metaPathFor(videoId), 'utf8');
    const entry = JSON.parse(raw);
    if (!entry || typeof entry !== 'object') return null;
    const ttl = (entry.ok === false) ? META_ERR_TTL_MS : META_OK_TTL_MS;
    if (!entry.fetchedAt || (Date.now() - entry.fetchedAt) > ttl) return null;
    if (entry.ok === false) return { error: true, message: entry.message || 'Métadonnées indisponibles.', code: entry.code || 'extract' };
    return entry;
  } catch (_) { return null; }
}

// Écrit le cache disque de façon atomique (tmp + rename).
function writeMetaCache(videoId, entry) {
  try {
    const tmp = metaPathFor(videoId) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(entry), 'utf8');
    fs.renameSync(tmp, metaPathFor(videoId));
  } catch (_) { /* non bloquant */ }
}

// Point d'entrée public : renvoie les métadonnées enrichies (cache disque
// prioritaire, génération une fois sinon). Réutilise le pattern de
// fetchVideoDescription (dédup + sérialisation).
function fetchMetaEnriched(videoId) {
  const cached = readMetaCache(videoId);
  if (cached) {
    if (cached.error) {
      const e = new Error(cached.message);
      e.code = cached.code || 'extract';
      return Promise.reject(e);
    }
    return Promise.resolve(cached);
  }
  if (metaFetching.has(videoId)) return metaFetching.get(videoId);

  const p = metaQueue.then(() => runMetaExtract(videoId));
  metaQueue = p.catch(() => {});
  metaFetching.set(videoId, p);
  p.finally(() => metaFetching.delete(videoId)).catch(() => {});
  return p;
}

// Un seul essai de génération : oEmbed (rapide) + yt-dlp --skip-download
// pour views/uploadDate/description. NE télécharge PAS l'audio.
function runMetaExtract(videoId) {
  const result = {};
  // 1) oEmbed : title / uploader / thumbnail (~0,15 s, sans clé).
  return fetchMeta(videoId)
    .then((meta) => {
      result.title = meta.title;
      result.uploader = meta.uploader;
      result.thumbnailUrl = meta.thumbnailUrl;
      return runMetaYtdlp(videoId);
    })
    .then((yt) => {
      result.views = yt.views;
      result.uploadDate = yt.uploadDate;
      result.duration = yt.duration;
      result.description = yt.description;
      result.id = videoId;
      result.fetchedAt = Date.now();
      writeMetaCache(videoId, result);
      return result;
    })
    .catch((err) => {
      // Négatif caché 30 min.
      writeMetaCache(videoId, {
        ok: false, message: err.message || 'Métadonnées indisponibles.',
        code: err.code || 'extract', fetchedAt: Date.now(),
      });
      throw err;
    });
}

// yt-dlp --skip-download --print view_count|upload_date|duration|description.
// Avec cookies navigateur, retry sans cookies si l'extraction des cookies
// échoue (même logique qu'extractAudio). Résout { views, uploadDate,
// duration, description } (valeurs par défaut si champ absent).
function runMetaYtdlp(videoId) {
  const attempt = (withCookies) => new Promise((resolve, reject) => {
    const watchUrl = 'https://www.youtube.com/watch?v=' + encodeURIComponent(videoId);
    const args = [
      '--skip-download',
      '--no-warnings',
      '--no-playlist',
      '--no-cache-dir',
      '--print', '%(view_count)s\u0001%(upload_date)s\u0001%(duration)s',
      '--print', 'description',
      watchUrl,
    ];
    if (withCookies && YTDLP_COOKIES_BROWSER && YTDLP_COOKIES_BROWSER !== 'none') {
      args.splice(0, 0, '--cookies-from-browser', YTDLP_COOKIES_BROWSER);
    }
    const opts = { maxBuffer: 2 * 1024 * 1024, timeout: META_TIMEOUT_MS };
    execFile(YTDLP_BIN, args, opts, (err, stdout) => {
      const out = String(stdout || '');
      if (err && RE_ANTIBOT.test(err.message + '\n' + out)) {
        const e = new Error('YouTube exige une vérification anti-bot.');
        e.code = 'antibot';
        return reject(e);
      }
      if (err) {
        // Erreur d'extraction des cookies → on retente sans cookies.
        if (RE_COOKIES_ERR.test(err.message || '')) return reject({ retryWithoutCookies: true });
        const e = new Error('yt-dlp métadonnées a échoué.');
        e.code = 'extract';
        return reject(e);
      }
      const lines = out.split('\n').map((s) => s.trim());
      // 1re ligne : view_count \x01 upload_date \x01 duration
      const head = (lines.shift() || '').split('\u0001');
      const views = (/^\d+$/.test(head[0] || '')) ? Number(head[0]) : 0;
      const uploadDate = /^\d{8}$/.test(head[1] || '')
        ? head[1].slice(0, 4) + '-' + head[1].slice(4, 6) + '-' + head[1].slice(6, 8)
        : '';
      const duration = (/^\d+$/.test(head[2] || '')) ? Number(head[2]) : 0;
      const description = lines.join('\n').trim();
      resolve({ views, uploadDate, duration, description });
    });
  });

  return attempt(true).catch((err) => {
    if (err && err.retryWithoutCookies) return attempt(false);
    throw err;
  });
}

// Dédup : évite 2 `yt-dlp -x` pour le même videoId (double-clic, decks A+B).
const extracting = new Map();

// Cache mémoire des descriptions (videoId → { desc, ok, fetchedAt }).
// - ok=true : description valide, TTL 24 h
// - ok=false : échec récent (vidéo indisponible/anti-bot) → on NE relance
//   PAS yt-dlp pendant 30 min (évite de saturer le serveur au survol).
const descCache = new Map();
const DESC_OK_TTL_MS = 24 * 3600 * 1000;     // 24 h
const DESC_ERR_TTL_MS = 30 * 60 * 1000;      // 30 min pour un échec
const DESC_TIMEOUT_MS = 25000;               // yt-dlp description, max 25 s

// Dédup en vol + sérialisation : un seul yt-dlp description à la fois.
const descFetching = new Map();   // videoId → Promise (dédup par vidéo)
let descQueue = Promise.resolve(); // chaîne globale → pas de rafale parallèle

function fetchVideoDescription(videoId) {
  const cached = descCache.get(videoId);
  if (cached) {
    const ttl = cached.ok ? DESC_OK_TTL_MS : DESC_ERR_TTL_MS;
    if ((Date.now() - cached.fetchedAt) < ttl) {
      if (!cached.ok) {
        // Échec récent : renvoie l'erreur immédiatement, sans relancer yt-dlp.
        const e = new Error(cached.message || 'Description indisponible.');
        e.code = cached.code || 'extract';
        return Promise.reject(e);
      }
      return Promise.resolve(cached.desc);
    }
  }
  // Dédup : la même vidéo en cours d'extraction partage la promesse.
  if (descFetching.has(videoId)) return descFetching.get(videoId);

  // Sérialisation : attend la fin de l'extraction précédente.
  const p = descQueue.then(() => runDescExtract(videoId));
  descQueue = p.catch(() => {}); // une erreur ne casse pas la chaîne
  descFetching.set(videoId, p);
  // ⚠ consommer la promesse dérivée (unhandledRejection sinon)
  p.finally(() => descFetching.delete(videoId)).catch(() => {});
  return p;
}

// Un seul essai yt-dlp --skip-download --print description.
function runDescExtract(videoId) {
  return new Promise((resolve, reject) => {
    const watchUrl = 'https://www.youtube.com/watch?v=' + encodeURIComponent(videoId);
    const args = [
      '--skip-download',
      '--no-warnings',
      '--no-playlist',
      '--no-cache-dir',
      '--print', 'description',
      watchUrl,
    ];
    if (YTDLP_COOKIES_BROWSER && YTDLP_COOKIES_BROWSER !== 'none') {
      args.splice(0, 0, '--cookies-from-browser', YTDLP_COOKIES_BROWSER);
    }
    const opts = { maxBuffer: 2 * 1024 * 1024, timeout: DESC_TIMEOUT_MS };

    execFile(YTDLP_BIN, args, opts, (err, stdout, stderr) => {
      const combined = String(stderr || '') + '\n' + String(stdout || '');
      if (RE_ANTIBOT.test(combined)) {
        const e = new Error('YouTube exige une vérification anti-bot.');
        e.code = 'antibot';
        descCache.set(videoId, { ok: false, message: e.message, code: 'antibot', fetchedAt: Date.now() });
        return reject(e);
      }
      if (err) {
        const e = new Error('yt-dlp description a échoué.');
        e.code = 'extract';
        descCache.set(videoId, { ok: false, message: e.message, code: 'extract', fetchedAt: Date.now() });
        return reject(e);
      }
      const desc = String(stdout || '').trim();
      descCache.set(videoId, { desc: desc, ok: !!desc, message: desc ? '' : 'Aucune description.', code: 'extract', fetchedAt: Date.now() });
      resolve(desc);
    });
  });
}

// Télécharge + extrait l'audio d'une vidéo vers cache/audio/<id>.mp3.
// C'est le SEUL appel yt-dlp du serveur. yt-dlp -x gère lui-même le
// téléchargement complet et l'extraction ffmpeg. Renvoie le chemin du MP3.
// Stratégie : 1er essai AVEC cookies navigateur (contourne LOGIN_REQUIRED),
// retry SANS cookies si l'extraction des cookies elle-même échoue.
function extractAudio(videoId) {
  if (hasCached(videoId)) {
    // MP3 déjà en cache (extrait une seule fois). On l'enrichit en arrière-
    // plan s'il ne porte pas encore notre commentaire JSON (id/durée/date) :
    // c'est ce qui évite toute requête upstream répétée à l'avenir, et le
    // fichier servi/ téléchargé contient les infos du popup.
    const file = cachePathFor(videoId);
    if (extOf(file) === 'mp3' && !hasMetaStamp(file)) {
      // Non bloquant : le serveur répond avec le fichier actuel ; la
      // réécriture (binaire, ré-encodage zéro) se termine en tâche de fond.
      embedPopupMeta(file, videoId);
    }
    console.log('[extract] ♻ cache disque pour ' + videoId + ' (' + cachePathFor(videoId) + ')');
    return Promise.resolve(file);
  }

  let pending = extracting.get(videoId);
  if (!pending) {
    console.log('[extract] ▶ début extraction ' + videoId);
    pending = extractQueue.add(async () => {
      if (!ffmpegAvailable || !ytdlpAvailable) {
        const e = new Error('Extraction audio indisponible : yt-dlp et ffmpeg sont requis.');
        e.code = !ytdlpAvailable ? 'no-yt-dlp' : 'no-ffmpeg';
        throw e;
      }
      const info = await fetchMetaEnriched(videoId);
      if (!info.duration || info.duration <= 0) {
        const e = new Error('Les lives et les vidéos sans durée ne sont pas supportés en mode DJ.');
        e.code = 'live-not-supported';
        throw e;
      }
      if (info.duration > MAX_TRACK_DURATION_SEC) {
        const e = new Error('Cette piste dépasse la limite de ' + Math.round(MAX_TRACK_DURATION_SEC / 60) + ' minutes.');
        e.code = 'track-too-long';
        throw e;
      }
      return runExtract(videoId, true);
    }).then((file) => cacheManager.prune([file]).then(() => file)).catch((err) => {
      if (RE_COOKIES_ERR.test(err.message || '')) {
        console.warn('[extract] ↻ cookies navigateur indisponibles (' + err.message + ') → retry sans cookies');
        return runExtract(videoId, false);
      }
      throw err;
    });
    // ⚠ La promesse dérivée de finally() doit avoir SON propre gestionnaire
    // de rejet : quand extractAudio rejette (ex. anti-bot), cette copie
    // dérivée rejette AUSSI sans être consommée → unhandledRejection →
    // Node (≥ 15) tue le processus, alors que les handlers /api/audio
    // avaient pourtant catché l'erreur. Le .catch() consomme la copie sans
    // changer `pending` (l'erreur reste propagée aux handlers API).
    pending.finally(() => extracting.delete(videoId)).catch(() => {});
    extracting.set(videoId, pending);
  }
  return pending;
}

// Progression en direct des extractions yt-dlp en cours : videoId -> { percent, stage, updatedAt }
const extractProgress = new Map();

function getExtractProgress(videoId) {
  return extractProgress.get(videoId) || null;
}

// Un seul essai yt-dlp -x (avec ou sans cookies). Logs détaillés pour
// chaque issue. Résout avec le chemin du fichier extrait.
function runExtract(videoId, withCookies) {
  return new Promise((resolve, reject) => {
    const watchUrl = 'https://www.youtube.com/watch?v=' + encodeURIComponent(videoId);
    const outTmpl = path.join(CACHE_DIR, videoId + '.%(ext)s');
    const args = [
      '-x',                       // extract audio (téléchargement + ffmpeg)
      '--audio-format', 'mp3',    // MP3 lisible par <audio> partout
      '--audio-quality', '5',     // ~64-96 kbps, ~5 Mo / 4 min
      '--embed-metadata',         // tags ID3 (title, artist, album, date, genre…) dans le MP3
      '--progress',               // force la sortie de la progression même en mode pipe (non-TTY)
      '--newline',                // émet des retours à la ligne pour le parsing en direct
      '--no-warnings',
      '--no-playlist',
      '--no-cache-dir',
      '-o', outTmpl,
      watchUrl,
    ];
    if (withCookies && YTDLP_COOKIES_BROWSER && YTDLP_COOKIES_BROWSER !== 'none') {
      args.splice(args.indexOf('-x') + 1, 0, '--cookies-from-browser', YTDLP_COOKIES_BROWSER);
    }

    extractProgress.set(videoId, { percent: 0, stage: 'start', updatedAt: Date.now() });

    const proc = spawn(YTDLP_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (_) {}
      const e = new Error('Délai d\'extraction dépassé (' + Math.round(YTDLP_BIN_TIMEOUT_MS / 1000) + 's).');
      e.code = 'extract-timeout';
      extractProgress.delete(videoId);
      reject(e);
    }, YTDLP_BIN_TIMEOUT_MS);

    const onData = (chunk) => {
      const str = chunk.toString();
      stdout += str;
      const lines = str.split(/[\r\n]+/);
      for (const line of lines) {
        const m = line.match(/\[download\]\s+([\d\.]+)%/);
        if (m) {
          const pct = parseFloat(m[1]);
          if (!isNaN(pct)) {
            extractProgress.set(videoId, { percent: Math.min(99, Math.round(pct)), stage: 'download', label: '⏳ Téléchargement… ' + Math.round(pct) + '%', updatedAt: Date.now() });
          }
        } else if (/\[ExtractAudio\]|\[ffmpeg\]/i.test(line)) {
          extractProgress.set(videoId, { percent: 99, stage: 'convert', label: '⏳ Encodage MP3…', updatedAt: Date.now() });
        }
      }
    };

    proc.stdout.on('data', onData);
    proc.stderr.on('data', (chunk) => {
      const str = chunk.toString();
      stderr += str;
      onData(chunk);
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      extractProgress.delete(videoId);
      reject(err);
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      extractProgress.delete(videoId);
      const combined = String(stderr || '') + '\n' + String(stdout || '');

      if (RE_ANTIBOT.test(combined)) {
        const e = new Error('YouTube exige une vérification anti-bot.');
        e.code = 'antibot';
        console.error('[extract] ✗ ANTI-BOT ' + videoId + ' — ' + combined.trim().split('\n').slice(-8).join(' | '));
        return reject(e);
      }
      if (code !== 0) {
        if (/private video|video unavailable|not exist|been removed|not available in your country/i.test(combined)) {
          const e = new Error('Vidéo indisponible.');
          e.code = 'notfound';
          console.error('[extract] ✗ INTROUVABLE ' + videoId + ' — ' + combined.trim().split('\n').slice(-5).join(' | '));
          return reject(e);
        }
        if (/ffmpeg|avconv/i.test(combined) && ffmpegAvailable === false) {
          const e = new Error('ffmpeg est requis pour l\'extraction audio mais n\'est pas trouvé.');
          e.code = 'no-ffmpeg';
          console.error('[extract] ✗ FFMPEG ABSENT ' + videoId);
          return reject(e);
        }
        const e = new Error('yt-dlp -x a échoué : ' + combined.slice(0, 200));
        e.code = 'extract';
        console.error('[extract] ✗ ÉCHEC ' + videoId + ' — ' + combined.trim().split('\n').slice(-5).join(' | '));
        return reject(e);
      }

      if (!hasCached(videoId)) {
        const re = new RegExp('^' + videoId + '\\.(mp3|m4a|opus|webm|aac)$');
        let found = null;
        try {
          for (const f of fs.readdirSync(CACHE_DIR)) {
            if (re.test(f)) { found = path.join(CACHE_DIR, f); break; }
          }
        } catch (_) {}
        if (!found) {
          const e = new Error('yt-dlp a terminé mais aucun fichier audio trouvé dans le cache.');
          e.code = 'extract';
          console.error('[extract] ✗ AUCUN FICHIER ' + videoId + ' — ' + combined.trim().split('\n').slice(-5).join(' | '));
          return reject(e);
        }
        console.log('[extract] ✓ succès ' + videoId + ' → ' + path.basename(found) + ' (' + fmtBytes(fs.statSync(found).size) + ')');
        return settleExtracted(videoId, found, resolve);
      }
      const size = fs.statSync(cachePathFor(videoId)).size;
      console.log('[extract] ✓ succès ' + videoId + ' → ' + path.basename(cachePathFor(videoId)) + ' (' + fmtBytes(size) + ')');
      settleExtracted(videoId, cachePathFor(videoId), resolve);
    });
  });
}

// Taille lisible (octets → Ko/Mo).
function fmtBytes(n) {
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' Mo';
  if (n >= 1024) return (n / 1024).toFixed(0) + ' Ko';
  return n + ' o';
}

// ===== Post-extraction : pochette YouTube (APIC) dans le MP3 =====

// Exécute ffmpeg avec une liste d'arguments.
function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, { maxBuffer: 8 * 1024 * 1024, timeout: FFMPEG_TIMEOUT_MS }, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

// Embarque la miniature YouTube dans le MP3 en tant que pochette (APIC/ID3).
// Télécharge hqdefault depuis i.ytimg.com puis ffmpeg pour l'insérer.
// Non bloquant : toute erreur est loggée, l'audio reste servi sans pochette.
function embedThumbnail(mp3Path, videoId) {
  return new Promise((resolve) => {
    const thumbUrl = 'https://i.ytimg.com/vi/' + encodeURIComponent(videoId) + '/hqdefault.jpg';
    const opId = crypto.randomBytes(6).toString('hex');
    const thumbPath = path.join(CACHE_DIR, videoId + '.' + opId + '.jpg');
    const tmpPath = path.join(CACHE_DIR, videoId + '.' + opId + '.cover.mp3');
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 5000);
    fetch(thumbUrl, { signal: ctrl.signal })
      .then((r) => { clearTimeout(to); if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then((buf) => {
        clearTimeout(to);
        fs.writeFileSync(thumbPath, Buffer.from(buf));
        return runFfmpeg([
          '-y',
          '-i', mp3Path,
          '-i', thumbPath,
          '-map', '0:a',
          '-map_metadata', '0',
          '-map', '1:v',
          '-c:a', 'copy',
          '-c:v', 'mjpeg',
          '-id3v2_version', '3',
          '-metadata:s:v', 'title=Album cover',
          '-metadata:s:v', 'comment=Cover (front)',
          tmpPath,
        ]);
      })
      .then(() => { fs.renameSync(tmpPath, mp3Path); })
      .catch((err) => {
        console.warn('[server] Pochette non embarquée (' + videoId + ') :', err.message || err);
        try { fs.unlinkSync(tmpPath); } catch (_) {}
      })
      .finally(() => {
        clearTimeout(to);
        try { fs.unlinkSync(thumbPath); } catch (_) {}
        resolve();
      });
  });
}

// Après extraction réussie : embarque la pochette si MP3, puis résout.
function settleExtracted(videoId, file, resolve) {
  if (extOf(file) !== 'mp3') { resolve(file); return; }
  embedThumbnail(file, videoId).then(() => embedPopupMeta(file, videoId).then(() => resolve(file)));
}

// ===== Enrichissement du MP3 : commentaire JSON (id/title/uploader/duration/uploadDate) =====
//
// L'utilisateur veut les infos du popup DANS le fichier MP3, dans la limite
// de ~3 ko. Les champs ID3 natifs (title/artist/date/description) sont déjà
// écrits par yt-dlp --embed-metadata, et la pochette YouTube est embarquée
// en APIC par embedThumbnail (AVANT cette étape). On ajoute ici UN
// commentaire JSON compact avec ce qui n'a pas de frame ID3 standard : id
// vidéo, uploader, durée, date de publication ISO. Le nombre de vues n'est
// PAS embarqué (inutile dans un fichier audio).
//
// ⚠ POCHETTE (APIC) : elle est CONSERVÉE telle quelle. On ne fait PAS
// repasser le fichier par ffmpeg pour tagger (ffmpeg -map 0:a droperait la
// frame APIC) : on réécrit le tag ID3 en binaire (parseId3v2 +
// setCommentJson) en ne supprimant que les anciens commentaires COMM, sans
// jamais toucher aux autres frames ni à l'audio (ré-encodage zéro).
//
// Pipelines d'appel :
//   - /api/audio/:id  → extractAudio (mp3 déjà taggé par yt-dlp) → serve.
//   - /api/meta/:id   → fetchMetaEnriched (cache disque) → embedPopupMeta.
//   - mp3 déjà en cache mais sans commentaire JSON → enrichi au 1er /api/audio
//     (embedPopupMeta est idempotent : hasMetaStamp → skip).
function embedPopupMeta(mp3Path, videoId) {
  return new Promise((resolve) => {
    if (hasMetaStamp(mp3Path)) { resolve(); return; } // déjà enrichi, skip
    fetchMetaEnriched(videoId)
      .then((meta) => {
        let payload = JSON.stringify({
          id: videoId,
          title: String(meta.title || '').slice(0, 500),
          uploader: String(meta.uploader || '').slice(0, 500),
          duration: Number(meta.duration) || 0,
          uploadDate: meta.uploadDate || '',
        });
        // Réduire les champs tout en conservant un JSON valide et <= 3 ko.
        if (Buffer.byteLength(payload, 'utf8') > 3072) {
          const compact = JSON.parse(payload);
          compact.title = String(compact.title || '').slice(0, 240);
          compact.uploader = String(compact.uploader || '').slice(0, 240);
          payload = JSON.stringify(compact);
        }
        return 'YTWM:' + payload; // préfixe détectable (stamp) : description COMM = YTWM
      })
      .then((stamped) => setCommentJson(mp3Path, stamped))
      .catch((err) => {
        console.warn('[server] Métadonnées popup non embarquées (' + videoId + ') :', err.message || err);
        try { fs.unlinkSync(mp3Path + '.meta.mp3'); } catch (_) {}
      })
      .finally(() => resolve());
  });
}

// Parse le tag ID3v2 d'un buffer (début du fichier). Renvoie
// { version, tagEnd, frames:[{ id, offset, bodySize, body }] } où `offset`
// pointe sur l'en-tête complet de la frame (10 octets) ; ou null si pas
// d'ID3v2. Ne modifie pas le buffer. Tailles gérées : plain 32-bit (v2.3)
// et synchsafe (v2.4, détecté par bit haut).
function parseId3v2(b) {
  if (!b || b.length < 12 || b.toString('latin1', 0, 3) !== 'ID3') return null;
  const version = b[3];
  let sz = (b[6] & 0x7f) * 0x200000 + (b[7] & 0x7f) * 0x4000 + (b[8] & 0x7f) * 0x80 + (b[9] & 0x7f);
  const tagEnd = Math.min(10 + sz, b.length);
  const frames = [];
  let off = 10;
  while (off + 10 <= tagEnd) {
    const id = b.toString('latin1', off, off + 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    let fs2 = b.readUInt32BE(off + 4);
    if (version >= 4) {
      fs2 = (b[off + 4] & 0x7f) * 0x200000 + (b[off + 5] & 0x7f) * 0x4000
        + (b[off + 6] & 0x7f) * 0x80 + (b[off + 7] & 0x7f);
    }
    const bodySize = Math.min(fs2, Math.max(0, tagEnd - off - 10));
    frames.push({ id: id, offset: off, bodySize: bodySize, body: b.slice(off + 10, off + 10 + bodySize) });
    off += 10 + bodySize;
  }
  return { version: version, tagEnd: tagEnd, frames: frames };
}

// Vrai si le MP3 contient déjà notre commentaire (marqueur YTWM:).
function hasMetaStamp(mp3Path) {
  try {
    const parsed = parseId3v2(fs.readFileSync(mp3Path));
    if (!parsed) return false;
    return parsed.frames.some(function (f) {
      return (f.id === 'COMM' || f.id === 'TXXX') && f.body.includes('YTWM:');
    });
  } catch (_) { return false; }
}

// Réécrit le tag ID3v2 du MP3 : supprime les anciens commentaires COMM (et
// les TXXX portant notre marqueur YTWM:), ajoute UNE frame COMM avec le
// texte fourni (encodage UTF-8, langue 'eng', description courte 'YTWM').
// Toutes les AUTRES frames — y compris APIC (pochette) — sont conservées
// octet pour octet, et l'audio n'est jamais ré-encodé. Idempotent par
// construction (le marqueur YTWM: est retiré avant d'être re-ajouté).
function setCommentJson(mp3Path, stampedText) {
  return new Promise((resolve, reject) => {
    try {
      const b = fs.readFileSync(mp3Path);
      let frames = [];
      let audioStart = 0;
      let version = 3;
      const parsed = parseId3v2(b);
      if (parsed) {
        version = parsed.version;
        audioStart = parsed.tagEnd;
        frames = parsed.frames
          .filter(function (f) {
            return !((f.id === 'COMM' || f.id === 'TXXX') && f.body.includes('YTWM:'));
          })
          .map(function (f) { return b.slice(f.offset, f.offset + 10 + f.bodySize); });
      }
      // Nouvelle frame COMM : [encoding=UTF-8(3)][lang 'eng'][desc 'YTWM' terminée 00][texte]
      const text = Buffer.from(String(stampedText || ''), 'utf8');
      const desc = Buffer.from('YTWM', 'latin1');
      const body = Buffer.alloc(1 + 3 + desc.length + 1 + text.length);
      body[0] = 3;
      body.write('eng', 1, 'latin1');
      desc.copy(body, 4);
      body[4 + desc.length] = 0;
      text.copy(body, 5 + desc.length);
      const sizeBytes = Buffer.alloc(4);
      if (version >= 4) {
        sizeBytes[0] = (body.length >> 21) & 0x7f;
        sizeBytes[1] = (body.length >> 14) & 0x7f;
        sizeBytes[2] = (body.length >> 7) & 0x7f;
        sizeBytes[3] = body.length & 0x7f;
      } else {
        sizeBytes.writeUInt32BE(body.length);
      }
      const comm = Buffer.concat([Buffer.from('COMM', 'latin1'), sizeBytes, Buffer.from([0, 0]), body]);
      frames.push(comm);
      // Header ID3v2 (même version que l'entrée, taille synchsafe).
      let bodyLen = 0;
      for (let i = 0; i < frames.length; i++) bodyLen += frames[i].length;
      const header = Buffer.alloc(10);
      header.write('ID3', 0, 'latin1');
      header[3] = version; header[4] = 0; header[5] = 0;
      header[6] = (bodyLen >> 21) & 0x7f;
      header[7] = (bodyLen >> 14) & 0x7f;
      header[8] = (bodyLen >> 7) & 0x7f;
      header[9] = bodyLen & 0x7f;
      const out = Buffer.concat([header].concat(frames, [b.slice(audioStart)]));
      const tmp = mp3Path + '.' + crypto.randomBytes(6).toString('hex') + '.meta.mp3';
      fs.writeFileSync(tmp, out);
      fs.renameSync(tmp, mp3Path);
      resolve();
    } catch (err) { reject(err); }
  });
}

// Content-Type selon l'extension réelle du fichier servi.
function mimeForExt(ext) {
  const e = String(ext || '').toLowerCase();
  if (e === 'mp3') return 'audio/mpeg';
  if (e === 'm4a' || e === 'mp4' || e === 'mp4a') return 'audio/mp4';
  if (e === 'opus' || e === 'webm') return 'audio/webm';
  if (e === 'aac') return 'audio/aac';
  return 'audio/mpeg';
}

function extOf(file) {
  const b = path.basename(file || '');
  const i = b.lastIndexOf('.');
  return i >= 0 ? b.slice(i + 1) : 'mp3';
}

// Nom de fichier de sauvegarde propre : "<titre>-<artiste>.mp3".
// Nettoie les caractères interdits (/ \ : * ? " < > |), conserve les accents,
// remplace les espaces multiples, tronque à 200 caractères.
// Si artiste vide, retourne "<titre>.<ext>".
function buildDownloadFilename(title, artist, ext) {
  const clean = function (s) {
    return String(s || '')
      .replace(/[/\\:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
  };
  const extSafe = (ext || 'mp3').toLowerCase();
  const base = artist ? (clean(title) + '-' + clean(artist)) : clean(title);
  return (base || 'audio') + '.' + extSafe;
}

// ===== App Express =====
function createApp() {
const app = express();
app.disable('x-powered-by');

app.use(function validateLocalHost(req, res, next) {
  const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]') return res.sendStatus(421);
  next();
});

// Backend same-origin, protégé par un jeton de session gardé en mémoire.
function requireLocalToken(req, res, next) {
  if (req.path === '/health' || req.path === '/ready' || req.path === '/session') return next();
  if (req.get('X-Local-Token') !== LOCAL_TOKEN) {
    return res.status(403).json({ error: 'Accès local non autorisé.', code: 'local-auth-required' });
  }
  next();
}
app.use('/api', requireLocalToken);

app.use(function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "base-uri 'self'", "object-src 'none'",
    "script-src 'self' https://www.youtube.com https://s.ytimg.com", "style-src 'self' 'unsafe-inline'",
    // Tone.js (séquenceur) crée un Worker interne pour son horloge via blob: URL.
    // worker-src hérite de script-src par défaut, on l'autorise explicitement.
    "worker-src 'self' blob:",
    "img-src 'self' data: blob: https://*.ytimg.com https://*.googleusercontent.com https://*.private.coffee",
    "media-src 'self' blob: https:", "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
    "connect-src 'self' blob: data: https://www.youtube.com https://*.private.coffee", "form-action 'self'"
  ].join('; '));
  next();
});

// ===== Logging des requêtes (console) =====
app.use(function (req, res, next) {
  var t0 = Date.now();
  res.on('finish', function () {
    if (req.path === '/favicon.ico') return;
    var ms = Date.now() - t0;
    var tag = (req.path.indexOf('/api/') === 0) ? 'API ' : 'HTTP';
    console.log(tag + ' ' + req.method + ' ' + res.statusCode
      + '  ' + String(ms).padStart(5) + 'ms  ' + req.originalUrl);
  });
  next();
});

// --- GET /api/health ---
// État du serveur. PAS de yt-dlp ici (son --version met ~8s et bloquerait).
// yt-dlp sera testé au 1er /api/audio/:id — s'il manque, le client verra un 502.
app.get('/api/session', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ token: LOCAL_TOKEN });
});

function capabilitySnapshot() {
  const audio = !!ffmpegAvailable && !!ytdlpAvailable;
  return {
    ok: true, ready: audio, port: PORT, host: HOST,
    capabilities: { metadata: true, audio: audio },
    dependencies: {
      ytDlp: !!ytdlpAvailable, ytDlpVersion: typeof ytdlpAvailable === 'string' ? ytdlpAvailable : null,
      ffmpeg: !!ffmpegAvailable, ffmpegVersion: typeof ffmpegAvailable === 'string' ? ffmpegAvailable : null,
    },
    queue: extractQueue.stats(),
  };
}

app.get('/api/health', async (req, res) => {
  const snapshot = capabilitySnapshot();
  snapshot.cache = Object.assign({ kind: 'disk' }, await cacheManager.stats());
  res.json(snapshot);
});

app.get('/api/ready', (req, res) => {
  const snapshot = capabilitySnapshot();
  res.status(snapshot.ready ? 200 : 503).json(snapshot);
});

app.get('/api/progress/:id', (req, res) => {
  const id = req.params.id;
  if (!RE_VIDEOID.test(id)) return res.status(400).json({ error: 'videoId invalide.' });
  const p = getExtractProgress(id);
  res.json({ videoId: id, progress: p });
});

app.get('/api/config', (req, res) => {
  res.json({
    maxTrackDurationSec: MAX_TRACK_DURATION_SEC,
    ytdlpBinTimeoutMs: YTDLP_BIN_TIMEOUT_MS,
    scratchMaxDurationSec: SCRATCH_MAX_DURATION_SEC,
    cookiesBrowser: YTDLP_COOKIES_BROWSER
  });
});

app.post('/api/config', express.json(), (req, res) => {
  const body = req.body || {};
  if (typeof body.maxTrackDurationSec === 'number') {
    MAX_TRACK_DURATION_SEC = Math.max(60, Math.min(86400, body.maxTrackDurationSec));
  }
  if (typeof body.ytdlpBinTimeoutMs === 'number') {
    YTDLP_BIN_TIMEOUT_MS = Math.max(10000, Math.min(3600000, body.ytdlpBinTimeoutMs));
  }
  if (typeof body.scratchMaxDurationSec === 'number') {
    SCRATCH_MAX_DURATION_SEC = Math.max(60, Math.min(7200, body.scratchMaxDurationSec));
  }
  res.json({
    ok: true,
    maxTrackDurationSec: MAX_TRACK_DURATION_SEC,
    ytdlpBinTimeoutMs: YTDLP_BIN_TIMEOUT_MS,
    scratchMaxDurationSec: SCRATCH_MAX_DURATION_SEC
  });
});

// --- GET /api/streams/:id ---
// Métadonnées via oEmbed (PAS de yt-dlp). ~0,15 s, ne bloque pas l'app.
// Renvoie un JSON compatible Piped pour le frontend (audioStreams[].url = /api/audio/:id).
app.get('/api/streams/:id', async (req, res) => {
  const id = req.params.id;
  if (!RE_VIDEOID.test(id)) return res.status(400).json({ error: 'videoId invalide.' });

  try {
    const meta = await fetchMeta(id);

    let enriched = readMetaCache(id) || {};
    if (enriched.error) enriched = {};
    if (!enriched.id) void fetchMetaEnriched(id).catch(() => {});

    res.json({
      title: meta.title,
      duration: Number(enriched.duration) || Number(meta.duration) || 0,
      thumbnailUrl: meta.thumbnailUrl,
      uploader: meta.uploader,
      proxyUrl: '',
      views: enriched.views || 0,
      uploadDate: enriched.uploadDate || '',
      description: enriched.description || '',
      audioAvailable: !!(ffmpegAvailable && ytdlpAvailable),
      audioStreams: (ffmpegAvailable && ytdlpAvailable) ? [
        { url: '/api/audio/' + id, format: 'MP3', bitrate: 96, mimeType: 'audio/mpeg', videoOnly: false },
      ] : [],
      videoStreams: [],
    });
  } catch (err) {
    const code = err.code === 'notfound' ? 404 : 502;
    console.error('[api] ✗ /api/streams/' + id + ' → HTTP ' + code + ' (' + (err.code || 'extract') + ') : ' + err.message);
    if (err.code === 'notfound') return res.status(404).json({ error: err.message, code: 'notfound' });
    return res.status(502).json({ error: err.message || 'Extraction échouée.', code: err.code || 'extract' });
  }
});

// --- GET /api/description/:id ---
// Description YouTube complète (celle du "more"/détails) via yt-dlp
// --skip-download --print description. Cache 24 h. Utilisée par le popup
// hover des résultats de recherche. Same-origin → fiable (Piped ne l'est pas).
app.get('/api/description/:id', async (req, res) => {
  const id = req.params.id;
  if (!RE_VIDEOID.test(id)) return res.status(400).json({ error: 'videoId invalide.' });

  try {
    const desc = await fetchVideoDescription(id);
    res.json({ id: id, description: desc });
  } catch (err) {
    // Silencieux : les échecs de description sont fréquents et bénins
    // (vidéo sans description, anti-bot occasionnel) — inutile de les
    // logguer. Le client affiche juste "pas de description".
    const code = err.code === 'antibot' ? 451 : 502;
    if (!res.headersSent) {
      res.status(code).json({ error: err.message || 'Description indisponible.', isAntiBot: err.code === 'antibot', code: err.code || 'extract' });
    }
  }
});

// --- GET /api/meta/:id ---
// Métadonnées enrichies (vues, date ISO, durée, uploader, description) —
// source unique de vérité, cache disque : 1re génération via oEmbed +
// yt-dlp --skip-download (léger, ~2-10 s), ensuite lecture disque directe,
// ZÉRO requête upstream. TTL 24 h. Utilisée par le popup et par
// l'enrichissement du MP3 (embedPopupMeta).
app.get('/api/meta/:id', async (req, res) => {
  const id = req.params.id;
  if (!RE_VIDEOID.test(id)) return res.status(400).json({ error: 'videoId invalide.' });

  try {
    const meta = await fetchMetaEnriched(id);
    res.json(meta);
  } catch (err) {
    const code = err.code === 'notfound' ? 404 : (err.code === 'antibot' ? 451 : 502);
    console.error('[api] ✗ /api/meta/' + id + ' → HTTP ' + code + ' (' + (err.code || 'extract') + ') : ' + err.message);
    if (!res.headersSent) {
      res.status(code).json({ error: err.message || 'Métadonnées indisponibles.', isAntiBot: err.code === 'antibot', code: err.code || 'extract' });
    }
  }
});

// --- GET /api/audio/:id ---
// Sert le MP3. 1er appel : yt-dlp -x + ffmpeg (~10-15 s) → cache disque.
// Suivants : sendFile direct (Range natif, seek OK pour le tee/scratch).
app.get('/api/audio/:id', async (req, res) => {
  const id = req.params.id;
  if (!RE_VIDEOID.test(id)) return res.status(400).json({ error: 'videoId invalide.' });

  try {
    const file = await extractAudio(id);
    res.setHeader('Content-Type', mimeForExt(extOf(file)));
    res.sendFile(file, function (err) {
      if (err && !res.headersSent) {
        console.error('[api] ✗ /api/audio/' + id + ' → sendFile: ' + err.message);
        res.status(500).json({ error: 'Fichier audio indisponible.' });
      }
    });
  } catch (err) {
    const code = err.code === 'antibot' ? 451 : (err.code === 'notfound' ? 404 : (err.code === 'no-ffmpeg' || err.code === 'no-yt-dlp' ? 503 : (err.code === 'queue-full' ? 429 : (err.code === 'track-too-long' || err.code === 'live-not-supported' ? 422 : 502))));
    console.error('[api] ✗ /api/audio/' + id + ' → HTTP ' + code + ' (' + (err.code || 'extract') + ') : ' + err.message);
    if (!res.headersSent) {
      res.status(code).json({ error: err.message || 'Extraction audio échouée.', isAntiBot: err.code === 'antibot', code: err.code || 'extract' });
    }
  }
});

// --- GET /api/scratch/:id ---
// Découpe à la volée une tranche de 3 minutes (180s) centrée sur le point de lecture
// (`?t=secondes`) pour permettre un décodage PCM instantané et ultra-léger (< 40 Mo de RAM)
// même sur les mix de plusieurs heures.
app.get('/api/scratch/:id', async (req, res) => {
  const id = req.params.id;
  if (!RE_VIDEOID.test(id)) return res.status(400).json({ error: 'videoId invalide.' });

  const t = Math.max(0, parseFloat(req.query.t) || 0);
  const duration = 180; // 3 minutes
  const start = Math.max(0, t - 30); // 30s avant la position courante

  try {
    const file = await extractAudio(id);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('X-Scratch-Start', String(start));
    res.setHeader('X-Scratch-Duration', String(duration));

    const ffmpegProc = spawn('ffmpeg', [
      '-ss', String(start),
      '-t', String(duration),
      '-i', file,
      '-f', 'mp3',
      '-acodec', 'copy',
      'pipe:1'
    ], { stdio: ['ignore', 'pipe', 'ignore'] });

    ffmpegProc.stdout.pipe(res);
    req.on('close', () => {
      try { ffmpegProc.kill('SIGKILL'); } catch (_) {}
    });
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: 'Extraction de la tranche scratch échouée.' });
  }
});

// --- GET /api/download/:id ---
// Sauvegarde locale (mode DJ) : sert le MP3 du cache en téléchargement
// (Content-Disposition: attachment). Le nom de fichier proposé est
// "<titre>-<artiste>.mp3", construit depuis fetchMeta (oEmbed, pas de yt-dlp).
// Réutilise extractAudio → le fichier est extrait s'il n'est pas encore en cache.
app.get('/api/download/:id', async (req, res) => {
  const id = req.params.id;
  if (!RE_VIDEOID.test(id)) return res.status(400).json({ error: 'videoId invalide.' });

  try {
    const file = await extractAudio(id);
    const ext = extOf(file);

    // Nom de fichier proposé : "<titre>-<artiste>.mp3" (oEmbed, jamais bloquant).
    let title = null, artist = null;
    try {
      const meta = await fetchMeta(id);
      title = meta.title;
      artist = meta.uploader;
    } catch (_) { /* nom générique en dernier recours */ }
    const filename = buildDownloadFilename(title, artist, ext);
    // filename= (ASCII uniquement, fallback) ; filename*= (UTF-8, prioritaire)
    const asciiSafe = filename.replace(/[^\x20-\x7E]/g, '_');
    res.setHeader('Content-Type', mimeForExt(ext));
    res.setHeader('Content-Disposition', 'attachment; filename="' + asciiSafe + '"; filename*=UTF-8\'\'' + encodeURIComponent(filename));
    res.sendFile(file, function (err) {
      if (err && !res.headersSent) {
        console.error('[api] ✗ /api/download/' + id + ' → sendFile: ' + err.message);
        res.status(500).json({ error: 'Fichier audio indisponible.' });
      }
    });
  } catch (err) {
    const code = err.code === 'antibot' ? 451 : (err.code === 'notfound' ? 404 : (err.code === 'no-ffmpeg' || err.code === 'no-yt-dlp' ? 503 : (err.code === 'queue-full' ? 429 : (err.code === 'track-too-long' || err.code === 'live-not-supported' ? 422 : 502))));
    console.error('[api] ✗ /api/download/' + id + ' → HTTP ' + code + ' (' + (err.code || 'extract') + ') : ' + err.message);
    if (!res.headersSent) {
      res.status(code).json({ error: err.message || 'Extraction audio échouée.', isAntiBot: err.code === 'antibot', code: err.code || 'extract' });
    }
  }
});

// --- Frontend statique allowlisté ---
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.get('/sequencer', (req, res) => res.sendFile(path.join(ROOT, 'sequencer.html')));
app.get('/sequencer.html', (req, res) => res.sendFile(path.join(ROOT, 'sequencer.html')));
app.get('/test-progress', (req, res) => res.sendFile(path.join(ROOT, 'tests', 'test-progress.html')));
app.use('/css', express.static(path.join(ROOT, 'css')));
app.use('/js', express.static(path.join(ROOT, 'js')));
app.get('/favicon.ico', (req, res) => res.sendFile(path.join(ROOT, 'favicon.ico')));
app.get('/audio-file.png', (req, res) => res.sendFile(path.join(ROOT, 'audio-file.png')));
// Asset de la batterie vue du dessus (séquenceur)
app.get('/battery-set-above.jpeg', (req, res) => res.sendFile(path.join(ROOT, 'battery-set-above.jpeg')));
app.use((req, res) => res.sendStatus(404));


  return app;
}



// ===== Démarrage =====
// On ne teste QUE ffmpeg (rapide). yt-dlp est testé paresseusement au 1er
// /api/audio/:id (son --version met ~8s, on ne le met pas sur la voie critique).
function checkExecutable(bin, args, timeout) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeout }, (err, stdout) => {
      if (err) return resolve(false);
      const text = String(stdout || '').trim();
      const m = /(?:version\s+)?(\S+)/i.exec(text);
      resolve(m ? m[1] : true);
    });
  });
}
function checkFfmpeg() { return checkExecutable('ffmpeg', ['-version'], FFMPEG_TIMEOUT_MS); }
function checkYtdlp() { return checkExecutable(YTDLP_BIN, ['--version'], 10000); }

async function startServer() {
  const values = await Promise.all([checkFfmpeg(), checkYtdlp()]);
  ffmpegAvailable = values[0];
  ytdlpAvailable = values[1];
  const app = createApp();
  await cacheManager.cleanupTemps().catch(() => {});
  return new Promise((resolve, reject) => {
    httpServer = app.listen(PORT, HOST, () => {
      console.log('');
      console.log('  YT Music Web Mixer — serveur local');
      console.log('  → http://' + HOST + ':' + PORT);
      console.log('');
      if (ffmpegAvailable) console.log('  ✓ ffmpeg détecté — extraction audio active.');
      else console.log('  ⚠ ffmpeg INTROUVABLE — le mode DJ local est désactivé.');
      console.log('  Cache audio : ' + CACHE_DIR);
      console.log('  Cookies navigateur : ' + (YTDLP_COOKIES_BROWSER === 'none' ? 'désactivés (défaut sûr)' : YTDLP_COOKIES_BROWSER));
      console.log('  yt-dlp : ' + (ytdlpAvailable ? 'détecté' : 'INTROUVABLE') + '.');
      console.log('  Limite piste DJ : ' + Math.round(MAX_TRACK_DURATION_SEC / 60) + ' min.');
      console.log('  Ctrl+C pour arrêter.');
      console.log('');
      resolve(httpServer);
    });
    httpServer.once('error', reject);
  });
}

let handlersInstalled = false;
function installProcessHandlers() {
  if (handlersInstalled) return;
  handlersInstalled = true;
  process.on('unhandledRejection', (reason) => {
    console.error('[server] ✗ unhandledRejection :', reason instanceof Error ? reason.stack : String(reason));
  });
  process.on('uncaughtException', (err) => {
    console.error('[server] ✗ uncaughtException :', err && err.stack ? err.stack : String(err));
    if (httpServer) {
      httpServer.close(() => process.exit(1));
      setTimeout(() => process.exit(1), 5000).unref();
    } else process.exit(1);
  });
}

if (require.main === module) {
  installProcessHandlers();
  startServer().catch((err) => {
    console.error('[server] démarrage impossible :', err && err.stack ? err.stack : String(err));
    process.exitCode = 1;
  });
}

module.exports = { createApp, startServer };

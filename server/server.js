/* server/server.js — Backend d'extraction local (yt-dlp) pour le mixer
 *
 * Objectif : contourner le blocage anti-bot YouTube qui frappe les instances
 * Piped publiques. yt-dlp tourne EN LOCAL, sur l'IP de l'utilisateur, là où
 * l'anti-bot ne s'applique pas (ou est géré via les plugins PO-Token de
 * yt-dlp, optionnels).
 *
 * L'API se limite STRICTEMENT à l'extraction locale :
 *   GET /api/streams/:id   → extraction yt-dlp, renvoie un JSON compatible
 *                            Piped (title, duration, thumbnailUrl, audioStreams).
 *   GET /api/audio/:id     → RELAIS du flux audio extrait, en same-origin
 *                            (avec support HTTP Range pour le seek). Ce relais
 *                            est la suite directe de l'extraction : sans lui,
 *                            l'URL googlevideo brute chargée dans un <audio>
 *                            cross-origin serait "tainted" (silence) et le
 *                            graphe Web Audio — crossfade, EQ, analyse, BPM —
 *                            serait muet. Il ne fait QUE relayer les octets du
 *                            flux déjà extrait (pas de transcodage, pas de
 *                            stockage permanent, pas de cache disque).
 *   GET /api/health        → présence/version de yt-dlp.
 *
 * Le serveur sert AUSSI les fichiers statiques du frontend (depuis la racine
 * du projet), pour que l'app et l'API soient same-origin : c'est ce qui rend
 * le relais audio utilisable par Web Audio sans taint.
 *
 * Dépendances : express uniquement. yt-dlp doit être installé sur le système
 * (https://github.com/yt-dlp/yt-dlp#installation). ffmpeg n'est PAS requis :
 * on relaye le flux audio tel quel, sans ré-encodage.
 */

'use strict';

const path = require('path');
const { execFile } = require('child_process');
const { Readable } = require('stream');

// Express peut être absent si l'utilisateur lance le serveur sans avoir fait
// `npm install`. On gère ça proprement avec un message d'aide.
let express;
try {
  express = require('express');
} catch (_) {
  console.error('\n[ERREUR] Le module "express" est introuvable.');
  console.error('Lancez d\'abord :  npm install\n');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');          // racine du projet (index.html…)
const PORT = Number(process.env.PORT) || 5400;     // port déclaré dans start.sh / start.bat

// ===== yt-dlp =====
const YTDLP_BIN = process.env.YTDLP_BIN || 'yt-dlp';
const YTDLP_BIN_TIMEOUT_MS = 50000;                // yt-dlp peut être lent (extraction + résolution anti-bot)
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;           // 4h par défaut (conservateur, les URLs CDN expirent vite)

// Regex de blocage anti-bot YouTube dans la sortie yt-dlp. Quand yt-dlp n'a
// pas de résolveur PO-Token (plugin bgutil) et que l'IP est challenger, il
// sort une erreur "Sign in to confirm you're not a bot".
const RE_ANTIBOT = /sign in to confirm|not a bot|botguard|po[-_]?token/i;

// Validation d'un videoId YouTube (11 caractères alphanumériques + - _ ).
// Refuse tout le reste par sécurité avant de le passer à yt-dlp.
const RE_VIDEOID = /^[a-zA-Z0-9_-]{6,15}$/;

// Hôtes CDN autorisés pour le relais audio. On ne relaie QUE du CDN YouTube :
// évite qu'une URL imprévue transforme le serveur en proxy ouvert.
const RE_ALLOWED_HOST = /(^|\.)(googlevideo\.com|youtube\.com|youtu\.be|yt\.googleusercontent\.com)$/i;

let ytdlpAvailable = null;  // null = non testé, true/false après le check de démarrage

// Lance yt-dlp et renvoie son JSON parsé pour une vidéo. Rejette avec une
// erreur typée ({ code: 'antibot' | 'extract' | 'notfound' }) exploitable par
// la route API.
function runYtDlp(videoId) {
  return new Promise((resolve, reject) => {
    const watchUrl = 'https://www.youtube.com/watch?v=' + encodeURIComponent(videoId);
    const args = [
      '-f', 'ba',                 // meilleur flux audio uniquement
      '-J',                       // sortie JSON (métadonnées + formats)
      '--no-warnings',
      '--no-playlist',
      '--no-cache-dir',
      watchUrl,
    ];
    const opts = { maxBuffer: 16 * 1024 * 1024, timeout: YTDLP_BIN_TIMEOUT_MS };

    execFile(YTDLP_BIN, args, opts, (err, stdout, stderr) => {
      const combined = String(stderr || '') + '\n' + String(stdout || '');

      // Anti-bot YouTube
      if (RE_ANTIBOT.test(combined)) {
        const e = new Error('YouTube exige une vérification anti-bot (Sign in to confirm you\'re not a bot).');
        e.code = 'antibot';
        return reject(e);
      }
      if (err) {
        // Vidéo inexistante / privée / restreinte géographiquement
        if (/private video|video unavailable|not exist|been removed|not available in your country/i.test(combined)) {
          const e = new Error('Vidéo indisponible (privée, supprimée ou restreinte).');
          e.code = 'notfound';
          return reject(e);
        }
        const e = new Error('yt-dlp a échoué : ' + (err.message || combined.slice(0, 200)));
        e.code = 'extract';
        return reject(e);
      }

      let info;
      try {
        info = JSON.parse(stdout);
      } catch (parseErr) {
        const e = new Error('yt-dlp a renvoyé un JSON illisible.');
        e.code = 'extract';
        return reject(e);
      }
      if (!info || (!info.formats && !info.url)) {
        const e = new Error('yt-dlp n\'a renvoyé aucun format exploitable.');
        e.code = 'extract';
        return reject(e);
      }
      resolve(info);
    });
  });
}

// Sélectionne le meilleur flux audio depuis le JSON yt-dlp.
// Priorité : audio-only (vcodec 'none'), protocol http(s), meilleur abr.
// Fallback : format muxé (audio+vidéo) lisible par un <audio> malgré tout.
function pickBestAudioFormat(info) {
  const formats = Array.isArray(info.formats) ? info.formats : [];
  const isHttp = (p) => typeof p === 'string' && (p === 'http' || p === 'https' || p.indexOf('http') === 0);

  const audioOnly = formats.filter((f) => f && f.url && f.vcodec && /none/i.test(String(f.vcodec)) && isHttp(f.protocol));
  if (audioOnly.length) {
    audioOnly.sort((a, b) => (Number(b.abr) || 0) - (Number(a.abr) || 0));
    return audioOnly[0];
  }
  // Fallback muxé : le plus petit fichier (on ne veut que l'audio).
  const muxed = formats.filter((f) => f && f.url && f.acodec && !/none/i.test(String(f.acodec)) && isHttp(f.protocol));
  if (muxed.length) {
    muxed.sort((a, b) => (Number(a.filesize || a.abr || 0) || Infinity) - (Number(b.filesize || b.abr || 0) || Infinity));
    return muxed[0];
  }
  // Dernier recours : l'URL sélectionnée au niveau racine (quand -f ba a fixé une URL).
  if (info.url) return { url: info.url, ext: info.ext, abr: info.abr };
  return null;
}

// Détermine la date d'expiration d'une URL googlevideo. Le paramètre `expire`
// est un timestamp Unix (secondes) inséré par YouTube. On l'utilise si présent,
// sinon on retombe sur CACHE_TTL_MS.
function urlExpiryMs(url) {
  try {
    const m = /[?&]expire=(\d+)/.exec(String(url));
    if (m) {
      const ms = Number(m[1]) * 1000;
      if (isFinite(ms) && ms > Date.now()) return ms;
    }
  } catch (_) { /* ignore */ }
  return Date.now() + CACHE_TTL_MS;
}

// ===== Cache + déduplication des extractions en cours =====
//
// Forme : videoId → { info de base + upstreamUrl, ext, mime, abr, expiresAt }.
// `extracting` empêche de lancer 2 processus yt-dlp pour le même videoId
// (double-clic, chargement A+B de la même vidéo…) : on réutilise la même
// promesse. Le cache est strictement EN MÉMOIRE, jamais sur disque.
const cache = new Map();
const extracting = new Map();

function mimeForExt(ext) {
  const e = String(ext || '').toLowerCase();
  if (e === 'opus' || e === 'webm') return 'audio/webm';
  if (e === 'm4a' || e === 'mp4' || e === 'mp4a') return 'audio/mp4';
  return 'audio/mpeg';
}

function formatTag(ext) {
  const e = String(ext || '').toLowerCase();
  if (e === 'opus' || e === 'webm') return 'OPUS';
  if (e === 'm4a' || e === 'mp4' || e === 'mp4a') return 'M4A';
  return e.toUpperCase() || 'AUDIO';
}

// Extraction (avec cache + dédup). Retourne une entrée de cache.
// `force` force un re-fetch (URL expirée / 403 sur le relais).
function extract(videoId, force) {
  if (force) cache.delete(videoId);
  const cached = cache.get(videoId);
  if (cached && Date.now() < cached.expiresAt) return Promise.resolve(cached);

  let pending = extracting.get(videoId);
  if (!pending) {
    pending = (async () => {
      const info = await runYtDlp(videoId);
      const fmt = pickBestAudioFormat(info);
      if (!fmt || !fmt.url) {
        const e = new Error('Aucun flux audio exploitable trouvé par yt-dlp.');
        e.code = 'extract';
        throw e;
      }
      const host = (() => { try { return new URL(fmt.url).hostname; } catch (_) { return ''; } })();
      if (host && !RE_ALLOWED_HOST.test(host)) {
        const e = new Error('URL de flux inattendue (hôte non autorisé) : ' + host);
        e.code = 'extract';
        throw e;
      }
      const entry = {
        videoId: videoId,
        title: String(info.title || '').trim(),
        duration: Number(info.duration) || 0,
        thumbnailUrl: String(info.thumbnail || ''),
        uploader: String(info.uploader || info.channel || info.uploader_id || '').trim(),
        upstreamUrl: fmt.url,
        ext: fmt.ext || info.ext,
        abr: Number(fmt.abr) || 0,
        fetchedAt: Date.now(),
        expiresAt: urlExpiryMs(fmt.url),
      };
      cache.set(videoId, entry);
      return entry;
    })().finally(() => {
      extracting.delete(videoId);
    });
    extracting.set(videoId, pending);
  }
  return pending;
}

// ===== App Express =====
const app = express();
app.disable('x-powered-by');

// CORS permissif sur les routes API (utile si l'app est ouverte depuis un
// autre port / file:// ; inoffensif en same-origin).
function corsApi(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}
app.use('/api', corsApi);

// ===== Logging des requêtes (console) =====
//
// Affiche method, statut, durée et chemin de CHAQUE requête reçue. Préfixe
// 'API ' pour les routes d'extraction, 'HTTP' pour le reste (statique). On
// ignore favicon.ico (bruit). Mesuré via l'événement 'finish' de la réponse
// pour capter le vrai code statut (200/206/304/4xx/5xx) et la durée réelle
// (utile : yt-dlp est lent, le relais audio streame longtemps).
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
// Présence + version de yt-dlp. L'app peut s'en servir pour savoir si
// l'extraction locale est réellement disponible (sans yt-dlp, ce backend
// ne sert qu'à héberger le frontend en statique).
app.get('/api/health', (req, res) => {
  res.json({ ok: true, port: PORT, ytdlp: ytdlpAvailable });
});

// --- GET /api/streams/:id ---
// Extraction locale. Renvoie un JSON compatible Piped pour que le frontend
// (piped-streams.js → buildStreamEntry) le consomme sans changement.
// L'URL audio pointe vers /api/audio/:id (relais same-origin).
app.get('/api/streams/:id', async (req, res) => {
  const id = req.params.id;
  if (!RE_VIDEOID.test(id)) return res.status(400).json({ error: 'videoId invalide.' });

  if (ytdlpAvailable === false) {
    return res.status(503).json({ error: 'yt-dlp n\'est pas installé sur le serveur. Installez-le : https://github.com/yt-dlp/yt-dlp#installation', code: 'no-ytdlp' });
  }

  try {
    const entry = await extract(id, false);
    res.json({
      title: entry.title,
      duration: entry.duration,
      thumbnailUrl: entry.thumbnailUrl,
      uploader: entry.uploader,
      proxyUrl: '',
      audioStreams: [
        {
          url: '/api/audio/' + id,
          format: formatTag(entry.ext),
          bitrate: entry.abr,
          mimeType: mimeForExt(entry.ext),
          videoOnly: false,
        },
      ],
      videoStreams: [],
    });
  } catch (err) {
    if (err.code === 'antibot') return res.status(451).json({ error: err.message, isAntiBot: true, code: 'antibot' });
    if (err.code === 'notfound') return res.status(404).json({ error: err.message, code: 'notfound' });
    return res.status(502).json({ error: err.message || 'Extraction échouée.', code: err.code || 'extract' });
  }
});

// --- GET /api/audio/:id ---
// Relais du flux audio extrait. On relaie EN STREAMING (pipe) en transmettant
// le Range du client pour permettre le seek, et on recopie les en-têtes de
// l'amont (Content-Range, Content-Length, Accept-Ranges, Content-Type).
// En cas d'URL expirée (403), on re-extrait une fois puis on réessaie.
app.get('/api/audio/:id', async (req, res) => {
  const id = req.params.id;
  if (!RE_VIDEOID.test(id)) return res.status(400).json({ error: 'videoId invalide.' });

  async function relayOnce(url, isRetry) {
    const headers = {};
    if (req.get('Range')) headers['Range'] = req.get('Range');
    let upstream;
    try {
      upstream = await fetch(url, { headers });
    } catch (netErr) {
      res.status(502).json({ error: 'Relais audio : échec réseau vers le CDN.' });
      return;
    }

    // URL expirée → on re-extrait puis on réessaie une seule fois.
    if ((upstream.status === 403 || upstream.status === 410) && !isRetry) {
      try {
        const fresh = await extract(id, true);
        return relayOnce(fresh.upstreamUrl, true);
      } catch (_) {
        res.status(502).json({ error: 'Relais audio : URL expirée, ré-extraction échouée.' });
        return;
      }
    }
    if (!upstream.ok && upstream.status !== 206) {
      res.status(502).json({ error: 'Relais audio : le CDN a renvoyé HTTP ' + upstream.status + '.' });
      return;
    }

    res.status(upstream.status);  // 200 ou 206
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h.charAt(0).toUpperCase() + h.slice(1), v);
    }
    res.setHeader('Accept-Ranges', 'bytes');

    // Pipe du corps (ReadableStream web → stream Node). On termine la réponse
    // à la fin du flux ou si le client déconnecte.
    const nodeStream = Readable.fromWeb(upstream.body);
    nodeStream.on('error', () => { try { res.end(); } catch (_) {} });
    req.on('close', () => { try { nodeStream.destroy(); } catch (_) {} });
    nodeStream.pipe(res);
  }

  try {
    const entry = await extract(id, false);
    await relayOnce(entry.upstreamUrl, false);
  } catch (err) {
    if (!res.headersSent) {
      const code = err.code === 'antibot' ? 451 : (err.code === 'notfound' ? 404 : 502);
      res.status(code).json({ error: err.message || 'Extraction échouée.', isAntiBot: err.code === 'antibot' });
    }
  }
});

// --- Fichiers statiques du frontend (depuis la racine du projet) ---
// Sert index.html, css/, js/, favicon… Same-origin avec /api/*.
app.use(express.static(ROOT, { extensions: ['html'] }));

// Démarrage : on vérifie yt-dlp une fois pour toutes (cache dans ytdlpAvailable).
function checkYtDlp() {
  return new Promise((resolve) => {
    execFile(YTDLP_BIN, ['--version'], { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(false);
      resolve(String(stdout).trim().split(/\s+/)[0] || true);
    });
  });
}

checkYtDlp().then((ver) => {
  ytdlpAvailable = ver;
  app.listen(PORT, () => {
    console.log('');
    console.log('  YT Music Web Mixer — serveur local');
    console.log('  → http://localhost:' + PORT);
    console.log('');
    if (ytdlpAvailable) {
      console.log('  ✓ yt-dlp détecté' + (typeof ver === 'string' ? ' (v' + ver + ')' : '') + ' — extraction locale active.');
    } else {
      console.log('  ⚠ yt-dlp INTROUVABLE — le frontend sera servi, mais l\'extraction');
      console.log('    locale ne fonctionnera pas. Installez yt-dlp :');
      console.log('      https://github.com/yt-dlp/yt-dlp#installation');
      console.log('    (L\'app basculera automatiquement sur Piped/IFrame.)');
    }
    console.log('  Ctrl+C pour arrêter.');
    console.log('');
  });
});

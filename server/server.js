/* server/server.js — Serveur local du mixer (Express)
 *
 * Sert le frontend en statique + 3 routes API pour le mode DJ.
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
 *   GET /api/audio/:id    → sert le MP3. 1er appel : yt-dlp -x + ffmpeg
 *                           (~10-15 s) puis cache disque. Suivants : direct.
 *
 * yt-dlp n'est appelé QUE dans /api/audio (lazy). Le démarrage du serveur
 * ne l'attend pas → l'HTML s'affiche vite.
 *
 * Dépendances : express (npm), yt-dlp + ffmpeg (binaires système).
 *   yt-dlp ≥ nightly 2026.08.18 requis (la stable 2026.07.04 est cassée).
 *   Sans yt-dlp → l'app bascule sur Piped/IFrame.
 *   Sans ffmpeg → yt-dlp -x échoue → 502 sur /api/audio.
 *
 * Cache : ./cache/audio/<videoId>.mp3 (au .gitignore). Persistant.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

let express;
try {
  express = require('express');
} catch (_) {
  console.error('\n[ERREUR] Module "express" introuvable. Lancez :  npm install\n');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 5400;
const CACHE_DIR = path.join(__dirname, '..', 'cache', 'audio');
try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch (_) {}

// yt-dlp : appelé paresseusement (uniquement dans extractAudio).
const YTDLP_BIN = process.env.YTDLP_BIN || 'yt-dlp';
const YTDLP_BIN_TIMEOUT_MS = 120000;   // -x peut être lent (téléchargement complet)
const FFMPEG_TIMEOUT_MS = 60000;

// Détecte le blocage anti-bot YouTube dans la sortie yt-dlp.
const RE_ANTIBOT = /sign in to confirm|not a bot|botguard|po[-_]?token/i;
const RE_VIDEOID = /^[a-zA-Z0-9_-]{6,15}$/;

let ffmpegAvailable = null;

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

// Dédup : évite 2 `yt-dlp -x` pour le même videoId (double-clic, decks A+B).
const extracting = new Map();

// Télécharge + extrait l'audio d'une vidéo vers cache/audio/<id>.mp3.
// C'est le SEUL appel yt-dlp du serveur. yt-dlp -x gère lui-même le
// téléchargement complet et l'extraction ffmpeg. Renvoie le chemin du MP3.
function extractAudio(videoId) {
  if (hasCached(videoId)) return Promise.resolve(cachePathFor(videoId));

  let pending = extracting.get(videoId);
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const watchUrl = 'https://www.youtube.com/watch?v=' + encodeURIComponent(videoId);
      const outTmpl = path.join(CACHE_DIR, videoId + '.%(ext)s');
      const args = [
        '-x',                       // extract audio (téléchargement + ffmpeg)
        '--audio-format', 'mp3',    // MP3 lisible par <audio> partout
        '--audio-quality', '5',     // ~64-96 kbps, ~5 Mo / 4 min
        '--no-warnings',
        '--no-playlist',
        '--no-cache-dir',
        '-o', outTmpl,
        watchUrl,
      ];
      const opts = { maxBuffer: 8 * 1024 * 1024, timeout: YTDLP_BIN_TIMEOUT_MS };

      execFile(YTDLP_BIN, args, opts, (err, stdout, stderr) => {
        const combined = String(stderr || '') + '\n' + String(stdout || '');
        if (RE_ANTIBOT.test(combined)) {
          const e = new Error('YouTube exige une vérification anti-bot.');
          e.code = 'antibot';
          return reject(e);
        }
        if (err) {
          if (/private video|video unavailable|not exist|been removed|not available in your country/i.test(combined)) {
            const e = new Error('Vidéo indisponible.');
            e.code = 'notfound';
            return reject(e);
          }
          if (/ffmpeg|avconv/i.test(combined) && ffmpegAvailable === false) {
            const e = new Error('ffmpeg est requis pour l\'extraction audio mais n\'est pas trouvé.');
            e.code = 'no-ffmpeg';
            return reject(e);
          }
          const e = new Error('yt-dlp -x a échoué : ' + (err.message || combined.slice(0, 200)));
          e.code = 'extract';
          return reject(e);
        }
        // yt-dlp écrit <id>.mp3. Si absent, cherche un autre format
        // (m4a/opus) qu'il aurait pu produire — le <audio> les lit aussi.
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
            return reject(e);
          }
          return resolve(found);
        }
        resolve(cachePathFor(videoId));
      });
    });
    pending.finally(() => extracting.delete(videoId));
    extracting.set(videoId, pending);
  }
  return pending;
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
app.get('/api/health', (req, res) => {
  res.json({ ok: true, port: PORT, ffmpeg: ffmpegAvailable, cache: 'disk' });
});

// --- GET /api/streams/:id ---
// Métadonnées via oEmbed (PAS de yt-dlp). ~0,15 s, ne bloque pas l'app.
// Renvoie un JSON compatible Piped pour le frontend (audioStreams[].url = /api/audio/:id).
app.get('/api/streams/:id', async (req, res) => {
  const id = req.params.id;
  if (!RE_VIDEOID.test(id)) return res.status(400).json({ error: 'videoId invalide.' });

  try {
    const meta = await fetchMeta(id);
    res.json({
      title: meta.title,
      duration: meta.duration,
      thumbnailUrl: meta.thumbnailUrl,
      uploader: meta.uploader,
      proxyUrl: '',
      audioStreams: [
        { url: '/api/audio/' + id, format: 'MP3', bitrate: 96, mimeType: 'audio/mpeg', videoOnly: false },
      ],
      videoStreams: [],
    });
  } catch (err) {
    if (err.code === 'notfound') return res.status(404).json({ error: err.message, code: 'notfound' });
    return res.status(502).json({ error: err.message || 'Extraction échouée.', code: err.code || 'extract' });
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
        res.status(500).json({ error: 'Fichier audio indisponible.' });
      }
    });
  } catch (err) {
    if (!res.headersSent) {
      const code = err.code === 'antibot' ? 451 : (err.code === 'notfound' ? 404 : (err.code === 'no-ffmpeg' ? 503 : 502));
      res.status(code).json({ error: err.message || 'Extraction audio échouée.', isAntiBot: err.code === 'antibot', code: err.code || 'extract' });
    }
  }
});

// --- Frontend statique (depuis la racine du projet) ---
app.use(express.static(ROOT, { extensions: ['html'] }));
// Le cache n'est PAS servi en statique (déjà exposé via /api/audio de façon contrôlée).
app.use('/cache', (req, res) => res.status(403).end());

// ===== Démarrage =====
// On ne teste QUE ffmpeg (rapide). yt-dlp est testé paresseusement au 1er
// /api/audio/:id (son --version met ~8s, on ne le met pas sur la voie critique).
function checkFfmpeg() {
  return new Promise((resolve) => {
    execFile('ffmpeg', ['-version'], { timeout: FFMPEG_TIMEOUT_MS }, (err, stdout) => {
      if (err) return resolve(false);
      const m = /^ffmpeg version (\S+)/.exec(String(stdout));
      resolve(m ? m[1] : true);
    });
  });
}

checkFfmpeg().then((fv) => {
  ffmpegAvailable = fv;
  app.listen(PORT, () => {
    console.log('');
    console.log('  YT Music Web Mixer — serveur local');
    console.log('  → http://localhost:' + PORT);
    console.log('');
    if (ffmpegAvailable) {
      console.log('  ✓ ffmpeg détecté' + (typeof fv === 'string' ? ' (v' + fv + ')' : '') + ' — extraction audio active.');
    } else {
      console.log('  ⚠ ffmpeg INTROUVABLE — l\'extraction audio échouera.');
      console.log('    Installez ffmpeg : https://ffmpeg.org/download.html');
    }
    console.log('  Cache audio : ' + CACHE_DIR);
    console.log('  (yt-dlp est appelé paresseusement au 1er chargement audio.)');
    console.log('  Ctrl+C pour arrêter.');
    console.log('');
  });
});

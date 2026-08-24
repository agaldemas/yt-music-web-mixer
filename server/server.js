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

// Cookies navigateur : certaines vidéos YouTube exigent une session
// (playability LOGIN_REQUIRED) même avec le client VISIONOS de la nightly.
// yt-dlp lit les cookies du navigateur indiqué. Défaut : chrome (celui de
// l'utilisateur). Désactiver : YTDLP_COOKIES_BROWSER=none.
//   ex : YTDLP_COOKIES_BROWSER=safari  (ou firefox, edge, brave…)
const YTDLP_COOKIES_BROWSER = process.env.YTDLP_COOKIES_BROWSER || 'chrome';

// Échec d'extraction des cookies NAVIGATEUR (Chrome fermé, trousseau bloqué,
// base verrouillée…) — distinct de l'anti-bot vidéo. Dans ce cas on retente
// l'extraction SANS --cookies-from-browser (certaines vidéos passent quand même).
const RE_COOKIES_ERR = /unable to (extract|retrieve|read).*cookie|could not find.*cookie|failed to decrypt|keyring|keychain|trousseau|not found in (chrome|safari|firefox|edge|brave|opera|arc)/i;

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
    console.log('[extract] ♻ cache disque pour ' + videoId + ' (' + cachePathFor(videoId) + ')');
    return Promise.resolve(cachePathFor(videoId));
  }

  let pending = extracting.get(videoId);
  if (!pending) {
    console.log('[extract] ▶ début extraction ' + videoId);
    pending = runExtract(videoId, true).catch((err) => {
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
      '--no-warnings',
      '--no-playlist',
      '--no-cache-dir',
      '-o', outTmpl,
      watchUrl,
    ];
    if (withCookies && YTDLP_COOKIES_BROWSER && YTDLP_COOKIES_BROWSER !== 'none') {
      args.splice(args.indexOf('-x') + 1, 0, '--cookies-from-browser', YTDLP_COOKIES_BROWSER);
    }
    const opts = { maxBuffer: 8 * 1024 * 1024, timeout: YTDLP_BIN_TIMEOUT_MS };

    execFile(YTDLP_BIN, args, opts, (err, stdout, stderr) => {
      const combined = String(stderr || '') + '\n' + String(stdout || '');
      if (RE_ANTIBOT.test(combined)) {
        const e = new Error('YouTube exige une vérification anti-bot.');
        e.code = 'antibot';
        // Log détaillé : la sortie yt-dlp permet de diagnostiquer (LOGIN_REQUIRED,
        // cookies requis, IP bloquée…) sans relancer à la main.
        console.error('[extract] ✗ ANTI-BOT ' + videoId + ' — ' + combined.trim().split('\n').slice(-8).join(' | '));
        return reject(e);
      }
      if (err) {
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
        const e = new Error('yt-dlp -x a échoué : ' + (err.message || combined.slice(0, 200)));
        e.code = 'extract';
        console.error('[extract] ✗ ÉCHEC ' + videoId + ' — ' + combined.trim().split('\n').slice(-5).join(' | '));
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
    const thumbPath = path.join(CACHE_DIR, videoId + '.jpg');
    const tmpPath = path.join(CACHE_DIR, videoId + '.cover.mp3');
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
  const embed = (extOf(file) === 'mp3') ? embedThumbnail(file, videoId) : Promise.resolve();
  embed.then(() => resolve(file));
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
    const code = err.code === 'antibot' ? 451 : (err.code === 'notfound' ? 404 : (err.code === 'no-ffmpeg' ? 503 : 502));
    console.error('[api] ✗ /api/audio/' + id + ' → HTTP ' + code + ' (' + (err.code || 'extract') + ') : ' + err.message);
    if (!res.headersSent) {
      res.status(code).json({ error: err.message || 'Extraction audio échouée.', isAntiBot: err.code === 'antibot', code: err.code || 'extract' });
    }
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
    const code = err.code === 'antibot' ? 451 : (err.code === 'notfound' ? 404 : (err.code === 'no-ffmpeg' ? 503 : 502));
    console.error('[api] ✗ /api/download/' + id + ' → HTTP ' + code + ' (' + (err.code || 'extract') + ') : ' + err.message);
    if (!res.headersSent) {
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
    if (YTDLP_COOKIES_BROWSER && YTDLP_COOKIES_BROWSER !== 'none') {
      console.log('  ✓ cookies ' + YTDLP_COOKIES_BROWSER + ' (--cookies-from-browser ' + YTDLP_COOKIES_BROWSER + ') — contourne LOGIN_REQUIRED');
    } else {
      console.log('  ⚠ cookies navigateur désactivés — les vidéos LOGIN_REQUIRED échoueront (451).');
      console.log('    Pour les activer : YTDLP_COOKIES_BROWSER=chrome|safari|firefox…');
    }
    console.log('  (yt-dlp est appelé paresseusement au 1er chargement audio.)');
    console.log('  Ctrl+C pour arrêter.');
    console.log('');
  });
});

// ===== Filet de sécurité global =====
// Le serveur ne doit JAMAIS mourir à cause d'une erreur DNS/yt-dlp/anti-bot :
// chaque route API a déjà son try/catch, mais on couvre les cas résiduels
// (promesse dérivée oubliée, callback async non bordé…). On loggue et on
// continue. Sans ces handlers, Node ≥ 15 tue le processus sur la moindre
// rejection non consommée — et l'app entière tombe.
process.on('unhandledRejection', (reason) => {
  console.error('[server] ⚠ unhandledRejection interceptée (serveur maintenu) :',
    reason instanceof Error ? reason.message : String(reason));
});

process.on('uncaughtException', (err) => {
  console.error('[server] ⚠ uncaughtException interceptée (serveur maintenu) :',
    err && err.message ? err.message : String(err));
  // Note : on ne re-lance pas volontairement ; l'état peut être dégradé sur
  // cette requête, mais le serveur reste en vie pour les suivantes.
});

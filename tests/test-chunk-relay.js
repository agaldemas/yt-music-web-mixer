// Test : stratégie re-extract-on-403 + reprise des chunks de 64 Ko.
// Simule ce que ferait le serveur : télécharge par chunks fermés ≤ 64 Ko,
// et quand le CDN bloque (403), re-extrait une URL neuve et reprend.
const { execFileSync } = require('child_process');
const CS = 65536;

function ytDlp(vid) {
  const out = execFileSync('yt-dlp', [
    '-f', 'ba', '--no-warnings', '--no-playlist', '--no-cache-dir', '-j',
    'https://www.youtube.com/watch?v=' + vid,
  ], { maxBuffer: 60 * 1024 * 1024 });
  const info = JSON.parse(out.toString());
  const a = (info.formats || [])
    .filter(f => f.vcodec === 'none' && f.acodec !== 'none' && f.abr > 0)
    .sort((x, y) => y.abr - x.abr)[0];
  return a.url;
}

async function chunk(url, start, end) {
  const r = await fetch(url, { headers: { Range: 'bytes=' + start + '-' + end } });
  return { status: r.status, b: Buffer.from(await r.arrayBuffer()) };
}

async function totalOf(url) {
  const r = await fetch(url, { headers: { Range: 'bytes=0-1023' } });
  const m = /\/(\d+)$/.exec(r.headers.get('content-range') || '');
  return m ? Number(m[1]) : 0;
}

(async () => {
  const vid = process.argv[2];
  let url = ytDlp(vid);
  let T = await totalOf(url);
  console.log('URL1 host:', new URL(url).hostname, 'total:', T, '(' + (T / 1024 / 1024).toFixed(2) + ' Mo)');

  let got = 0, i = 0, reExtracts = 0, consec403 = 0;
  const t0 = Date.now();
  while (got < T) {
    const r = await chunk(url, got, Math.min(got + CS - 1, T - 1));
    if (r.status === 206 && r.b.length > 0) {
      got += r.b.length;
      i++;
      consec403 = 0;
    } else {
      consec403++;
      reExtracts++;
      console.log('  blocage @' + got + ' (HTTP ' + r.status + ') → re-extraction #' + reExtracts);
      if (consec403 > 8) {
        console.log('  ABANDON : trop de blocages consécutifs');
        break;
      }
      url = ytDlp(vid);
      console.log('  nouvel host:', new URL(url).hostname);
      const T2 = await totalOf(url);
      if (T2 !== T) console.log('  ⚠ total changé:', T2, '(attendu', T, ')');
    }
  }
  const ms = Date.now() - t0;
  console.log('Résultat: ' + got + '/' + T + ' en ' + ms + 'ms (' + (got / 1024 / ms * 1000).toFixed(0) + ' Ko/s)');
  console.log('chunks:' + i + ' re-extractions:' + reExtracts + ' Complet: ' + (got >= T ? 'OUI ✓' : 'NON ✗'));
})().catch(e => console.log('ERR', e.message));

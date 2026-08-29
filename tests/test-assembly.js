// Test : le serveur peut-il assembler un fichier complet en chunks 64K ?
// On teste plusieurs stratégies pour passer le blocage @960 Ko :
//   A) chunks 64K séquentiels purs (baseline)
//   B) + User-Agent navigateur (Chrome) sur chaque requête
//   C) + délai entre les chunks (pacing)
//   D) + re-extraction au 1er 403 puis reprise
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

async function chunk(url, start, end, opts) {
  const headers = { Range: 'bytes=' + start + '-' + end };
  if (opts && opts.ua) headers['User-Agent'] = opts.ua;
  const r = await fetch(url, { headers });
  return { status: r.status, b: Buffer.from(await r.arrayBuffer()) };
}

async function totalOf(url, opts) {
  const r = await chunk(url, 0, 1023, opts);
  const m = /\/(\d+)$/.exec(
    (r.status === 206 ? '' : '') + ' ' // placeholder
  );
  // relire content-range proprement
  const r2 = await fetch(url, { headers: { Range: 'bytes=0-1023' } });
  const cr = r2.headers.get('content-range');
  const mm = /\/(\d+)$/.exec(cr || '');
  return mm ? Number(mm[1]) : 0;
}

async function strategyA(vid) {
  console.log('\n=== A) chunks 64K purs ===');
  const url = ytDlp(vid);
  const T = await totalOf(url);
  let got = 0, i = 0;
  const t0 = Date.now();
  while (got < T) {
    const r = await chunk(url, got, Math.min(got + CS - 1, T - 1));
    if (r.status !== 206) { console.log('  blocage @' + got + ' HTTP ' + r.status); break; }
    got += r.b.length; i++;
  }
  console.log('  A: ' + got + '/' + T + ' en ' + (Date.now() - t0) + 'ms (' + i + ' chunks) ' + (got >= T ? '✓' : '✗'));
  return got >= T;
}

async function strategyB(vid) {
  console.log('\n=== B) + User-Agent Chrome ===');
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  const url = ytDlp(vid);
  const T = await totalOf(url, { ua });
  let got = 0, i = 0;
  const t0 = Date.now();
  while (got < T) {
    const r = await chunk(url, got, Math.min(got + CS - 1, T - 1), { ua });
    if (r.status !== 206) { console.log('  blocage @' + got + ' HTTP ' + r.status); break; }
    got += r.b.length; i++;
  }
  console.log('  B: ' + got + '/' + T + ' en ' + (Date.now() - t0) + 'ms (' + i + ' chunks) ' + (got >= T ? '✓' : '✗'));
  return got >= T;
}

async function strategyC(vid) {
  console.log('\n=== C) + pacing (250ms entre chunks) ===');
  const url = ytDlp(vid);
  const T = await totalOf(url);
  let got = 0, i = 0;
  const t0 = Date.now();
  while (got < T) {
    const r = await chunk(url, got, Math.min(got + CS - 1, T - 1));
    if (r.status !== 206) { console.log('  blocage @' + got + ' HTTP ' + r.status); break; }
    got += r.b.length; i++;
    await new Promise(res => setTimeout(res, 250));
  }
  console.log('  C: ' + got + '/' + T + ' en ' + (Date.now() - t0) + 'ms (' + i + ' chunks) ' + (got >= T ? '✓' : '✗'));
  return got >= T;
}

(async () => {
  const vid = process.argv[2];
  console.log('video:', vid);
  const a = await strategyA(vid);
  const b = await strategyB(vid);
  const c = await strategyC(vid);
  console.log('\n=== BILAN ===');
  console.log('A (pur):', a, ' B (UA):', b, ' C (pacing):', c);
})().catch(e => console.log('ERR', e.message));

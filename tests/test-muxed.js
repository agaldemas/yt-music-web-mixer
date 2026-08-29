// Test : le flux MUXÉ (video+audio) est-il replayable (Range bytes=0- accepté) ?
// Hypothèse : le flux muxé contourne les verrous du flux audio-only.
const { execFileSync } = require('child_process');

function ytDlpFormats(vid) {
  // -j sans -f : renvoie tous les formats dans le JSON
  const out = execFileSync('yt-dlp', [
    '--no-warnings', '--no-playlist', '--no-cache-dir', '-j',
    'https://www.youtube.com/watch?v=' + vid,
  ], { maxBuffer: 60 * 1024 * 1024 }).toString();
  return JSON.parse(out);
}

(async () => {
  const vid = process.argv[2] || 'neHsQMaGzaY';
  const info = ytDlpFormats(vid);
  const fmts = info.formats || [];
  // muxé = a une piste audio ET video (ni l'un ni l'autre != none)
  const mux = fmts.filter(f => f.acodec !== 'none' && f.vcodec !== 'none');
  console.log('formats muxés:', mux.length);
  for (const f of mux.slice(0, 5)) {
    let c = '?'; try { c = new URL(f.url).searchParams.get('c') || '(no c)'; } catch (e) {}
    const sz = f.filesize || f.filesize_approx || '?';
    console.log('  itag=' + f.format_id + ' c=' + c + ' taille=' + sz + ' ext=' + f.ext + ' res=' + (f.width || '?') + 'x' + (f.height || '?'));
  }
  // test replay du 1er muxé
  const f = mux[0];
  if (!f) { console.log('AUCUN flux muxé'); return; }
  console.log('\ntest replay itag=' + f.format_id);
  const r = await fetch(f.url, { headers: { Range: 'bytes=0-' } });
  console.log('  Range bytes=0- → HTTP', r.status, 'len=' + r.headers.get('content-length'));
  if (r.status === 206 || r.status === 200) {
    const b = await r.arrayBuffer();
    console.log('  reçu', b.byteLength, 'octets (' + (b.byteLength / 1024 / 1024).toFixed(2) + ' Mo) ✓ REPLAYABLE');
  } else {
    console.log('  ✗ NON replayable');
  }
})().catch(e => console.log('ERR', e.message));

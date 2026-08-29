// Test youtubei.js : extraction d'une vidéo + replay de l'URL audio (Range bytes=0-)
// Valide l'hypothèse critique : les URLs sont-elles replayables par notre serveur ?
const { Innertube } = require('youtubei.js');

(async () => {
  const vid = process.argv[2] || 'neHsQMaGzaY';
  const t0 = Date.now();
  console.log('video:', vid);
  console.log('création Innertube…');
  const tube = await Innertube.create();
  console.log('  Innertube prêt en', Date.now() - t0, 'ms');

  const t1 = Date.now();
  console.log('getInfo…');
  const info = await tube.getInfo(vid);
  console.log('  getInfo en', Date.now() - t1, 'ms');
  console.log('  title:', info.basic_info?.title || info.video_data?.title);

  // choisir le meilleur format AUDIO (type: 'audio')
  const fmt = info.chooseFormat({ type: 'audio', quality: 'best' });
  if (!fmt || !fmt.url) { console.log('AUCUN format audio trouvé'); return; }
  console.log('  format choisi: itag=' + (fmt.itag) + ' mime=' + (fmt.mime_type) + ' abr=' + (fmt.bitrate));
  const url = fmt.url;
  let c = '?'; try { c = new URL(url).searchParams.get('c') || '(no c)'; } catch (e) {}
  console.log('  c=' + c);

  // test replay comme le serveur (node fetch, Range bytes=0-)
  const t2 = Date.now();
  const r = await fetch(url, { headers: { Range: 'bytes=0-' } });
  console.log('  fetch Range bytes=0- → HTTP', r.status, 'len=' + r.headers.get('content-length'));
  if (r.status === 206 || r.status === 200) {
    const buf = await r.arrayBuffer();
    console.log('  reçu', buf.byteLength, 'octets');
  }
  console.log('  replay en', Date.now() - t2, 'ms');
  console.log('TOTAL temps:', Date.now() - t0, 'ms');
})().catch(e => console.log('ERR', e.message, e.stack));

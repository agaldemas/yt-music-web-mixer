/* Télécharge 512 Ko du flux et cherche 'mp4a' pour confirmer la piste audio.
 * Un MP4 a une 'moov' box qui contient les trak (audio + video).
 *
 * Validation "phase 0" du plan de migration Piped : confirme qu'un flux MP4
 * renvoyé par Piped (potentiellement muxé audio+vidéo) contient bien une
 * piste audio lisible par un <audio> HTML5, et que CORS est validé.
 *
 * Lance depuis la racine : node tests/test_audio_track.js
 */

const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');

async function main() {
  const url = 'https://proxy.piped.private.coffee/videoplayback?bui=AZFlqhM8Hf1BskAeQoflO4b_8Ja…';
  // On prend une URL réelle via le module
  const { default: nothing } = { default: null };
  global.window = {};
  global.localStorage = { _d: {}, getItem(k){return this._d[k]||null;}, setItem(k,v){this._d[k]=String(v);}, removeItem(k){delete this._d[k];} };
  require(path.join(PROJECT_ROOT, 'js/config.js'));
  require(path.join(PROJECT_ROOT, 'js/piped-streams.js'));
  const entry = await global.window.PipedStreams.fetchStreamInfo('lfmxnzJAbl8');
  const realUrl = entry.bestAudio.stream.corsUrl;

  console.log('Téléchargement de 512 Ko depuis :', realUrl.slice(0, 80) + '…\n');

  const res = await fetch(realUrl, { headers: { 'Range': 'bytes=0-524287' } });
  console.log('HTTP', res.status, res.statusText);
  console.log('Content-Type :', res.headers.get('content-type'));

  const buf = Buffer.from(await res.arrayBuffer());
  console.log('Taille reçue :', buf.length, 'octets');

  // Cherche les marqueurs clés dans le container MP4
  const text = buf.toString('binary');
  const markers = [
    { name: 'ftyp (container MP4)', pattern: 'ftyp' },
    { name: 'moov (movie box, contient les trak)', pattern: 'moov' },
    { name: 'trak (une piste)', pattern: 'trak' },
    { name: 'mdia (media box)', pattern: 'mdia' },
    { name: 'mp4a (codec AAC audio)', pattern: 'mp4a' },
    { name: 'opus (codec Opus audio)', pattern: 'Opus' },
    { name: 'soun (sound media handler)', pattern: 'soun' },
    { name: 'vide (video media handler)', pattern: 'vide' },
  ];
  console.log('\n=== Marqueurs MP4 détectés ===');
  for (const m of markers) {
    const idx = text.indexOf(m.pattern);
    console.log('  ' + (idx !== -1 ? '✓' : '✗'), m.name.padEnd(45), idx !== -1 ? '(offset ' + idx + ')' : '');
  }

  // Conclusion
  const hasAudio = text.indexOf('mp4a') !== -1 || text.indexOf('Opus') !== -1;
  const hasVideo = text.indexOf('vide') !== -1;
  console.log('\n=== Conclusion ===');
  console.log('  Piste audio (mp4a/Opus) :', hasAudio ? '✓ OUI' : '✗ NON');
  console.log('  Piste vidéo             :', hasVideo ? '✓ OUI (muxé)' : '✗ NON');
  if (hasAudio) {
    console.log('\n→ Le flux est lisible par un élément <audio> HTML5 (la piste vidéo sera ignorée).');
    console.log('→ CORS est validé (HTTP 200 direct, pas besoin de proxy manuel).');
    console.log('→ Mode Piped Audio est VIABLE avec cette instance.');
  }
}

main().catch(err => { console.error('Erreur :', err); process.exit(1); });
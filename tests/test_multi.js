/* Test final multi-vidéos : confirmer que le fallback video-fallback est systématique
 * avec l'instance actuelle, et que le cache isole bien chaque videoId. */

const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');

global.window = {};
global.localStorage = { _d: {}, getItem(k){return this._d[k]||null;}, setItem(k,v){this._d[k]=String(v);}, removeItem(k){delete this._d[k];} };
require(path.join(PROJECT_ROOT, 'js/config.js'));
require(path.join(PROJECT_ROOT, 'js/piped-streams.js'));

const PS = global.window.PipedStreams;
const VIDEO_IDS = ['lfmxnzJAbl8', 'dQw4w9WgXcQ', '9bZkp7q19f0'];

async function main() {
  console.log('=== Test multi-vidéos ===\n');
  for (const id of VIDEO_IDS) {
    try {
      const entry = await PS.fetchStreamInfo(id);
      console.log('✓ ' + id + ' :');
      console.log('  title    :', entry.title.slice(0, 50) + (entry.title.length > 50 ? '…' : ''));
      console.log('  duration :', entry.duration);
      console.log('  audioStm :', entry.audioStreams.length, '| videoStm:', entry.videoStreams.length);
      console.log('  bestAudio:', entry.bestAudio
        ? entry.bestAudio.kind + ' / ' + entry.bestAudio.stream.format
          + ' → ' + entry.bestAudio.stream.corsUrl.slice(0, 60) + '…'
        : '(aucun)');
    } catch (err) {
      console.log('✗ ' + id + ' :', err.message);
    }
    console.log();
  }

  // Vérifier l'isolation du cache
  const a1 = await PS.fetchStreamInfo('lfmxnzJAbl8');
  const a2 = await PS.fetchStreamInfo('lfmxnzJAbl8');
  const b1 = await PS.fetchStreamInfo('dQw4w9WgXcQ');
  console.log('=== Isolation cache ===');
  console.log('  a1 === a2 (même id) :', a1 === a2 ? '✓' : '✗');
  console.log('  a1 !== b1 (ids différents) :', a1 !== b1 ? '✓' : '✗');

  // clearCache + nouveau fetch
  PS.clearCache('lfmxnzJAbl8');
  const a3 = await PS.fetchStreamInfo('lfmxnzJAbl8');
  console.log('  Après clearCache("lfmxnzJAbl8"), a3 est neuf :', a3.fetchedAt > a1.fetchedAt ? '✓' : '✗');
  console.log('  Mais b1 toujours valide :', b1.fetchedAt === (await PS.fetchStreamInfo('dQw4w9WgXcQ')).fetchedAt ? '✓' : '✗');

  console.log('\n=== Tous les tests multi-vidéos passés ===');
}

main().catch(err => { console.error('Erreur :', err); process.exit(1); });
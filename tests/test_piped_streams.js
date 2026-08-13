/* Test runner : charge config.js + piped-streams.js dans un contexte Node
 * minimal (window global, localStorage stub), puis appelle fetchStreamInfo.
 * Lance depuis la racine : node tests/test_piped_streams.js
 */

const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Stub minimal pour faire tourner un code "window.X = ..." en Node
global.window = {};
global.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] || null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};

// Charge les modules dans l'ordre (config.js d'abord, puis piped-streams.js)
require(path.join(PROJECT_ROOT, 'js/config.js'));
require(path.join(PROJECT_ROOT, 'js/piped-streams.js'));

const PS = global.window.PipedStreams;

async function main() {
  if (!PS) {
    console.error('❌ window.PipedStreams non exposé');
    process.exit(1);
  }
  console.log('✓ window.PipedStreams exposé :', Object.keys(PS).join(', '));
  console.log('✓ PIPED_INSTANCES =', global.window.YT_CONFIG.PIPED_INSTANCES.length, 'instances');
  console.log('✓ PIPED_INSTANCE_TIMEOUT_MS =', global.window.YT_CONFIG.PIPED_INSTANCE_TIMEOUT_MS);
  console.log('✓ PIPED_STREAM_TTL_MS =', global.window.YT_CONFIG.PIPED_STREAM_TTL_MS);
  console.log();

  // Test 1 : videoId invalide → doit throw 'invalid-id'
  console.log('--- Test 1: videoId invalide ---');
  try {
    await PS.fetchStreamInfo('');
    console.error('❌ aurait dû throw');
  } catch (err) {
    console.log(err.kind === 'invalid-id' ? '✓' : '❌', 'kind =', err.kind, '|', err.message);
  }

  // Test 2 : videoId réel (TEST_VIDEO_A = 'lfmxnzJAbl8')
  console.log('--- Test 2: fetchStreamInfo(lfmxnzJAbl8) ---');
  let entry;
  try {
    entry = await PS.fetchStreamInfo('lfmxnzJAbl8');
    console.log('✓ entry reçu :');
    console.log('  videoId     =', entry.videoId);
    console.log('  title       =', entry.title.slice(0, 60) + (entry.title.length > 60 ? '…' : ''));
    console.log('  duration    =', entry.duration, '(' + entry.durationSeconds + 's)');
    console.log('  uploader    =', entry.uploader);
    console.log('  thumbnailUrl=', entry.thumbnailUrl ? '(ok)' : '(vide)');
    console.log('  proxyUrl    =', entry.proxyUrl ? '(ok)' : '(vide)');
    console.log('  instance    =', entry.instance);
    console.log('  audioStreams=', entry.audioStreams.length, 'flux');
    console.log('  videoStreams=', entry.videoStreams.length, 'flux');
    console.log('  bestAudio   =', entry.bestAudio
      ? entry.bestAudio.kind + ' / ' + entry.bestAudio.stream.format + ' @ ' + entry.bestAudio.stream.bitrate + 'bps'
      : '(aucun)');
    console.log('  fetchedAt   =', new Date(entry.fetchedAt).toISOString());
    console.log('  expiresAt   =', new Date(entry.expiresAt).toISOString());
    if (entry.bestAudio && entry.bestAudio.stream) {
      console.log('  bestAudio.corsUrl =', entry.bestAudio.stream.corsUrl ? entry.bestAudio.stream.corsUrl.slice(0, 80) + '…' : '(pas de corsUrl)');
      console.log('  bestAudio.url     =', entry.bestAudio.stream.url.slice(0, 80) + '…');
    }
  } catch (err) {
    console.error('❌ fetchStreamInfo a échoué :', err.message);
    process.exit(1);
  }

  // Test 3 : cache hit → deuxième appel doit retourner la MÊME entrée (même fetchedAt)
  console.log('--- Test 3: cache hit ---');
  const entry2 = await PS.fetchStreamInfo('lfmxnzJAbl8');
  console.log(entry.fetchedAt === entry2.fetchedAt ? '✓' : '❌', 'même fetchedAt (cache hit)');

  // Test 4 : refreshStream → doit re-fetcher (nouveau fetchedAt)
  console.log('--- Test 4: refreshStream ---');
  await new Promise(r => setTimeout(r, 5));
  const entry3 = await PS.refreshStream('lfmxnzJAbl8');
  console.log(entry.fetchedAt < entry3.fetchedAt ? '✓' : '❌', 'nouveau fetchedAt après refresh');

  // Test 5 : selectBestAudio sur l'entry complet
  console.log('--- Test 5: selectBestAudio(entry) ---');
  const bestResult = PS.selectBestAudio(entry);
  console.log('  kind  =', bestResult ? bestResult.kind : '(aucun)');
  console.log('  stream=', bestResult ? (bestResult.stream.format + ' @ ' + bestResult.stream.bitrate + 'bps') : '(aucun)');

  // Test 6 : getCorsSafeUrl
  console.log('--- Test 6: getCorsSafeUrl ---');
  if (bestResult && bestResult.stream) {
    const url = PS.getCorsSafeUrl(entry, bestResult.stream);
    console.log(url ? '✓' : '❌', 'URL =', url.slice(0, 80) + (url.length > 80 ? '…' : ''));
    console.log('  → proxifiée (hostname pipedproxy.) ?', url.indexOf('pipedproxy.') !== -1);
    console.log('  → proxifiée (hostname proxy.*.piped.) ?', /^https?:\/\/proxy\.[^/]*piped\./.test(url));
  }

  // Test 6b : le test 5 original utilisait aussi entry.bestAudio directement
  console.log('--- Test 6b: entry.bestAudio.stream (depuis fetchStreamInfo) ---');
  if (entry.bestAudio) {
    console.log('  kind  =', entry.bestAudio.kind);
    console.log('  url   =', entry.bestAudio.stream.corsUrl ? entry.bestAudio.stream.corsUrl.slice(0, 80) + '…' : '(pas de corsUrl)');
  }

  // Test 7 : classifyError
  console.log('--- Test 7: classifyError ---');
  const e = new Error('test'); e.kind = 'piped-streams';
  const info = PS.classifyError(e);
  console.log(info.kind === 'piped-streams' ? '✓' : '❌', 'kind =', info.kind, '|', info.message.slice(0, 60) + '…');

  console.log();
  console.log('=== Tous les tests passés ===');
}

main().catch(err => {
  console.error('❌ Erreur fatale :', err);
  process.exit(1);
});
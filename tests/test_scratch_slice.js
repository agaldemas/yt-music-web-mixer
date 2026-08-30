const fs = require('fs');
const path = require('path');
const http = require('http');
const { createApp } = require('../server/server.js');

function assert(desc, condition) {
  if (condition) {
    console.log('  ✓ ' + desc);
  } else {
    console.error('  ✗ ' + desc);
    process.exitCode = 1;
  }
}

async function runLargeFileAndSliceTests() {
  console.log('=== test_scratch_slice.js ===');
  const app = createApp({ quiet: true });
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  // Récupère le token de session
  const sessionRes = await fetch(`${baseUrl}/api/session`);
  const sessionData = await sessionRes.json();
  const token = sessionData.token;

  // Test 1 : Route /api/scratch avec découpage de tranche sur un fichier audio existant
  const cacheFiles = fs.readdirSync(path.join(__dirname, '..', 'cache', 'audio'));
  const testMp3 = cacheFiles.find(f => f.endsWith('.mp3'));

  if (testMp3) {
    const videoId = testMp3.replace('.mp3', '');
    const res = await fetch(`${baseUrl}/api/scratch/${videoId}?t=120`, {
      headers: { 'X-Local-Token': token }
    });

    assert('GET /api/scratch/:id renvoie HTTP 200', res.status === 200);
    assert('Content-Type est audio/mpeg', res.headers.get('content-type') === 'audio/mpeg');
    assert('Header X-Scratch-Start présent', res.headers.has('x-scratch-start'));
    assert('Header X-Scratch-Duration présent', res.headers.has('x-scratch-duration'));

    const arrayBuffer = await res.arrayBuffer();
    assert('Tranche scratch non vide et légère (< 5 Mo)', arrayBuffer.byteLength > 1000 && arrayBuffer.byteLength < 5 * 1024 * 1024);
  } else {
    console.log('  ⚠ Aucun fichier MP3 en cache pour tester /api/scratch');
  }

  server.close();
}

runLargeFileAndSliceTests().catch((err) => {
  console.error('Erreur test_scratch_slice:', err);
  process.exit(1);
});

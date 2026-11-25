'use strict';
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const cp = require('node:child_process');

const ids = Array.from({ length: 2 }, () => randomBytes(8).toString('base64url'));
const starts = [];
process.env.PREFETCH_ENABLED = '1';
process.env.PREFETCH_MAX_PER_MIN = '60'; // Espacement observable en une seconde.
const realFetch = global.fetch;
global.fetch = (url, options) => String(url).startsWith('https://www.youtube.com/oembed?')
  ? Promise.resolve(Response.json({ title: 'Test', author_name: 'Test' }))
  : realFetch(url, options);
cp.execFile = (_bin, args, _options, callback) => {
  assert.ok(args.includes('--skip-download'));
  const id = new URL(args.at(-1)).searchParams.get('v');
  assert.ok(ids.includes(id));
  starts.push({ id, time: Date.now() });
  setTimeout(() => callback(null, 'NA\nDescription de ' + id, ''), 30);
};
const { createApp } = require('../server/server');

(async function () {
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const { token } = await (await fetch(base + '/api/session')).json();
    const auth = { 'X-Local-Token': token };
    const post = (batch, headers = auth) => fetch(base + '/api/prefetch', {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: batch }),
    });
    assert.equal((await post(ids, {})).status, 403);
    assert.equal((await post(['invalid/id'])).status, 400);
    assert.equal((await post(Array(21).fill(ids[0]))).status, 400);
    const accepted = await post([ids[0], ids[0], ids[1]]);
    assert.equal(accepted.status, 202);
    assert.deepEqual(await accepted.json(), { queued: 2 });
    assert.deepEqual(await (await post(ids)).json(), { queued: 0 });

    const deadline = Date.now() + 5000;
    while ((await (await fetch(base + '/api/health')).json()).prefetch.running) {
      if (Date.now() > deadline) throw new Error('Préchargement non terminé');
      await delay(50);
    }
    assert.deepEqual(starts.map(start => start.id), ids);
    assert.ok(starts[1].time - starts[0].time >= 950, 'Départs espacés, sans rafale');
    for (const id of ids) {
      const result = await fetch(base + '/api/description/' + id, { headers: auth });
      assert.equal(result.status, 200);
      assert.equal((await result.json()).description, 'Description de ' + id);
    }
    assert.equal(starts.length, 2, 'Le popup utilise le cache disque, sans nouvel appel yt-dlp');
    assert.deepEqual(await (await post(ids)).json(), { queued: 0 });
    console.log('Préchargement : lot authentifié, dédupliqué, espacé et relu depuis le cache.');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await Promise.all(ids.map(id => fs.rm(path.join(__dirname, '..', 'cache', 'meta', id + '.json'), { force: true })));
  }
})().catch(err => { console.error(err); process.exitCode = 1; });

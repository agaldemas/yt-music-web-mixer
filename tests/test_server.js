'use strict';
const http = require('http');
const { createApp } = require('../server/server');

(async function () {
  if (typeof createApp !== 'function') throw new Error('createApp absent');
  const appA = createApp();
  const appB = createApp();
  if (appA === appB) throw new Error('createApp doit retourner une nouvelle application');
  const server = appA.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    let r = await fetch(base + '/api/health');
    if (!r.ok) throw new Error('health');
    const health = await r.json();
    if (health.host !== '127.0.0.1') throw new Error('host');
    r = await fetch(base + '/package-lock.json');
    if (r.status !== 404) throw new Error('package exposé');
    r = await fetch(base + '/cache/meta/x.json');
    if (r.status !== 404) throw new Error('cache exposé');
    r = await fetch(base + '/api/meta/bad');
    if (r.status !== 403) throw new Error('api non protégée');
    const session = await (await fetch(base + '/api/session')).json();
    r = await fetch(base + '/api/meta/bad', { headers: { 'X-Local-Token': session.token } });
    if (r.status !== 400) throw new Error('jeton refusé');
    r = await fetch(base + '/api/ready');
    if (r.status !== 503) throw new Error('readiness attendue');
    const hostStatus = await new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: '/', headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    if (hostStatus !== 421) throw new Error('Host non local accepté: ' + hostStatus);
    console.log('Server factory: isolation, sécurité et readiness passées.');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
})().catch(e => { console.error(e); process.exit(1); });

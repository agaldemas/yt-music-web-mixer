/* CDP runner : pilote Chrome headless pour exécuter un test HTML et capturer les logs.
 *
 * Usage: node tests/cdp-runner.js <URL>
 *
 * Ce script :
 * 1. Se connecte au Chrome local (port 9222 via --remote-debugging-port)
 * 2. Ouvre un nouvel onglet sur l'URL fournie
 * 3. Capture tous les console.log et console.error
 * 4. Surveille un élément #status et attend qu'il soit "TERMINE" ou "ERREUR"
 * 5. Dump le contenu de <pre id="log">
 */

'use strict';

const http = require('http');
const WebSocket = require('ws');

const TARGET_URL = process.argv[2] || 'http://localhost:5400/test-scratch-autotest.html';
const STATUS_DONE = ['TERMINE', /ERREUR:/];

function fetchJson(path) {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:9222' + path, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function getTab(url) {
  // Crée toujours une nouvelle tab
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: 'localhost', port: 9222,
      path: '/json/new?' + encodeURIComponent(url),
      method: 'PUT',
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.end();
  });
}

class CDPClient {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.sessions = new Map();
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        const handler = this.handlers.get(msg.method);
        if (handler) handler(msg.params);
      }
    });
  }
  send(method, params, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const msg = { id, method, params: params || {} };
      if (sessionId) msg.sessionId = sessionId;
      this.ws.send(JSON.stringify(msg));
    });
  }
  on(method, handler) {
    if (!this.handlers) this.handlers = new Map();
    this.handlers.set(method, handler);
  }
}

async function run() {
  console.log('→ Récupération de la tab pour', TARGET_URL);
  const tab = await getTab(TARGET_URL);
  console.log('  Tab ID:', tab.id);
  console.log('  WebSocket:', tab.webSocketDebuggerUrl);

  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  const cdp = new CDPClient(ws);

  const logs = [];
  cdp.on('Runtime.consoleAPICalled', (params) => {
    const args = params.args.map(a => a.value !== undefined ? a.value : a.description || JSON.stringify(a)).join(' ');
    logs.push('[' + params.type + '] ' + args);
  });
  cdp.on('Runtime.exceptionThrown', (params) => {
    logs.push('[EXCEPTION] ' + (params.exceptionDetails.exception && params.exceptionDetails.exception.description) || params.exceptionDetails.text);
  });
  cdp.on('Log.entryAdded', (params) => {
    if (params.entry.level === 'error') {
      logs.push('[log.error] ' + params.entry.text);
    }
  });

  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');
  // Wait for Page.loadEventFired
  const loaded = new Promise(r => cdp.on('Page.loadEventFired', () => r()));
  await cdp.send('Page.reload', { ignoreCache: true });
  await loaded;
  console.log('→ Page loaded');
  await new Promise(r => setTimeout(r, 500));
  // Trouve les coordonnées du bouton #startBtn
  const rect = await cdp.send('Runtime.evaluate', {
    expression: 'JSON.stringify(document.getElementById("startBtn").getBoundingClientRect())',
    returnByValue: true,
  });
  console.log('Bouton rect:', rect.result.value);
  const r = JSON.parse(rect.result.value);
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  // Clic souris sur le bouton (Input.dispatchMouseEvent EST compté comme user gesture trusté
  // quand il cible un élément interactif dans la même frame)
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1,
  });
  await new Promise(r => setTimeout(r, 50));
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1,
  });
  console.log('→ Bouton cliqué en', cx, cy, '\n');

  // Boucle de polling sur #status
  let status = '';
  let lastLogCount = 0;
  const startTime = Date.now();
  while (Date.now() - startTime < 60000) {
    await new Promise(r => setTimeout(r, 500));
    const result = await cdp.send('Runtime.evaluate', {
      expression: 'document.getElementById("status").textContent',
      returnByValue: true,
    });
    status = result.result.value;
    if (logs.length > lastLogCount) {
      // print new logs as they come
      for (let i = lastLogCount; i < logs.length; i++) console.log(logs[i]);
      lastLogCount = logs.length;
    }
    if (status === 'TERMINE' || /^ERREUR/.test(status)) break;
  }
  console.log('\n→ Status final:', status);

  // Récupère le contenu complet de #log
  const logResult = await cdp.send('Runtime.evaluate', {
    expression: 'document.getElementById("log").textContent',
    returnByValue: true,
  });
  console.log('\n=== CONTENU DE #log ===');
  console.log(logResult.result.value);

  ws.close();
  process.exit(/^ERREUR/.test(status) ? 1 : 0);
}

run().catch(e => {
  console.error('Erreur fatale:', e.message);
  process.exit(2);
});
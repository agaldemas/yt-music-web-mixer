'use strict';
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { createApp } = require('../server/server');

(async function () {
  const id = randomBytes(8).toString('base64url');
  const missingId = randomBytes(8).toString('base64url');
  const cacheFile = path.join(__dirname, '..', 'cache', 'audio', id + '.mp3');
  const fixture = Buffer.from('MP3 de test');
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const { token } = await (await fetch(base + '/api/session')).json();
  const dom = new JSDOM('<button id="deck-save-local-a" disabled>Save local</button>', {
    url: base, runScripts: 'outside-only',
  });
  try {
    const win = dom.window;
    win.state = { backendMode: { A: 'iframe' }, sourceKind: { A: 'youtube' }, videoIds: { A: '' } };
    win.TextEncoder = TextEncoder;
    win.AbortController = AbortController; // Le signal est consommé par fetch de Node.
    let probes = 0;
    win.LocalAPI = {
      available: () => true,
      fetch: (url, options) => {
        if (url.startsWith('/api/download-ready/')) probes++;
        return fetch(base + url, { ...options, headers: { 'X-Local-Token': token } });
      },
    };
    for (const name of ['mp3-filename', 'local-save']) {
      win.eval(await fs.readFile(path.join(__dirname, '..', 'js', name + '.js'), 'utf8'));
    }
    const btn = win.document.querySelector('button');
    win.state.videoIds.A = id;
    await win.LocalSave.updateSaveButtonState('A');
    assert.equal(btn.disabled, true, 'Cache absent : Save reste désactivé');
    assert.equal((await win.LocalAPI.fetch('/api/download/' + id)).status, 404, 'GET ne lance pas d’extraction');

    await win.LocalSave.updateSaveButtonState('A');
    assert.equal(probes, 1, 'Les mises à jour du bandeau ne relancent pas le HEAD');
    await fs.writeFile(cacheFile, fixture, { flag: 'wx' });
    await win.LocalSave.updateSaveButtonState('A', null, true);
    assert.equal(btn.disabled, false, 'Le MP3 en cache active Save même en IFrame');
    const head = await win.LocalAPI.fetch('/api/download-ready/' + id, { method: 'HEAD' });
    assert.equal(await head.text(), '', 'HEAD ne transfère pas le fichier');
    const resp = await win.LocalAPI.fetch('/api/download/' + id);
    assert.equal(resp.headers.get('Content-Type'), 'audio/mpeg');
    assert.equal(resp.headers.get('Content-Disposition'), `attachment; filename="audio-${id}.mp3"`);
    const buildMp3Filename = require('../js/mp3-filename');
    assert.equal(buildMp3Filename('', '', '-ISJ5GtLB50'), 'audio--ISJ5GtLB50.mp3');
    assert.equal(buildMp3Filename('Titre', '', id), 'Titre.mp3');
    assert.deepEqual(Buffer.from(await resp.arrayBuffer()), fixture);

    const probesWhenReady = probes;
    for (const mode of ['iframe', 'piped']) {
      win.state.backendMode.A = mode;
      win.LocalSave.updateSaveButtonState('A', { id, title: 'Été / Live', uploader: 'Artiste' });
      let downloaded;
      let downloadName;
      let pickerOpened = false;
      win.showSaveFilePicker = async () => { pickerOpened = true; throw new Error('Sélecteur inattendu'); };
      win.URL.createObjectURL = blob => { downloaded = blob; return 'blob:' + base + '/test'; };
      win.URL.revokeObjectURL = () => {};
      win.HTMLAnchorElement.prototype.click = function () { downloadName = this.download; };
      await win.LocalSave.saveCurrent('A');
      assert.equal(pickerOpened, false, 'Le navigateur gère le téléchargement sans passer par son API d’écriture de fichiers');
      assert.equal(downloadName, 'Été - Live-Artiste.mp3');
      assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), fixture, 'Save local copie le fichier du cache');
    }
    await win.LocalSave.updateSaveButtonState('A', null, true);
    assert.equal(probes, probesWhenReady, 'Ni sauvegarde, ni rafraîchissement ne relancent le HEAD si le MP3 est prêt');
    assert.equal(win.state.videoIds.A, id, 'La sauvegarde ne remplace pas le morceau courant');

    win.state.videoIds.A = missingId;
    const check = win.LocalSave.updateSaveButtonState('A');
    assert.equal(btn.disabled, true, 'Un changement de morceau invalide immédiatement Save');
    await check;
    assert.equal(btn.disabled, true);
    console.log('Save local : cache seul, téléchargement et disponibilité en IFrame vérifiés.');
  } finally {
    dom.window.close();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(cacheFile, { force: true });
  }
})().catch(err => { console.error(err); process.exitCode = 1; });

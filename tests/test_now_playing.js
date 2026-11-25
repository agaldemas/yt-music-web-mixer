'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const firstId = 'UD5y5SbQaos';
const nextId = 'j9QXpfvgSVk';
const dom = new JSDOM(read('index.html'), {
  url: 'http://127.0.0.1:5400/', runScripts: 'outside-only', pretendToBeVisual: true,
});
const win = dom.window;
const players = {};
const saveInfo = {};
win.LocalSave = { updateSaveButtonState: (deck, info) => { saveInfo[deck] = info; } };
win.YT = { Player: function (id, opts) {
  players[id] = this;
  this.ready = () => opts.events.onReady({ target: this });
  this.playing = () => opts.events.onStateChange({ data: 1 });
  this.getVideoData = () => this.metadata;
  this.loadVideoById = videoId => { this.requestedId = videoId; };
  this.mute = this.unMute = this.setVolume = () => {};
  this.getCurrentTime = this.getDuration = () => 0;
} };
win.fetch = async () => ({ ok: true, json: async () => ({ items: [
  { url: '/watch?v=' + nextId, title: 'Kind of Blue (résultat)', uploaderName: 'Miles Davis', duration: 60 },
] }) });
win.LocalAPI = {
  available: () => true,
  fetch: async (url, options) => url.startsWith('/api/')
    ? { ok: url === '/api/video-info/' + firstId, json: async () => ({ title: 'Frank Zappa (oEmbed)' }) }
    : win.fetch(url, options),
};
for (const name of ['config', 'youtube', 'deck-controls', 'search', 'mixer', 'app']) win.eval(read('js/' + name + '.js'));
win.localStorage.setItem(win.YT_CONFIG.STORAGE_KEYS.LAST_VIDEO_A, firstId);

(async function () {
  try {
    await new Promise(resolve => win.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    await Promise.resolve(); // Résolution du mode auto avant création des lecteurs.
    const player = players['player-A'];
    assert.ok(player);
    const panel = win.document.querySelector('.deck-nowplaying[data-deck="A"]');
    const title = () => panel.querySelector('.np-title').textContent;
    const status = panel.querySelector('.np-download-status');
    player.ready();
    assert.notEqual(title(), firstId);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(title(), 'Frank Zappa (oEmbed)', 'Repli quand l’IFrame ne fournit pas de titre');
    assert.equal(saveInfo.A.title, title(), 'La sauvegarde reçoit le même titre oEmbed que le bandeau');
    player.metadata = { video_id: firstId, title: 'Frank Zappa - Live in Barcelona', author: 'Jorge Navarro' };
    player.playing();
    assert.equal(title(), player.metadata.title);
    assert.match(panel.querySelector('.np-meta').textContent, /Jorge Navarro.*YT IFrame/);

    await win.state.searches.A.search('miles davis');
    win.document.querySelector('.deck-results[data-deck="A"] .search-result button').click();
    assert.equal(player.requestedId, nextId);
    assert.equal(title(), 'Kind of Blue (résultat)', 'Le titre de recherche arrive avant les métadonnées IFrame');
    assert.equal(status.hidden, true, 'Pas de préparation audio en mode IFrame');
    player.playing(); // YouTube renvoie encore les données de la vidéo précédente.
    assert.equal(title(), 'Kind of Blue (résultat)');
    player.metadata = { video_id: nextId, title: 'Miles Davis - BnF collection sonore' };
    player.playing();
    assert.equal(title(), player.metadata.title);

    win.DeckTransport.setDownloadProgress('A', 0);
    assert.match(status.textContent, /Préparation/);
    assert.equal(status.hidden, false);
    assert.equal(title(), player.metadata.title, 'La préparation ne remplace jamais le titre');
    win.DeckTransport.clearDownloadStatus('A');
    assert.equal(status.hidden, true);
    assert.equal(title(), player.metadata.title);
    console.log('Bandeau : titre IFrame tardif, réponse périmée et statut indépendant vérifiés.');
  } finally { win.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });

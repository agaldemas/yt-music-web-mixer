'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
let scripts = 0, players = 0, destroys = 0;
global.window = { location: { protocol: 'http:', origin: 'http://127.0.0.1:5400' }, YT_CONFIG: { API_LOAD_TIMEOUT_MS: 50, PLAYER_VARS: {} } };
global.document = {
  createElement(tag) { return { tagName: tag, onerror: null, src: '' }; },
  head: { appendChild() { scripts += 1; } },
};
require(path.join(ROOT, 'js/youtube.js'));
window.YTWrapper.init(function () {});
window.YTWrapper.init(function () {});
if (scripts !== 1) throw new Error('chargement IFrame dupliqué');
const disposedBeforeReady = window.YTWrapper.createPlayer('player-A', {});
disposedBeforeReady.dispose();
window.YT = { Player: function (id, opts) {
  players += 1;
  this.destroy = function () { destroys += 1; };
  this.loadVideoById = this.cueVideoById = this.playVideo = this.pauseVideo = this.seekTo = this.setVolume = this.mute = this.unMute = function () {};
  this.getCurrentTime = this.getDuration = function () { return 0; };
  this.getPlayerState = function () { return -1; };
  queueMicrotask(() => opts.events.onReady({ target: this }));
} };
window.onYouTubeIframeAPIReady();
setTimeout(function () {
  if (players !== 0) throw new Error('player disposé créé après readiness');
  const active = window.YTWrapper.createPlayer('player-B', {});
  setTimeout(function () {
    if (players !== 1) throw new Error('player actif non créé');
    active.dispose();
    if (destroys !== 1) throw new Error('YT.Player.destroy non appelé');
    console.log('YTWrapper: chargement unique et dispose validés.');
  }, 0);
}, 0);

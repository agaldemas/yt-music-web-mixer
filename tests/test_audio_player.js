/* Test runner pour audio-player.js avec mocks DOM + Web Audio.
 *
 * Valide :
 *   - API publique exposée (window.AudioPlayer)
 *   - mappage des événements <audio> → STATE
 *   - loadVideoById déclenche fetchStreamInfo + set src
 *   - playVideo() appelle resume() + audio.play()
 *   - setVolume no-op
 *   - mute/unMute toggle
 *   - getCurrentTime/getDuration/getPlayerState
 *   - gestion expiration (audio.error → refreshStream)
 *   - erreurs propagées via onError
 *
 * On ne valide PAS la lecture audio réelle (Node ne supporte pas <audio>).
 */

const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Initialiser global.window avant tous les mocks qui en dépendent
global.window = {};
global.HTMLAudioElement = class {};

// ===== MOCK document =====
class MockAudioElement {
  constructor() {
    this.src = '';
    this.crossOrigin = '';
    this.preload = '';
    this.playsInline = false;
    this.preservesPitch = true;
    this.mozPreservesPitch = true;
    this.webkitPreservesPitch = true;
    this.volume = 1.0;
    this.paused = true;
    this.currentTime = 0;
    this.duration = 0;
    this.error = null;
    this.style = {};
    this._listeners = {};
    this._children = [];
  }
  appendChild(child) { this._children.push(child); return child; }
  addEventListener(event, handler) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(handler);
  }
  removeEventListener(event, handler) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(h => h !== handler);
  }
  _emit(event, payload) {
    if (!this._listeners[event]) return;
    this._listeners[event].forEach(h => h(payload || {}));
  }
  _triggerError(code) {
    this.error = { code: code, message: 'mock error ' + code };
    this._emit('error');
  }
  load() { /* no-op */ }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
    return Promise.resolve();
  }
}

const mockAudioElSingleton = new MockAudioElement();

const mockDocument = {
  createElement: function (tag) {
    if (tag === 'audio') return new MockAudioElement();
    return {};
  },
  getElementById: function () { return mockAudioElSingleton; },
  querySelector: function () { return mockAudioElSingleton; },
  body: { appendChild: function () {} },
  addEventListener: function () {},
  readyState: 'complete',
};

global.document = mockDocument;
global.HTMLAudioElement = MockAudioElement;

// ===== MOCK AudioContext (minimal) =====
class MockParam {
  constructor(v) { this.value = v; this._lastTarget = v; }
  setValueAtTime(v) { this.value = v; }
  setTargetAtTime(v) { this._lastTarget = v; }
  linearRampToValueAtTime(v) { this.value = v; }
}
class MockAudioNode {
  constructor(ctx, type) {
    this.ctx = ctx;
    this._connections = [];
    Object.defineProperty(this, 'type', { value: type, writable: true });
  }
  connect(dest) { this._connections.push(dest); return dest; }
  disconnect() { this._connections = []; }
}
class MockGainNode extends MockAudioNode {
  constructor(ctx) { super(ctx, 'GainNode'); this.gain = new MockParam(1); }
}
class MockAnalyserNode extends MockAudioNode {
  constructor(ctx) { super(ctx, 'AnalyserNode'); this.fftSize = 0; this.smoothingTimeConstant = 0; }
}
class MockBiquadFilterNode extends MockAudioNode {
  constructor(ctx) { super(ctx, 'BiquadFilter'); this.frequency = new MockParam(350); this.gain = new MockParam(0); this.Q = new MockParam(1); }
}
class MockMediaElementAudioSourceNode extends MockAudioNode {
  constructor(ctx, el) { super(ctx, 'MediaElementSource'); this.mediaElement = el; }
}

class MockAudioContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this._destination = new MockAudioNode(this, 'destination');
  }
  createGain() { return new MockGainNode(this); }
  createAnalyser() { return new MockAnalyserNode(this); }
  createBiquadFilter() { return new MockBiquadFilterNode(this); }
  createMediaElementSource(el) { return new MockMediaElementAudioSourceNode(this, el); }
  get destination() { return this._destination; }
  resume() { this.state = 'running'; return Promise.resolve(); }
}

const mockCtx = new MockAudioContext();

// ===== MOCK PipedStreams =====
const pipedMock = {
  _fetchImpl: null,
  fetchStreamInfo: function (id) {
    if (this._fetchImpl) return this._fetchImpl(id);
    return Promise.resolve({
      videoId: id,
      title: 'Mock Track',
      bestAudio: { stream: { url: 'https://example.com/' + id + '.m4a', mimeType: 'audio/mp4' }, kind: 'audio' },
      proxyUrl: 'https://proxy.example',
    });
  },
  refreshStream: function (id) { return this.fetchStreamInfo(id); },
  getCorsSafeUrl: function (entry, stream) { return stream && stream.url ? stream.url : ''; },
  classifyError: function (err) {
    if (err && err.kind === 'invalid-id') return { kind: 'invalid-id', message: 'ID invalide' };
    return { kind: 'network', message: 'Erreur réseau mock' };
  },
};
global.window.PipedStreams = pipedMock;

// ===== MOCK AudioEngine =====
const aeMock = {
  _chains: Object.create(null),
  init: function () {},
  resume: function () { return Promise.resolve('running'); },
  createDeckChain: function (deckId, audioEl) {
    if (this._chains[deckId]) throw new Error('deck ' + deckId + ' déjà actif');
    this._chains[deckId] = {
      audioEl: audioEl,
      source: { type: 'MediaElementSource' },
      lowShelf: { type: 'lowshelf' },
      midPeak: { type: 'peaking' },
      highShelf: { type: 'highshelf' },
      djFilter: { type: 'allpass' },
      deckGain: { gain: new MockParam(0.5) },
      analyser: { type: 'AnalyserNode' },
    };
    return this._chains[deckId];
  },
  destroyDeckChain: function (deckId) { delete this._chains[deckId]; return true; },
  hasDeck: function (deckId) { return !!this._chains[deckId]; },
  getAnalyser: function (deckId) { return this._chains[deckId] ? this._chains[deckId].analyser : null; },
  getContext: function () { return mockCtx; },
};
global.window.AudioEngine = aeMock;

// ===== YTWrapper.STATE =====
global.window.YTWrapper = { STATE: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } };

// ===== Helpers de test =====
let pass = 0, fail = 0;
function assert(label, cond, detail) {
  if (cond) { console.log('  ✓', label); pass++; }
  else { console.log('  ✗', label, detail || ''); fail++; }
}

// ===== Tests =====
async function main() {
  console.log('=== Test 1 : API publique ===');
  require(path.join(PROJECT_ROOT, 'js/audio-player.js'));
  const AP = global.window.AudioPlayer;
  assert('window.AudioPlayer défini', !!AP);
  assert('  - createAudioPlayer', typeof AP.createAudioPlayer === 'function');
  assert('  - STATE défini', !!AP.STATE);
  assert('  - STATE.UNSTARTED === -1', AP.STATE.UNSTARTED === -1);
  assert('  - STATE.PLAYING === 1', AP.STATE.PLAYING === 1);
  assert('  - STATE.PAUSED === 2', AP.STATE.PAUSED === 2);
  assert('  - STATE.BUFFERING === 3', AP.STATE.BUFFERING === 3);
  assert('  - STATE.ENDED === 0', AP.STATE.ENDED === 0);
  assert('  - STATE.CUED === 5', AP.STATE.CUED === 5);

  console.log('\n=== Test 2 : mappage event → STATE ===');
  assert('  loadstart → UNSTARTED', AP._audioEventToState('loadstart') === -1);
  assert('  emptied → UNSTARTED', AP._audioEventToState('emptied') === -1);
  assert('  loadedmetadata → CUED', AP._audioEventToState('loadedmetadata') === 5);
  assert('  canplay → CUED', AP._audioEventToState('canplay') === 5);
  assert('  playing → PLAYING', AP._audioEventToState('playing') === 1);
  assert('  pause → PAUSED', AP._audioEventToState('pause') === 2);
  assert('  waiting → BUFFERING', AP._audioEventToState('waiting') === 3);
  assert('  stalled → BUFFERING', AP._audioEventToState('stalled') === 3);
  assert('  ended → ENDED', AP._audioEventToState('ended') === 0);
  assert('  event inconnu → null', AP._audioEventToState('xyz') === null);

  console.log('\n=== Test 3 : createAudioPlayer minimal ===');
  let readyCalled = false, stateChanges = [], errorCalled = null;
  const p = AP.createAudioPlayer('TEST', {
    onReady: function () { readyCalled = true; },
    onStateChange: function (e) { stateChanges.push(e.data); },
    onError: function (err) { errorCalled = err; },
  });
  assert('wrapper retourné', !!p);
  assert('loadVideoById existe', typeof p.loadVideoById === 'function');
  assert('cueVideoById existe', typeof p.cueVideoById === 'function');
  assert('playVideo existe', typeof p.playVideo === 'function');
  assert('pauseVideo existe', typeof p.pauseVideo === 'function');
  assert('seekTo existe', typeof p.seekTo === 'function');
  assert('setVolume existe', typeof p.setVolume === 'function');
  assert('mute existe', typeof p.mute === 'function');
  assert('unMute existe', typeof p.unMute === 'function');
  assert('getCurrentTime existe', typeof p.getCurrentTime === 'function');
  assert('getDuration existe', typeof p.getDuration === 'function');
  assert('getPlayerState existe', typeof p.getPlayerState === 'function');

  console.log('\n=== Test 4 : createAudioPlayer crée un <audio> crossOrigin=anonymous ===');
  const audioEl = p._getAudioElement();
  assert('  <audio> créé', audioEl instanceof MockAudioElement);
  assert('  crossOrigin=anonymous', audioEl.crossOrigin === 'anonymous');
  assert('  preload=auto', audioEl.preload === 'auto');
  assert('  preservesPitch=true', audioEl.preservesPitch === true);
  assert('  display:none', audioEl.style.display === 'none');

  console.log('\n=== Test 5 : loadVideoById déclenche fetchStreamInfo + set src ===');
  let fetchedId = null;
  pipedMock._fetchImpl = function (id) {
    fetchedId = id;
    return Promise.resolve({
      videoId: id,
      bestAudio: { stream: { url: 'https://mock.cdn/' + id + '.m4a' }, kind: 'audio' },
    });
  };
  p.loadVideoById('abc123XYZ_-');
  await new Promise(r => setTimeout(r, 30));
  assert('  fetchStreamInfo appelé avec l\'id', fetchedId === 'abc123XYZ_-');
  assert('  audio.src = URL CORS-safe', audioEl.src === 'https://mock.cdn/abc123XYZ_-.m4a');

  console.log('\n=== Test 6 : loadVideoById gère fetchStreamInfo erreur ===');
  pipedMock._fetchImpl = function () {
    const err = new Error('mock fail'); err.kind = 'network';
    return Promise.reject(err);
  };
  let errorReceived = null;
  const p2 = AP.createAudioPlayer('TEST2', {
    onReady: function () {},
    onStateChange: function () {},
    onError: function (err) { errorReceived = err; },
  });
  p2.loadVideoById('xxTESTxx_-');
  await new Promise(r => setTimeout(r, 30));
  assert('  onError appelé', errorReceived !== null);
  assert('  message d\'erreur présent', errorReceived && errorReceived.message);

  console.log('\n=== Test 7 : getCurrentTime/getDuration/getPlayerState ===');
  const p3 = AP.createAudioPlayer('TEST3', {});
  const el3 = p3._getAudioElement();
  el3.currentTime = 12.5;
  el3.duration = 180;
  assert('  getCurrentTime = 12.5', p3.getCurrentTime() === 12.5);
  assert('  getDuration = 180', p3.getDuration() === 180);
  el3.duration = NaN;
  assert('  getDuration avec NaN → 0', p3.getDuration() === 0);
  assert('  getPlayerState initial = UNSTARTED', p3.getPlayerState() === -1);

  console.log('\n=== Test 8 : playVideo() → resume + play() ===');
  let resumeCalled = false;
  aeMock.resume = function () { resumeCalled = true; return Promise.resolve(); };
  const p4 = AP.createAudioPlayer('TEST4', {});
  const el4 = p4._getAudioElement();
  let playCalled = false;
  el4.play = function () { playCalled = true; el4.paused = false; return Promise.resolve(); };
  p4.playVideo();
  await new Promise(r => setTimeout(r, 10));
  assert('  AudioEngine.resume() appelé', resumeCalled === true);
  assert('  audio.play() appelé', playCalled === true);

  console.log('\n=== Test 9 : pauseVideo/seekTo ===');
  const p5 = AP.createAudioPlayer('TEST5', {});
  const el5 = p5._getAudioElement();
  el5.pause = function () { el5.paused = true; };
  p5.pauseVideo();
  assert('  pauseVideo → audio.paused = true', el5.paused === true);
  p5.seekTo(45.7);
  assert('  seekTo → audio.currentTime = 45.7', el5.currentTime === 45.7);
  p5.seekTo(-10); // clampé à 0
  assert('  seekTo négatif clampé à 0', el5.currentTime === 0);

  console.log('\n=== Test 10 : mute/unMute toggle ===');
  const p6 = AP.createAudioPlayer('TEST6', {});
  const el6 = p6._getAudioElement();
  p6.mute();
  assert('  mute() → audio.volume = 0', el6.volume === 0);
  p6.unMute();
  assert('  unMute() → audio.volume = 1.0', el6.volume === 1.0);

  console.log('\n=== Test 11 : setVolume est un no-op ===');
  const p7 = AP.createAudioPlayer('TEST7', {});
  const el7 = p7._getAudioElement();
  el7.volume = 0.5;
  p7.setVolume(0); // ne doit rien faire
  assert('  setVolume ne modifie pas audio.volume', el7.volume === 0.5);

  console.log('\n=== Test 12 : événements → onStateChange ===');
  let states = [];
  const p8 = AP.createAudioPlayer('TEST8', {
    onReady: function () {},
    onStateChange: function (e) { states.push(e.data); },
    onError: function () {},
  });
  const el8 = p8._getAudioElement();
  el8._emit('playing'); // commence par playing, le 1er UNSTARTED est anti-doublon
  assert('  playing → PLAYING notifié', states[states.length - 1] === 1);
  el8._emit('pause');
  assert('  pause → PAUSED notifié', states[states.length - 1] === 2);
  el8._emit('ended');
  assert('  ended → ENDED notifié', states[states.length - 1] === 0);
  // loadstart maintenant (depuis PAUSED, transition valide)
  el8._emit('loadstart');
  assert('  loadstart depuis PAUSED → UNSTARTED notifié', states[states.length - 1] === -1);
  el8._emit('playing');
  assert('  playing → PLAYING notifié', states[states.length - 1] === 1);
  el8._emit('playing'); // doublon → pas notifié 2 fois
  // On vérifie qu'il y a eu 1 seule notification PLAYING à ce point (avant l'anti-doublon) ;
  // mais comme 'playing' avant loadstart ne crée qu'un seul PLAYING, puis loadstart, puis
  // re-playing, on s'attend à 2 PLAYING après le re-playing. Le doublon anti-doublon
  // ne devrait pas en ajouter un 3e.
  const playCount = states.filter(s => s === 1).length;
  assert('  playing doublon ignoré (max 2 PLAYING)', playCount === 2);
  el8._emit('pause');
  assert('  pause → PAUSED notifié', states[states.length - 1] === 2);
  el8._emit('ended');
  assert('  ended → ENDED notifié', states[states.length - 1] === 0);

  console.log('\n=== Test 13 : expiration → refreshStream + reprise ===');
  let refreshCalledWith = null;
  pipedMock._fetchImpl = function (id) {
    if (refreshCalledWith === null) {
      refreshCalledWith = 'first';
      return Promise.resolve({
        videoId: id,
        bestAudio: { stream: { url: 'https://first.cdn/' + id + '.m4a' }, kind: 'audio' },
      });
    }
    refreshCalledWith = id;
    return Promise.resolve({
      videoId: id,
      bestAudio: { stream: { url: 'https://refresh.cdn/' + id + '.m4a' }, kind: 'audio' },
    });
  };
  pipedMock.refreshStream = function (id) { return pipedMock._fetchImpl(id); };
  let errorsAfterRefresh = 0;
  const p9 = AP.createAudioPlayer('TEST9', {
    onReady: function () {},
    onStateChange: function () {},
    onError: function () { errorsAfterRefresh++; },
  });
  const el9 = p9._getAudioElement();
  p9.loadVideoById('vidTEST_-');
  await new Promise(r => setTimeout(r, 20));
  assert('  1er src chargé', el9.src === 'https://first.cdn/vidTEST_-.m4a');
  el9._triggerError(2); // MEDIA_ERR_NETWORK
  await new Promise(r => setTimeout(r, 30));
  assert('  refreshStream appelé', refreshCalledWith === 'vidTEST_-');
  assert('  src mis à jour après refresh', el9.src === 'https://refresh.cdn/vidTEST_-.m4a');

  console.log('\n=== Test 14 : erreur non-retryable (MEDIA_ERR_ABORTED) ignorée ===');
  const p10 = AP.createAudioPlayer('TEST10', {});
  const el10 = p10._getAudioElement();
  let refreshAfterAbort = false;
  pipedMock.refreshStream = function () { refreshAfterAbort = true; return Promise.resolve({ bestAudio: null }); };
  el10._triggerError(1); // MEDIA_ERR_ABORTED
  await new Promise(r => setTimeout(r, 10));
  assert('  refreshStream PAS appelé pour code 1', refreshAfterAbort === false);

  console.log('\n=== Test 15 : échec après 2 refresh → onError ===');
  let finalError = null;
  const p11 = AP.createAudioPlayer('TEST11', {
    onReady: function () {},
    onStateChange: function () {},
    onError: function (err) { finalError = err; },
  });
  const el11 = p11._getAudioElement();
  pipedMock.refreshStream = function () {
    const err = new Error('still failing'); err.kind = 'network';
    return Promise.reject(err);
  };
  // Charger une vidéo pour fixer currentVideoId
  pipedMock._fetchImpl = function (id) {
    return Promise.resolve({
      videoId: id,
      bestAudio: { stream: { url: 'https://fail.cdn/' + id + '.m4a' }, kind: 'audio' },
    });
  };
  p11.loadVideoById('failTEST_-');
  await new Promise(r => setTimeout(r, 30));
  // 1er refresh (refreshCount=0→1), refreshStream rejette → catch → onError réseau
  el11._triggerError(2);
  await new Promise(r => setTimeout(r, 100));
  // 2e refresh (refreshCount=1→2), refreshStream rejette → catch → onError réseau
  el11._triggerError(2);
  await new Promise(r => setTimeout(r, 100));
  // 3e erreur : refreshCount=2 → bloqué avant incrément → message "2 tentatives"
  el11._triggerError(2);
  await new Promise(r => setTimeout(r, 100));
  assert('  onError appelé après 3 échecs', finalError !== null);
  assert('  message d\'épuisement présent', finalError && /2 tentatives/.test(finalError.message));

  console.log('\n=== Test 16 : cueVideoById = loadVideoById sans play ===');
  let cueError = null;
  const p12 = AP.createAudioPlayer('TEST12', { onError: function (e) { cueError = e; } });
  const el12 = p12._getAudioElement();
  pipedMock._fetchImpl = function (id) {
    return Promise.resolve({
      videoId: id,
      bestAudio: { stream: { url: 'https://cue.cdn/' + id + '.m4a' }, kind: 'audio' },
    });
  };
  p12.cueVideoById('cueTEST_-');
  await new Promise(r => setTimeout(r, 20));
  assert('  src chargé après cue', el12.src === 'https://cue.cdn/cueTEST_-.m4a');
  assert('  pas d\'erreur', cueError === null);

  console.log('\n=== Test 17 : loadVideoById sans flux audio disponible → erreur ===');
  let noStreamError = null;
  const p13 = AP.createAudioPlayer('TEST13', {
    onError: function (e) { noStreamError = e; },
  });
  const el13 = p13._getAudioElement();
  pipedMock._fetchImpl = function (id) {
    return Promise.resolve({ videoId: id, bestAudio: null });
  };
  p13.loadVideoById('nostrmTEST');
  await new Promise(r => setTimeout(r, 20));
  assert('  onError appelé (no stream)', noStreamError !== null);
  assert('  message "Aucun flux audio"', noStreamError && /Aucun flux audio/.test(noStreamError.message));

  console.log('\n=== Test 18 : canplay → onReady ===');
  let readyCalledPending = false;
  const p14 = AP.createAudioPlayer('TEST14', {
    onReady: function () { readyCalledPending = true; },
    onStateChange: function () {},
    onError: function () {},
  });
  const el14 = p14._getAudioElement();
  el14._emit('canplay');
  assert('  onReady appelé sur canplay', readyCalledPending === true);

  console.log('\n=== Résumé ===');
  console.log('Pass:', pass, '/ Fail:', fail);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(function (e) {
  console.error('Test runner crashed:', e);
  process.exit(2);
});
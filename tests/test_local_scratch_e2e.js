const fs = require('fs');
const path = require('path');

function assert(desc, condition) {
  if (condition) {
    console.log('  ✓ ' + desc);
  } else {
    console.error('  ✗ ' + desc);
    process.exitCode = 1;
  }
}

class MockAudioParam {
  constructor(val = 0) { this.value = val; }
  setValueAtTime(v) { this.value = v; }
  setTargetAtTime(v) { this.value = v; }
  linearRampToValueAtTime(v) { this.value = v; }
}

class MockAudioNode {
  constructor() { this._connections = []; }
  connect(dest) { this._connections.push(dest); return dest; }
  disconnect() { this._connections = []; }
}

class MockGainNode extends MockAudioNode {
  constructor(ctx) { super(); this.gain = new MockAudioParam(1); }
}

class MockBiquadFilterNode extends MockAudioNode {
  constructor(ctx) {
    super();
    this.frequency = new MockAudioParam(1000);
    this.gain = new MockAudioParam(0);
    this.Q = new MockAudioParam(1);
    this.type = 'lowpass';
  }
}

class MockAnalyserNode extends MockAudioNode {
  constructor(ctx) { super(); this.fftSize = 2048; this.frequencyBinCount = 1024; }
  getByteFrequencyData(arr) { arr.fill(0); }
  getByteTimeDomainData(arr) { arr.fill(128); }
}

class MockAudioBufferSourceNode extends MockAudioNode {
  constructor(ctx) {
    super();
    this.playbackRate = new MockAudioParam(1);
    this.buffer = null;
    this.onended = null;
  }
  start(when, offset) { this._started = { when, offset }; }
  stop() { this._stopped = true; }
}

class MockMediaElementAudioSourceNode extends MockAudioNode {
  constructor(ctx, opts) { super(); this.mediaElement = opts && opts.mediaElement; }
}

class MockAudioContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = new MockAudioNode();
  }
  createGain() { return new MockGainNode(this); }
  createBiquadFilter() { return new MockBiquadFilterNode(this); }
  createAnalyser() { return new MockAnalyserNode(this); }
  createBufferSource() { return new MockAudioBufferSourceNode(this); }
  createMediaElementSource(el) { return new MockMediaElementAudioSourceNode(this, { mediaElement: el }); }
  decodeAudioData(buf) {
    const bytes = buf.byteLength || 0;
    // Si la tranche est légère (< 15 Mo), le décodage passe instantanément
    if (bytes > 20 * 1024 * 1024) {
      return Promise.reject(new Error('EncodingError: Unable to decode audio data (Buffer too large)'));
    }
    return Promise.resolve({
      duration: 180,
      numberOfChannels: 2,
      sampleRate: 44100,
      length: 180 * 44100
    });
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
}

class MockAudioElement {
  constructor() {
    this.src = '';
    this.volume = 1;
    this.paused = true;
    this.currentTime = 1200;
    this.duration = 5570;
    this.style = {};
    this._listeners = {};
  }
  addEventListener(n, h) { (this._listeners[n] || (this._listeners[n] = [])).push(h); }
  removeEventListener(n, h) { this._listeners[n] = (this._listeners[n] || []).filter(x => x !== h); }
  _emit(n) { (this._listeners[n] || []).slice().forEach(h => h({ target: this })); }
  load() {}
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
}

async function runLocalAndScratchFullTest() {
  console.log('=== test_local_scratch_e2e.js ===');

  global.window = {};
  global.HTMLAudioElement = MockAudioElement;
  global.window.HTMLAudioElement = MockAudioElement;
  global.window.AudioContext = MockAudioContext;
  global.window.webkitAudioContext = MockAudioContext;
  global.AudioContext = MockAudioContext;
  global.webkitAudioContext = MockAudioContext;

  global.document = {
    createElement: (tag) => {
      if (tag === 'audio') {
        return {
          src: '',
          volume: 1,
          paused: true,
          currentTime: 1200,
          duration: 5570,
          style: {},
          _listeners: {},
          addEventListener(n, h) { (this._listeners[n] || (this._listeners[n] = [])).push(h); },
          removeEventListener(n, h) { this._listeners[n] = (this._listeners[n] || []).filter(x => x !== h); },
          _emit(n) { (this._listeners[n] || []).slice().forEach(h => h({ target: this })); },
          load() {},
          play() { this.paused = false; return Promise.resolve(); },
          pause() { this.paused = true; }
        };
      }
      return { appendChild() {}, style: {}, setAttribute() {}, addEventListener() {} };
    },
    getElementById: () => null,
    querySelector: () => null,
    body: { appendChild() {} },
    readyState: 'complete'
  };

  let blobCounter = 0;
  global.URL = {
    createObjectURL: (blob) => `blob:http://localhost:5400/mock-${++blobCounter}`,
    revokeObjectURL: () => {}
  };
  global.Blob = class { constructor(parts, opts) { this.parts = parts; this.type = opts && opts.type; } };
  global.requestAnimationFrame = (cb) => setTimeout(cb, 16);
  global.cancelAnimationFrame = (id) => clearTimeout(id);
  global.performance = { now: () => Date.now() };

  window.state = {
    players: {},
    sourceKind: {},
    backendMode: {},
    videoIds: {}
  };
  window.DeckTransport = {
    setDownloadProgress: () => {},
    setDownloadError: () => {},
    clearDownloadStatus: () => {}
  };
  window.YTWrapper = { STATE: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } };

  window.PipedStreams = {
    fetchStreamInfo: () => Promise.resolve({ bestAudio: { stream: { url: 'mock' } } }),
    getCachedStream: () => null,
    getCorsSafeUrl: () => 'mock'
  };

  // 1. Modules
  require('../js/mp3-slice.js');
  require('../js/audio-engine.js');
  const AE = window.AudioEngine;
  AE.init();

  require('../js/audio-player.js');
  const AP = window.AudioPlayer;

  require('../js/scratch.js');
  const Scratch = window.Scratch;

  // Création Deck A (createAudioPlayer crée déjà la chaîne AudioEngine en interne)
  const playerA = AP.createAudioPlayer('A', {});
  window.state.players.A = playerA;

  // Test avec le vrai fichier big-audio-for-test.mp3 s'il est présent
  const bigPath = path.join(__dirname, '..', 'big-audio-for-test.mp3');
  let rawBuf;
  if (fs.existsSync(bigPath)) {
    const fileBytes = fs.readFileSync(bigPath);
    rawBuf = fileBytes.buffer.slice(fileBytes.byteOffset, fileBytes.byteOffset + fileBytes.byteLength);
    console.log('  → Test avec big-audio-for-test.mp3 (' + (rawBuf.byteLength/1024/1024).toFixed(1) + ' Mo)');
  } else {
    rawBuf = new Uint8Array(80 * 1024 * 1024).buffer;
  }

  const mockFile = {
    name: 'big-audio-for-test.mp3',
    type: 'audio/mpeg',
    size: rawBuf.byteLength,
    arrayBuffer: () => Promise.resolve(rawBuf.slice(0))
  };

  await playerA.loadLocalFile(mockFile);
  assert('Gros fichier local chargé avec Blob URL', playerA._getAudioElement().src.startsWith('blob:http://localhost:5400/mock-'));
  assert('sourceKind est local', window.state.sourceKind.A === 'local');

  // Déclencher loadedmetadata
  playerA._getAudioElement()._emit('loadedmetadata');

  // Test Découpage Mp3Slice en tranche de 3 min
  const slice = window.Mp3Slice.sliceMp3Window(rawBuf, 5570, 1200, 180);
  assert('Tranche découpée légère (< 5 Mo)', slice.buffer.byteLength < 5 * 1024 * 1024 && slice.buffer.byteLength > 10000);
  assert('Offset de tranche calculé', slice.sliceStartSec >= 0);

  // Test Décodage de la tranche via AE.loadDeckBufferFromBlob
  const decoded = await AE.loadDeckBufferFromBlob('A', slice.buffer);
  assert('Buffer scratch local décodé avec succès', !!decoded && decoded.duration === 180);

  // Test Engage Scratch sur Gros Fichier Local
  const engageRes = await AE.engageScratch('A');
  assert('Scratch engagé avec succès sur gros fichier local', !!engageRes && typeof engageRes.offset === 'number');

  // Test Disengage
  AE.disengageScratch('A', 1205, false);
  await new Promise(r => setTimeout(r, 50));
  assert('Scratch désengagé proprement', !AE.isScratchEngaged('A'));

  playerA.dispose();
  AE.destroyDeckChain('A');
}

runLocalAndScratchFullTest().catch((err) => {
  console.error('Erreur test_local_scratch_e2e:', err);
  process.exit(1);
});

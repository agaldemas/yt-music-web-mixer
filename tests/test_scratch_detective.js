/* Test DÉTECTIVE : qui écrit audio.currentTime pendant le release du scratch ?
 *
 * Reproduit le scénario complet :
 *   - engageScratch à position X
 *   - mouvement (setScratchRate 1)
 *   - disengageScratch(target=Y, wasPlaying=true)
 *   - log TOUS les writes sur audio.currentTime (par qui, depuis où)
 *
 * Si on observe un write de audio.currentTime = X (position de démarrage)
 * APRÈS disengageScratch(target=Y), on a trouvé le coupable.
 *
 * Lancé par : node tests/test_scratch_detective.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MP3_PATH = path.resolve(__dirname, '..', 'Mandjou_QDIUL6T5GQU.mp3');
if (!fs.existsSync(MP3_PATH)) {
  console.error('ERREUR : MP3 manquant → ' + MP3_PATH);
  process.exit(2);
}

const PROJECT_ROOT = path.resolve(__dirname, '..');

// ===== Mock AudioContext + nodes (comme test_scratch_release.js) =====

class MockAudioParam {
  constructor(v) { this.value = v; }
  setValueAtTime(v) { this.value = v; }
  setTargetAtTime(v) { this._target = v; this.value = v; }
  linearRampToValueAtTime(v) { this.value = v; }
  cancelScheduledValues() {}
  cancelAndHoldAtTime() {}
}

class MockNode {
  constructor(ctx, type) { this.ctx = ctx; this.type = type; this._connections = []; }
  connect(dest) { if (!dest) throw new Error('connect: null'); this._connections.push(dest); return dest; }
  disconnect() { this._connections = []; }
}
class MockGainNode extends MockNode {
  constructor(ctx) { super(ctx, 'GainNode'); this.gain = new MockAudioParam(1); }
}
class MockAnalyserNode extends MockNode {
  constructor(ctx) { super(ctx, 'AnalyserNode'); this.fftSize=0; this.smoothingTimeConstant=0; }
  getByteFrequencyData() {}
  getByteTimeDomainData() {}
}
class MockBiquadFilterNode extends MockNode {
  constructor(ctx) {
    super(ctx, 'BiquadFilter');
    this._type = 'lowpass';
    this.frequency = new MockAudioParam(350);
    this.gain = new MockAudioParam(0);
    this.Q = new MockAudioParam(1);
  }
  get type() { return this._type; }
  set type(v) { this._type = v; }
}
class MockBufferSource extends MockNode {
  constructor(ctx) {
    super(ctx, 'BufferSource');
    this.buffer = null;
    this.playbackRate = new MockAudioParam(1);
    this._onended = null;
  }
  start() {}
  stop() { if (this._onended) this._onended(); }
  set onended(fn) { this._onended = fn; }
}
class MockMediaElementSource extends MockNode {
  constructor(ctx, el) { super(ctx, 'MediaElementSource'); this.mediaElement = el; el._mediaElementSource = this; }
}
class MockAudioContext {
  constructor() {
    this.currentTime = 0;
    this.state = 'running';
    this.sampleRate = 44100;
    this._destination = new MockNode(this, 'destination');
  }
  createGain() { return new MockGainNode(this); }
  createAnalyser() { return new MockAnalyserNode(this); }
  createBiquadFilter() { return new MockBiquadFilterNode(this); }
  createBufferSource() { return new MockBufferSource(this); }
  createMediaElementSource(el) {
    if (el._mediaElementSource) {
      const err = new Error("createMediaElementSource: already connected");
      err.name = 'InvalidStateError';
      throw err;
    }
    return new MockMediaElementSource(this, el);
  }
  get destination() { return this._destination; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  decodeAudioData(buf) {
    return Promise.resolve({
      duration: 30, sampleRate: 44100, length: 44100*30,
      numberOfChannels: 1, getChannelData: () => new Float32Array(44100*30),
    });
  }
}

// ===== Mock AudioElement AVEC INTERCEPTION du setter currentTime =====

class MockAudioElement {
  constructor() {
    this.src = '';
    this.crossOrigin = '';
    this.paused = true;
    this.duration = 100;
    this.playbackRate = 1;
    this._currentTime = 0;
    this._listeners = {};
    this.volume = 1;
    this.error = null;
    this.preload = 'auto';
    this.preservesPitch = true;
    this.mozPreservesPitch = true;
    this.webkitPreservesPitch = true;
    // === Spy sur currentTime ===
    const self = this;
    this._writes = [];
    this._currentTimeSetter = function (v) {
      const t = (typeof performance !== 'undefined') ? performance.now() : Date.now();
      const stack = (new Error()).stack.split('\n').slice(2, 5).map(s => s.trim()).join(' ← ');
      self._writes.push({ time: t, from: self._currentTime, to: v, stack });
      console.log(`  [SPY ${t.toFixed(0)}ms] audio.currentTime = ${v.toFixed(3)} (was ${self._currentTime.toFixed(3)}) ← ${stack}`);
      self._currentTime = v;
    };
  }
  get currentTime() { return this._currentTime; }
  set currentTime(v) { this._currentTimeSetter(v); }
  addEventListener(type, handler) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(handler);
  }
  removeEventListener(type, handler) {
    if (!this._listeners[type]) return;
    this._listeners[type] = this._listeners[type].filter(h => h !== handler);
  }
  dispatchEvent(evt) {
    const handlers = this._listeners[evt && evt.type] || [];
    handlers.forEach(h => { try { h(evt); } catch (e) {} });
  }
  pause() { this.paused = true; }
  play() { this.paused = false; return Promise.resolve(); }
  load() {}
}

// ===== Setup global =====

const mockCtx = new MockAudioContext();
global.window = {
  AudioContext: function () { return mockCtx; },
  webkitAudioContext: function () { return mockCtx; },
  document: {
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    getElementById: function () { return null; },
    addEventListener: function () {},
    createElement: function () { return { style:{}, classList:{add:function(){},remove:function(){}}, addEventListener:function(){}, removeEventListener:function(){}, appendChild:function(){}, insertBefore:function(){}, setAttribute:function(){}, getBoundingClientRect:function(){return{left:0,top:0,width:0,height:0,right:0,bottom:0};}, querySelector:function(){return null;} }; },
  },
  location: { origin: 'http://localhost', href: 'http://localhost/' },
  navigator: { userAgent: 'Node' },
  localStorage: { _data:{}, getItem(k){return this._data[k]||null;}, setItem(k,v){this._data[k]=v;}, removeItem(k){delete this._data[k];} },
  fetch: function () { return Promise.reject(new Error('fetch')); },
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
  performance: { now: () => Date.now() },
  DeckTransport: { setTime: () => {} },
};
global.document = global.window.document;
global.HTMLAudioElement = MockAudioElement;
global.Audio = MockAudioElement;
global.requestAnimationFrame = global.window.requestAnimationFrame;
global.cancelAnimationFrame = global.window.cancelAnimationFrame;

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

// ===== Chargement modules =====

console.log('=== Chargement modules ===');
try {
  require(path.join(PROJECT_ROOT, 'js/config.js'));
  require(path.join(PROJECT_ROOT, 'js/audio-engine.js'));
  console.log('✓ modules chargés\n');
} catch (e) {
  console.error('✗ load:', e.message);
  process.exit(2);
}

const AE = global.window.AudioEngine;

async function main() {
  const audio = new MockAudioElement();
  audio.duration = 30;
  audio.currentTime = 10; // via setter → écrit _currentTime + spy log
  audio.paused = false;
  AE.createDeckChain('TEST', audio);

  const mp3 = fs.readFileSync(MP3_PATH).buffer;
  await AE.loadDeckBufferFromBlob('TEST', mp3);

  console.log('\n=== ENGAGE scratch ===');
  await AE.engageScratch('TEST');
  console.log(`  audio.currentTime après engage = ${audio.currentTime.toFixed(2)}s`);

  // Reset le spy log pour ne garder que les writes post-engage
  audio._writes = [];

  console.log('\n=== MOUVEMENT (rate=1 pendant 500ms) ===');
  mockCtx.currentTime = 0;
  AE.setScratchRate('TEST', 1);
  await wait(100);
  mockCtx.currentTime += 0.1;
  AE.setScratchRate('TEST', 1);
  await wait(100);
  mockCtx.currentTime += 0.1;
  AE.setScratchRate('TEST', 1);
  await wait(100);
  mockCtx.currentTime += 0.1;
  AE.setScratchRate('TEST', 1);
  await wait(100);
  mockCtx.currentTime += 0.1;
  AE.setScratchRate('TEST', 1);
  const pos = AE.getScratchPosition('TEST');
  console.log(`  getScratchPosition = ${pos.toFixed(2)}s (attendu ≈ 14.5)`);

  console.log('\n=== DISENGAGE (target=' + pos.toFixed(2) + ', wasPlaying=true) ===');
  console.log('  audio.currentTime AVANT disengage = ' + audio.currentTime.toFixed(2) + 's');

  // Reset spy pour ne logger que les writes après disengage
  audio._writes = [];
  AE.disengageScratch('TEST', pos, true);

  // Attend le drain de 800ms + un peu de marge pour capter tous les writes
  for (let i = 0; i < 25; i++) { await wait(50); }

  console.log('\n=== APRÈS DISENGAGE ===');
  console.log(`  audio.currentTime FINAL = ${audio.currentTime.toFixed(2)}s`);
  console.log(`  target attendu = ${pos.toFixed(2)}s`);

  const writes = audio._writes;
  console.log(`\n=== ${writes.length} writes de currentTime APRÈS disengage ===`);
  writes.forEach((w, i) => {
    console.log(`  [${i+1}] ${w.time.toFixed(0)}ms  ${w.from.toFixed(2)} → ${w.to.toFixed(2)}`);
    console.log(`      ← ${w.stack}`);
  });

  // === DIAGNOSTIC ===
  const initialOffset = 10; // ce que l'audio avait à l'engage
  const snapBack = writes.find(w => Math.abs(w.to - initialOffset) < 0.5);
  const loopInBack = writes.find(w => w.to < initialOffset - 0.5);
  console.log('\n=== DIAGNOSTIC ===');
  if (snapBack) {
    console.log(`✗ SNAP-BACK détecté ! Quelqu'un a écrit currentTime=${snapBack.to.toFixed(2)} (= position de DÉBUT du scratch)`);
    console.log('  ← ' + snapBack.stack);
  } else if (loopInBack) {
    console.log(`✗ REBOUCLAGE détecté : currentTime écrit à ${loopInBack.to.toFixed(2)} (= loopIn ou début)`);
    console.log('  ← ' + loopInBack.stack);
  } else if (writes.length === 0) {
    console.log(`⚠️  Aucun write de currentTime après disengage. Position préservée.`);
  } else {
    console.log(`✓ Writes cohérents : aucun retour à la position initiale`);
  }

  const finalDelta = Math.abs(audio.currentTime - pos);
  console.log(`\n  delta position finale = ${finalDelta.toFixed(2)}s`);
  console.log(`  → ${finalDelta < 0.5 ? '✓ OK (position finale correcte)' : '✗ SNAP-BACK : ' + (audio.currentTime - pos).toFixed(2) + 's'}`);
}

main().then(() => process.exit(0)).catch(e => {
  console.error('FATAL:', e); console.error(e.stack); process.exit(2);
});

/* Test ciblé : release du scratch doit repositionner l'audio à la position FINALE.
 *
 * Charge le VRAI code à TOUS les étages :
 *   - js/audio-engine.js (Web Audio API + disengageScratch)
 *   - js/scratch.js (logique platine, engage/disengage via Pointer Events)
 *   - js/audio-player.js (création <audio> + bridge vers AudioEngine)
 *   - js/deck-controls.js (transport UI)
 *   - js/config.js (constantes)
 *
 * Le test vérifie le comportement à chaque étage, identifie OÙ dans la chaîne
 * le `audio.currentTime` est réinitialisé au DÉBUT du scratch au lieu d'être
 * repositionné à la FIN.
 *
 * Utilise @Mandjou_QDIUL6T5GQU.mp3 (à la racine) pour vérifier qu'il existe.
 *
 * Lancé par : node tests/test_scratch_release.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MP3_PATH = path.resolve(__dirname, '..', 'Mandjou_QDIUL6T5GQU.mp3');
if (!fs.existsSync(MP3_PATH)) {
  console.error('ERREUR : MP3 manquant → ' + MP3_PATH);
  process.exit(2);
}
console.log('✓ MP3 : ' + MP3_PATH + ' (' + fs.statSync(MP3_PATH).size + ' octets)\n');

const PROJECT_ROOT = path.resolve(__dirname, '..');

// ===== Mock <audio> fidèle au comportement Chrome =====
// Reproduit le bug : load() reset le moteur mais le MediaElementSource garde
// son buffer interne. Snap-back au prochain play() si on assigne currentTime
// sur un élément paused-puis-load().

class MockAudioElement {
  constructor() {
    this.src = '';
    this.crossOrigin = '';
    this.paused = true;
    this.duration = 100;
    this.playbackRate = 1;
    this._currentTime = 0;
    this._eventLog = [];
    this._loadCount = 0;
    this._listeners = {};
    this.volume = 1;
    this._muted = false;
    this.error = null;
    this.playsInline = false;
    this.style = {};
    this.parentNode = null;
    this.preload = 'auto';
    this.preservesPitch = true;
    this.mozPreservesPitch = true;
    this.webkitPreservesPitch = true;
    // === Modélisation fidèle du bug Chrome ===
    // _seekTarget : la valeur que l'utilisateur/programme vient d'assigner
    //   à currentTime (via setter). Représente le "voulu".
    // _bufferPlayPosition : la position dans l'ancien buffer préchargé
    //   que le MediaElementSource continue à jouer. Représente le "joué".
    // Tant que le buffer n'est pas vidé, currentTime rendu = _bufferPlayPosition.
    // Une fois vidé, currentTime rendu = _seekTarget.
    this._seekTarget = 0;
    this._bufferPlayPosition = 0;
    this._bufferActive = false;
  }
  addEventListener(type, handler) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(handler);
  }
  removeEventListener(type, handler) {
    if (!this._listeners[type]) return;
    this._listeners[type] = this._listeners[type].filter(function (h) { return h !== handler; });
  }
  dispatchEvent(evt) {
    var handlers = this._listeners[evt && evt.type] || [];
    handlers.forEach(function (h) { try { h(evt); } catch (e) { /* ignore */ } });
  }
  _log(name, detail) {
    this._eventLog.push({ name, detail: detail || {}, t: this._eventLog.length });
  }
  get muted() { return this._muted; }
  set muted(v) {
    this._log('set muted', { value: !!v });
    this._muted = !!v;
  }
  get currentTime() {
    if (this._bufferActive && !this.paused) {
      return this._bufferPlayPosition;
    }
    return this._seekTarget;
  }
  set currentTime(v) {
    this._log('set currentTime', { from: this.currentTime, to: v });
    this._seekTarget = v;
    this._currentTime = v;
    // Si on assigne une nouvelle cible pendant que le buffer joue encore,
    // le buffer continue de jouer l'ancien contenu (Chrome bug).
    // Modélise l'événement 'seeked' du navigateur : déclenché après l'assignation.
    // En vrai Chrome, il est asynchrone — ici on simule en microtask pour ne pas
    // bloquer le test. Mais on laisse aussi dispatchSeeked() pour les tests
    // qui veulent contrôler le timing (cf. audio-engine.js fix v3).
    setTimeout(() => this.dispatchEvent({ type: 'seeked' }), 0);
  }
  // Permet aux tests de déclencher 'seeked' explicitement (quand on veut
  // éviter la course avec les microtasks, ou simuler que seeked arrive tard).
  dispatchSeeked() { this.dispatchEvent({ type: 'seeked' }); }
  pause() {
    this._log('pause', { currentTime: this.currentTime, bufferActive: this._bufferActive });
    this.paused = true;
  }
  play() {
    this._log('play', { currentTime: this.currentTime, bufferActive: this._bufferActive });
    this.paused = false;
    return Promise.resolve();
  }
  load() {
    this._loadCount++;
    this._log('load', { wasCurrentTime: this._currentTime });
    // Chrome : audio.load() reset le moteur. Le MediaElementSource garde
    // son buffer interne (samples accumulés pendant que la source était
    // déconnectée). On modélise : _bufferPlayPosition repart de la valeur
    // assignée précédente (_seekTarget), et le buffer dure 1s avant que
    // le seek soit honoré.
    // ⚠️ Le bug ne se produit QUE si le MediaElementSource a un buffer
    // accumulé (après déconnexion pendant le scratch). Un load() normal
    // (chargement de fichier) n'active pas le buffer.
    if (this._mediaElementSource && this._mediaElementSource._internalBufferSec > 0) {
      this._bufferPlayPosition = this._seekTarget;
      this._bufferActive = true;
      this._bufferStartTime = Date.now();
      this._bufferDurationMs = 800; // 800ms de buffer préchargé (Chrome)
    }
  }
  // À appeler pour simuler le temps qui passe et faire avancer _bufferPlayPosition.
  tickAdvance(dtMs) {
    if (this._bufferActive && !this.paused) {
      this._bufferPlayPosition += dtMs / 1000;
      this._bufferDurationMs -= dtMs;
      if (this._bufferDurationMs <= 0) {
        // Buffer vidé : le seek est enfin honoré.
        this._bufferActive = false;
        this._bufferPlayPosition = this._seekTarget;
      }
      if (this._mediaElementSource) {
        this._mediaElementSource._bufferDrained += dtMs / 1000;
      }
    }
  }
}

// ===== Mock AudioContext + nodes =====

class MockAudioParam {
  constructor(v) { this.value = v; }
  setValueAtTime(v) { this.value = v; }
  setTargetAtTime(v) { this._target = v; this.value = v; }
  linearRampToValueAtTime(v) { this.value = v; }
  cancelScheduledValues() {}
  cancelAndHoldAtTime() {}
}

class MockNode {
  constructor(ctx, type) {
    this.ctx = ctx;
    this.type = type;
    this._connections = [];
  }
  connect(dest) {
    if (!dest) throw new Error('connect: null');
    this._connections.push(dest);
    return dest;
  }
  disconnect() { this._connections = []; }
}

class MockGainNode extends MockNode {
  constructor(ctx) { super(ctx, 'GainNode'); this.gain = new MockAudioParam(1); }
}
class MockAnalyserNode extends MockNode {
  constructor(ctx) {
    super(ctx, 'AnalyserNode');
    this.fftSize = 0;
    this.smoothingTimeConstant = 0;
  }
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
  constructor(ctx, el) {
    super(ctx, 'MediaElementSource');
    this.mediaElement = el;
    el._mediaElementSource = this;
    this._internalBufferSec = 0;
    this._bufferDrained = 0;
    el._bufferActive = false; // reset l'état de buffer de l'audio
    el._bufferPlayPosition = el._seekTarget;
  }
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
    // ⚠️ Contrainte RÉELLE des navigateurs (spec Web Audio) : un élément
    // <audio> ne peut être connecté qu'UNE SEULE FOIS à un
    // MediaElementAudioSourceNode, pour toute sa vie. Le mock doit la
    // reproduire — sinon les tests laissent passer du code qui explose en
    // vrai Chrome avec InvalidStateError (deck définitivement muet).
    if (el._mediaElementSource) {
      const err = new Error("Failed to execute 'createMediaElementSource' on "
        + "'AudioContext': HTMLMediaElement already connected previously to a "
        + 'different MediaElementSourceNode.');
      err.name = 'InvalidStateError';
      throw err;
    }
    return new MockMediaElementSource(this, el);
  }
  get destination() { return this._destination; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  close() { return Promise.resolve(); }
  decodeAudioData(buf) {
    // Mock : retourne un fake AudioBuffer.
    return Promise.resolve({
      duration: 30, sampleRate: 44100, length: 44100 * 30,
      numberOfChannels: 1, getChannelData: () => new Float32Array(44100 * 30),
    });
  }
}

// ===== Setup global =====

const mockCtx = new MockAudioContext();
global.window = {
  AudioContext: function () { return mockCtx; },
  webkitAudioContext: function () { return mockCtx; },
  // Mock pour scratch.js (qui utilise document, etc.)
  document: {
    querySelector: function (sel) {
      // Retourne un mock de platine pour selector ".platter".
      if (sel.indexOf('platter') !== -1 || sel.indexOf('.deck') !== -1) {
        return {
          addEventListener: function () {},
          removeEventListener: function () {},
          appendChild: function () {},
          insertBefore: function () {},
          setAttribute: function () {},
          firstChild: null,
          style: {},
          getBoundingClientRect: function () {
            return { left: 100, top: 100, width: 200, height: 200, right: 300, bottom: 300 };
          },
          querySelector: function () { return null; },
          classList: { add: function () {}, remove: function () {}, contains: function () { return false; } },
          dataset: {},
        };
      }
      return null;
    },
    querySelectorAll: function () { return []; },
    getElementById: function () { return null; },
    addEventListener: function () {},
    createElement: function (tag) {
      if (tag === 'audio') return new MockAudioElement();
      if (tag === 'canvas') {
        return {
          getContext: function () { return {}; },
          width: 0, height: 0,
          style: {},
          addEventListener: function () {},
        };
      }
      return {
        style: {},
        classList: { add: function () {}, remove: function () {} },
        addEventListener: function () {},
        removeEventListener: function () {},
        appendChild: function () {},
        insertBefore: function () {},
        setAttribute: function () {},
        getBoundingClientRect: function () {
          return { left: 100, top: 100, width: 200, height: 200, right: 300, bottom: 300 };
        },
        querySelector: function () { return null; },
      };
    },
  },
  location: { origin: 'http://localhost:5400', href: 'http://localhost:5400/' },
  navigator: { userAgent: 'Node' },
  localStorage: {
    _data: {},
    getItem: function (k) { return this._data[k] || null; },
    setItem: function (k, v) { this._data[k] = v; },
    removeItem: function (k) { delete this._data[k]; },
  },
  fetch: function () { return Promise.reject(new Error('fetch not available in Node')); },
  AbortSignal: { timeout: function () { return { aborted: false }; } },
  setTimeout: setTimeout,
  setInterval: setInterval,
  clearTimeout: clearTimeout,
  clearInterval: clearInterval,
  requestAnimationFrame: function () { return 0; },
  cancelAnimationFrame: function () {},
  URL: {
    createObjectURL: function () { return 'blob:mock-' + Math.random().toString(36).slice(2); },
    revokeObjectURL: function () {},
  },
  performance: { now: function () { return Date.now(); } },
  DeckTransport: { setTime: function () {} },
};
global.document = global.window.document;
global.HTMLAudioElement = MockAudioElement;
global.Audio = MockAudioElement;
global.PointerEvent = function () {};
global.requestAnimationFrame = global.window.requestAnimationFrame;
global.cancelAnimationFrame = global.window.cancelAnimationFrame;
// URL est native en Node 18+, mais on override pour le mock window
global.window.URL.createObjectURL = global.window.URL.createObjectURL;
global.window.URL.revokeObjectURL = global.window.URL.revokeObjectURL;

let pass = 0, fail = 0;
function assert(label, cond, detail) {
  if (cond) { console.log('  ✓ ' + label); pass++; }
  else { console.log('  ✗ ' + label + (detail ? '  → ' + detail : '')); fail++; }
}
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

// ===== Chargement des modules dans l'ordre =====

console.log('=== Chargement des modules réels ===\n');

try {
  require(path.join(PROJECT_ROOT, 'js/config.js'));
  console.log('✓ config.js chargé');
} catch (e) {
  console.error('✗ config.js:', e.message);
  process.exit(2);
}

try {
  require(path.join(PROJECT_ROOT, 'js/audio-engine.js'));
  console.log('✓ audio-engine.js chargé');
} catch (e) {
  console.error('✗ audio-engine.js:', e.message);
  process.exit(2);
}

try {
  require(path.join(PROJECT_ROOT, 'js/scratch.js'));
  console.log('✓ scratch.js chargé');
} catch (e) {
  console.error('✗ scratch.js:', e.message);
  process.exit(2);
}

// Mock PipedStreams (audio-player.js exige window.PipedStreams)
window.PipedStreams = {
  fetchStreamInfo: function () { return Promise.reject(new Error('mock')); },
  getCachedStream: function () { return null; },
  getCorsSafeUrl: function () { return ''; },
  refreshStream: function () { return Promise.reject(new Error('mock')); },
  classifyError: function (err) { return { message: (err && err.message) || 'erreur' }; },
};
// window.state requis par audio-player.js (loadLocalFile)
window.state = {
  players: { A: null, B: null },
  playerType: { A: 'piped', B: 'piped' },
  videoIds: { A: '', B: '' },
};

try {
  require(path.join(PROJECT_ROOT, 'js/audio-player.js'));
  console.log('✓ audio-player.js chargé');
} catch (e) {
  console.error('✗ audio-player.js:', e.message);
  process.exit(2);
}

const AE = global.window.AudioEngine;
const Scratch = global.window.Scratch;

if (!AE || !AE.engageScratch) {
  console.error('✗ AudioEngine.engageScratch manquant'); process.exit(2);
}
if (!Scratch || typeof Scratch.engage !== 'function') {
  console.error('✗ Scratch.engage manquant'); process.exit(2);
}

console.log('\n=== Scratch.eng API publique ===');
console.log('  ' + Object.keys(Scratch).join(', '));
console.log('');

// ===== Scénarios =====

async function scenario(name, targetPos, wasPlaying) {
  console.log('\n=== ' + name + ' ===');
  console.log('  Position cible : ' + targetPos + 's, wasPlaying=' + wasPlaying);

  // === ÉTAGE 0 : setup deck (audio-engine.createDeckChain + loadDeckBufferFromBlob) ===
  const audioEl = new MockAudioElement();
  audioEl.duration = 100;
  audioEl.currentTime = 5; // utilise le setter → met à jour _seekTarget
  audioEl.paused = !wasPlaying;  // reflète l'état réel avant scratch
  audioEl._initialPaused = !wasPlaying;  // pour assertion finale

  AE.createDeckChain('A', audioEl);

  // Charge le VRAI MP3 local via le vrai pipeline audio-engine.js :
  // loadDeckBufferFromBlob → ctx.decodeAudioData → chain.scratchBuffer.
  const mp3Buffer = fs.readFileSync(MP3_PATH);
  const mp3ArrayBuffer = mp3Buffer.buffer.slice(mp3Buffer.byteOffset, mp3Buffer.byteOffset + mp3Buffer.byteLength);
  const buf = await AE.loadDeckBufferFromBlob('A', mp3ArrayBuffer);
  console.log('  [setup] scratchBuffer chargé depuis MP3 : duration=' + buf.duration.toFixed(2) + 's');

  // === ÉTAGE 1 : audio-engine.engageScratch ===
  console.log('  [étage 1: audio-engine.engageScratch]');
  const engageResult = await AE.engageScratch('A');
  console.log('    → offset=' + engageResult.offset + ' wasPlaying=' + engageResult.wasPlaying);

  // Pendant le scratch : remplit le buffer interne du MediaElementSource.
  const source = audioEl._mediaElementSource;
  source._internalBufferSec = 1.0;
  source._bufferDrained = 0;

  // Simule la durée du scratch.
  await wait(1000);

  // Capture une référence au sourceMuteGain (qui sera créé pendant
  // disengageScratch / ou existait déjà depuis createDeckChain).
  const sourceMuteGain = source._connections && source._connections[0];
  if (!sourceMuteGain || !sourceMuteGain.gain) {
    console.log('  ✗ sourceMuteGain absent du graphe après createDeckChain !');
    fail++;
  }

  // === ÉTAGE 2 : scratch.js (normalement déclenché par disengage()) ===
  // On appelle directement AudioEngine.disengageScratch car disengage() de
  // scratch.js attend un pointer event.
  console.log('  [étage 1+2: AudioEngine.disengageScratch (via scratch.js normalement)]');
  AE.disengageScratch('A', targetPos, wasPlaying);

  // CAPTURE IMMÉDIATE : juste après disengage, sourceMuteGain.gain DOIT être
  // à 0 (c'est ça qui absorbe le buffer interne stale du MES).
  const gainValueAtRelease = sourceMuteGain ? sourceMuteGain.gain.value : null;

  // Attend ≥ 1100ms : fenêtre muette (1000ms DRAIN_MS) + marge. Pendant ce
  // temps, on fait avancer manuellement le buffer du MediaElementSource pour
  // simuler la lecture réelle de Chrome.
  for (let i = 0; i < 22; i++) {
    await wait(50);
    audioEl.tickAdvance(50);
  }

  // === Vérifications finales ===
  const actualPos = audioEl.currentTime;
  const bufferRemaining = source._internalBufferSec - source._bufferDrained;

  console.log('  [résultat]');
  console.log('    audio.currentTime = ' + actualPos.toFixed(3) + 's');
  console.log('    audio.paused = ' + audioEl.paused);
  console.log('    AE.isScratchEngaged(A) = ' + AE.isScratchEngaged('A'));
  console.log('    buffer MediaElementSource restant = ' + bufferRemaining.toFixed(3) + 's');
  console.log('    event log:');
  audioEl._eventLog.forEach(e => {
    console.log('      [' + e.name + '] ' + JSON.stringify(e.detail));
  });

  // === ASSERTIONS par étage ===
  // ÉTAGE 1 : audio-engine.disengageScratch a-t-il appelé audio.currentTime = target ?
  const seekEvent = audioEl._eventLog.find(e => e.name === 'set currentTime' && Math.abs(e.detail.to - targetPos) < 0.01);
  assert('[audio-engine] audio.currentTime = ' + targetPos + ' appliqué', !!seekEvent);

  // RÉGRESSION InvalidStateError : le disengage ne doit JAMAIS recréer le
  // MediaElementAudioSourceNode (contrainte navigateur : 1 nœud par élément).
  // Vérifié deux fois : (a) même objet source qu'au createDeckChain,
  // (b) le mock de createMediaElementSource throw si recréé (durci).
  assert('[audio-engine] source MediaElement réutilisée (pas recréée)',
    audioEl._mediaElementSource === source);

  // RÉGRESSION play relanceable : après le release, un nouvel engage doit
  // fonctionner (dans le bug InvalidStateError, le deck était mort).
  const reEngage = await AE.engageScratch('A');
  assert('[audio-engine] ré-engage possible après release', AE.isScratchEngaged('A')
    && reEngage.offset >= targetPos - 0.3);
  AE.disengageScratch('A', reEngage.offset, wasPlaying);
  for (let i = 0; i < 20; i++) { await wait(50); audioEl.tickAdvance(50); }

  // ÉTAGE 2 : scratch.js a-t-il préservé wasPlaying ?
  // L'état de l'audio (paused/play) doit être RESTITUÉ tel qu'il était
  // AVANT le scratch — peu importe ce que le scénario a passé comme arg
  // wasPlaying. C'est engageScratch qui mémorise chain.wasPlayingBeforeScratch.
  const stateOk = audioEl.paused === audioEl._initialPaused;
  assert('[scratch.js] play/pause préservé (paused=' + audioEl.paused
    + ', attendu=' + audioEl._initialPaused + ' = état pré-engage)', stateOk);

  // Fenêtre muette : on vérifie maintenant que c'est sourceMuteGain (VRAI
  // point de coupure effectif) qui est passé à 0 puis remis à 1.
  // audio.muted reste à false car il est INEFFICACE sur un MediaElementSource
  // (cf. commentaire dans audio-engine.js disengageScratch).
  assert('[audio-engine] sourceMuteGain présent dans le graphe (entre source et scratchGain)',
    sourceMuteGain && sourceMuteGain.gain);
  // IMMÉDIATEMENT après disengage : sourceMuteGain.gain doit être à 0 → le
  // buffer stale du MES se déverse dans un gain=0 (silence parfait).
  assert('[audio-engine] sourceMuteGain.gain = 0 IMMÉDIATEMENT après release',
    gainValueAtRelease === 0,
    'valeur capturée=' + gainValueAtRelease);
  // Après le drain complet (~1000ms), sourceMuteGain.gain doit être remonté à 1.
  const gainValueAfterDrain = sourceMuteGain ? sourceMuteGain.gain.value : null;
  assert('[audio-engine] sourceMuteGain.gain = 1 après le drain (audio rétabli)',
    gainValueAfterDrain === 1 || (sourceMuteGain && (sourceMuteGain.gain._target === 1 || sourceMuteGain.gain.value === 1)),
    'valeur après drain=' + gainValueAfterDrain);

  // ÉTAGE 3 : la position finale est-elle correcte après snap-back ?
  let posOk;
  if (wasPlaying) {
    posOk = actualPos >= targetPos - 0.3; // a continué d'avancer
  } else {
    posOk = Math.abs(actualPos - targetPos) < 0.15;
  }
  assert('[résultat final] Position = ' + targetPos + 's (actuel=' + actualPos.toFixed(3) + ')', posOk);

  // Diagnostic snap-back : si la position est revenue au DÉBUT du scratch,
  // c'est le bug Chrome snap-back. On le détecte.
  if (!posOk) {
    const snapBack = audioEl._eventLog.find(e => e.name === 'SNAP-BACK to ' + engageResult.offset.toFixed(3));
    if (snapBack) {
      console.log('  ⚠️  SNAP-BACK DÉTECTÉ ! Position revenue à l\'offset du engageScratch (' + engageResult.offset + 's)');
      console.log('  ⚠️  Le bug Chrome snap-back est confirmé dans ce test.');
    }
  }
}

// ===== Test étage par étage =====

async function testEtages() {
  console.log('\n=== Tests étage par étage ===\n');

  // ÉTAGE 0 : contrainte navigateur — 1 seul MediaElementAudioSourceNode par
  // élément <audio>, pour toujours. Le mock la reproduit (InvalidStateError).
  // C'est LA règle que le fix "destroy + recreate" violait en vrai Chrome.
  console.log('--- ÉTAGE 0 : contrainte 1 MediaElementSource par élément ---');
  const audioEl0 = new MockAudioElement();
  mockCtx.createMediaElementSource(audioEl0);
  let threw = null;
  try { mockCtx.createMediaElementSource(audioEl0); } catch (e) { threw = e; }
  assert('[contrainte] 2e createMediaElementSource throw InvalidStateError',
    threw && threw.name === 'InvalidStateError');

  // Charge le MP3 une fois pour tous les étages.
  const mp3Buf = fs.readFileSync(MP3_PATH).buffer.slice(
    fs.readFileSync(MP3_PATH).byteOffset,
    fs.readFileSync(MP3_PATH).byteOffset + fs.readFileSync(MP3_PATH).byteLength);

  // ÉTAGE 1 : audio-engine.engageScratch seul (sans release)
  console.log('--- ÉTAGE 1 : audio-engine.engageScratch + disconnect ---');
  const audioEl1 = new MockAudioElement();
  audioEl1.duration = 100;
  audioEl1.currentTime = 10;
  AE.createDeckChain('B', audioEl1);
  await AE.loadDeckBufferFromBlob('B', mp3Buf.slice(0));
  const source1 = audioEl1._mediaElementSource;
  const r1 = await AE.engageScratch('B');
  assert('[étage 1] engageScratch retourne offset=10', r1.offset === 10);
  assert('[étage 1] sourceMuteGain déconnecté du scratchGain (via MockNode._connections)',
    source1._connections.length === 1 && source1._connections[0]._connections.length === 0);
  assert('[étage 1] AE.isScratchEngaged(B)=true', AE.isScratchEngaged('B'));
  AE.destroyDeckChain('B');

  // ÉTAGE 2 : disengageScratch appelé directement avec wasPlaying=false
  console.log('\n--- ÉTAGE 2 : disengageScratch pause (pas de bug attendu) ---');
  const audioEl2 = new MockAudioElement();
  audioEl2.duration = 100;
  audioEl2.currentTime = 10;
  AE.createDeckChain('C', audioEl2);
  await AE.loadDeckBufferFromBlob('C', mp3Buf.slice(0));
  await AE.engageScratch('C');
  audioEl2._mediaElementSource._internalBufferSec = 0.8;
  for (let i = 0; i < 10; i++) { await wait(100); audioEl2.tickAdvance(100); }
  AE.disengageScratch('C', 15, false);
  for (let i = 0; i < 8; i++) { await wait(50); audioEl2.tickAdvance(50); }
  assert('[étage 2] audio.currentTime = 15 (en pause)', Math.abs(audioEl2.currentTime - 15) < 0.1);
  AE.destroyDeckChain('C');

  // ÉTAGE 3 : disengageScratch avec wasPlaying=true (le BUG)
  console.log('\n--- ÉTAGE 3 : disengageScratch lecture (BUG CHROME BUFFER) ---');
  const audioEl3 = new MockAudioElement();
  audioEl3.duration = 100;
  audioEl3.currentTime = 10;
  AE.createDeckChain('D', audioEl3);
  await AE.loadDeckBufferFromBlob('D', mp3Buf.slice(0));
  await AE.engageScratch('D');
  audioEl3._mediaElementSource._internalBufferSec = 0.8;
  audioEl3._mediaElementSource._bufferDrained = 0;
  for (let i = 0; i < 10; i++) { await wait(100); audioEl3.tickAdvance(100); }
  AE.disengageScratch('D', 18, true);
  // ⚠️ Attendre au-delà de la fenêtre du buffer interne (800ms) : pendant la
  // fenêtre muette, l'élément joue encore l'ancien buffer EN SILENCE, puis
  // honore le seek. C'est exactement ce que le disengage muté absorbe.
  for (let i = 0; i < 20; i++) { await wait(50); audioEl3.tickAdvance(50); }
  const posApres = audioEl3.currentTime;
  console.log('  [étage 3] position finale = ' + posApres.toFixed(3) + 's (attendu ≥ 18s)');
  assert('[étage 3] position ≥ 18s après release (en lecture)', posApres >= 18 - 0.3,
    'position ' + posApres.toFixed(3) + 's < 18s → BUG buffer MediaElementSource');
  AE.destroyDeckChain('D');
}

// ===== ÉTAGE 4 : vrai chemin scratch.js =====
// Scratch.enable → Scratch.engage → mouvement avant → Scratch.disengage.
// Ici scratch.js doit transmettre à AudioEngine la position FINALE calculée,
// ainsi que l'état play/pause mémorisé au moment de l'engage.
async function testScratchJsHierarchy() {
  console.log('\n--- ÉTAGE 4 : scratch.js engage → move forward → disengage ---');
  mockCtx.currentTime = 0;
  const audioEl = new MockAudioElement();
  audioEl.duration = 30;
  audioEl.currentTime = 5;
  audioEl.paused = false;
  AE.createDeckChain('E', audioEl);

  const mp3 = fs.readFileSync(MP3_PATH);
  const bytes = mp3.buffer.slice(mp3.byteOffset, mp3.byteOffset + mp3.byteLength);
  await AE.loadDeckBufferFromBlob('E', bytes);

  const enabled = Scratch.enable('E');
  assert('[étage 4 / scratch.js] Scratch.enable(E)=true', enabled === true);
  Scratch.engage('E');
  await wait(40); // duckDown + chaîne de promesses ensureBuffer/engageScratch
  assert('[étage 4 / scratch.js] engage réel transmis à AudioEngine', AE.isScratchEngaged('E'));

  // Le rate démarre à 0. On pose +1 à t=1 puis on relâche à t=7 :
  // position finale attendue = 5s + 6s = 11s.
  mockCtx.currentTime = 1;
  Scratch.setRate('E', 1);
  mockCtx.currentTime = 7;
  const beforeRelease = AE.getScratchPosition('E');
  assert('[étage 4 / scratch.js] mouvement avant produit 11s', Math.abs(beforeRelease - 11) < 0.01,
    'position avant release=' + beforeRelease);

  Scratch.disengage('E');
  for (let i = 0; i < 12; i++) { await wait(50); audioEl.tickAdvance(50); }
  const finalPos = audioEl.currentTime;
  console.log('  [étage 4] position scratch=' + beforeRelease.toFixed(3)
    + 's → player final=' + finalPos.toFixed(3) + 's');
  assert('[étage 4 / scratch.js] release transmet la position finale', finalPos >= 10.7,
    'position finale=' + finalPos);
  assert('[étage 4 / scratch.js] état lecture préservé', audioEl.paused === false);

  Scratch.disable('E');
  AE.destroyDeckChain('E');
}

// ===== ÉTAGE 5 : vrai wrapper audio-player.js =====
// AudioPlayer crée lui-même le <audio> et la chaîne AudioEngine. Le scénario
// vérifie que la position corrigée reste visible au niveau de l'API publique
// player.getCurrentTime(), celle qu'utilise app.js.
async function testAudioPlayerHierarchy() {
  console.log('\n--- ÉTAGE 5 : audio-player.js + fichier local + scratch release ---');
  mockCtx.currentTime = 0;
  const AudioPlayer = window.AudioPlayer;
  assert('[étage 5 / audio-player.js] AudioPlayer exposé', !!AudioPlayer);

  const states = [];
  const player = AudioPlayer.createAudioPlayer('F', {
    onStateChange: function (evt) { states.push(evt.data); },
  });
  window.state.players.F = player;
  window.state.playerType.F = 'piped';
  window.state.videoIds.F = 'local';

  const mp3 = fs.readFileSync(MP3_PATH);
  const bytes = mp3.buffer.slice(mp3.byteOffset, mp3.byteOffset + mp3.byteLength);
  const localFile = {
    name: 'Mandjou_QDIUL6T5GQU.mp3',
    type: 'audio/mpeg',
    size: mp3.byteLength,
    arrayBuffer: function () { return Promise.resolve(bytes.slice(0)); },
  };
  await player.loadLocalFile(localFile);
  const audioEl = player._getAudioElement();
  audioEl.duration = 30;
  player.seekTo(5);
  await player.playVideo();
  assert('[étage 5 / audio-player.js] lecteur en lecture avant scratch', audioEl.paused === false);
  assert('[étage 5 / audio-player.js] AudioEngine utilise le même <audio>',
    AE.getDeckAudioElement('F') === audioEl);

  await AE.engageScratch('F');
  mockCtx.currentTime = 1;
  AE.setScratchRate('F', 1);
  mockCtx.currentTime = 7;
  const beforeRelease = AE.getScratchPosition('F');
  AE.disengageScratch('F', beforeRelease, true);
  for (let i = 0; i < 12; i++) { await wait(50); audioEl.tickAdvance(50); }

  const publicPos = player.getCurrentTime();
  console.log('  [étage 5] AudioPlayer.getCurrentTime()=' + publicPos.toFixed(3)
    + 's (scratch final=' + beforeRelease.toFixed(3) + 's)');
  assert('[étage 5 / audio-player.js] API publique retourne la position finale', publicPos >= 10.7,
    'position publique=' + publicPos);
  assert('[étage 5 / audio-player.js] lecture préservée après release', audioEl.paused === false);

  AE.destroyDeckChain('F');
}

(async function main() {
  await testEtages();
  await testScratchJsHierarchy();
  await testAudioPlayerHierarchy();
  console.log('\n───────────────────────────');
  await scenario('Pause avant scratch : 5s → 11.5s', 11.5, false);
  AE.destroyDeckChain('A');
  await scenario('Lecture avant scratch : 5s → 22s', 22, true);
  AE.destroyDeckChain('A');
  await scenario('Scratch arrière : 5s → 3s', 3, false);
  AE.destroyDeckChain('A');

  console.log('\n═══════════════════════════════════════════');
  console.log('RÉSUMÉ : ' + pass + ' pass, ' + fail + ' fail');
  console.log('═══════════════════════════════════════════');

  if (fail > 0) {
    console.log('\n→ Le bug est dans la chaîne audio-engine ↔ audio ↔ <audio> element.');
    console.log('  Hypothèse : audio.load() ne vide PAS le buffer interne du MediaElementSource.');
    console.log('  Le MediaElementSource continue à sortir ses samples préchargés,');
    console.log('  ce qui repousse audio.currentTime à l\'ancienne position (snap-back).');
  } else {
    console.log('\n→ Tous les tests passent. Le bug est ailleurs.');
  }

  process.exit(fail > 0 ? 1 : 0);
})().catch(e => {
  console.error('Erreur fatale :', e);
  console.error(e.stack);
  process.exit(2);
});
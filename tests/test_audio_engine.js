/* Test runner pour audio-engine.js avec un MOCK de Web Audio API.
 *
 * Le mock simule juste assez pour valider :
 *   - la topologie du graphe (qui est connecté à quoi)
 *   - les valeurs appliquées (gain, freq, type)
 *   - les erreurs sur les inputs invalides
 *
 * On n'utilise PAS un vrai AudioContext (incompatible Node). Pour une
 * validation audio réelle, il faut ouvrir l'app dans un navigateur.
 */

// ===== MOCK AudioContext =====
class MockParam {
  constructor(defaultValue) {
    this.value = defaultValue;
    this._targets = []; // { value, startTime, timeConstant }
  }
  setValueAtTime(v) { this.value = v; }
  setTargetAtTime(v, startTime, timeConstant) {
    // En contexte réel, le ramping est progressif. Pour le test on capture
    // juste la cible et le timeConstant (pour vérifier que la rampe est
    // bien demandée — le moteur ne saute pas à la valeur directement).
    this._targets.push({ value: v, startTime: startTime, timeConstant: timeConstant });
    // Pour la lisibilité des assertions, on stocke aussi la dernière cible.
    this._lastTarget = v;
  }
  linearRampToValueAtTime(v) { this.value = v; }
}

class MockAudioNode {
  constructor(ctx, type) {
    this.ctx = ctx;
    this._connections = [];
    this._isConnected = false;
    // On utilise Object.defineProperty pour que 'type' soit une data prop
    // sur l'instance (sinon les sous-classes avec getter/setter type seraient
    // shadowées par cette data prop).
    Object.defineProperty(this, 'type', {
      value: type || 'node',
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  connect(dest) {
    if (!dest || typeof dest.connect !== 'function') {
      throw new Error('connect(): destination invalide');
    }
    this._connections.push(dest);
    this._isConnected = true;
    if (dest._incoming) dest._incoming.push(this);
    return dest;
  }
  disconnect() {
    this._connections = [];
    this._isConnected = false;
  }
}

class MockGainNode extends MockAudioNode {
  constructor(ctx) {
    super(ctx, 'GainNode');
    this.gain = new MockParam(1);
  }
}

class MockAnalyserNode extends MockAudioNode {
  constructor(ctx) {
    super(ctx, 'AnalyserNode');
    this.fftSize = 0;
    this.smoothingTimeConstant = 0;
  }
  getByteFrequencyData(arr) {
    // Mock : renvoie des zeros (audio silencenx en absence de source réelle)
    for (let i = 0; i < arr.length; i++) arr[i] = 0;
  }
  getByteTimeDomainData(arr) {
    for (let i = 0; i < arr.length; i++) arr[i] = 128;
  }
}

class MockBiquadFilterNode extends MockAudioNode {
  constructor(ctx) {
    super(ctx, 'BiquadFilter');
    // _type commence comme 'lowpass' (par défaut). On override le type data
    // prop hérité avec un getter/setter validé.
    Object.defineProperty(this, 'type', {
      get() { return this._type; },
      set(v) {
        if (!['lowpass', 'highpass', 'lowshelf', 'highshelf', 'peaking', 'allpass', 'notch', 'bandpass'].includes(v)) {
          throw new Error('BiquadFilter type invalide : ' + v);
        }
        this._type = v;
      },
      configurable: true,
      enumerable: true,
    });
    this._type = 'lowpass';
    this.frequency = new MockParam(350);
    this.gain = new MockParam(0);
    this.Q = new MockParam(1);
  }
}

class MockMediaElementAudioSourceNode extends MockAudioNode {
  constructor(ctx, el) {
    super(ctx, 'MediaElementSource');
    this.mediaElement = el;
  }
}

class MockAudioContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.sampleRate = 44100;
    this._destination = new MockAudioNode(this, 'destination');
    this._destination._incoming = [];
    this._createdNodes = [];
  }
  createGain() { const n = new MockGainNode(this); this._track(n); return n; }
  createAnalyser() { const n = new MockAnalyserNode(this); this._track(n); return n; }
  createBiquadFilter() { const n = new MockBiquadFilterNode(this); this._track(n); return n; }
  createMediaElementSource(el) { const n = new MockMediaElementAudioSourceNode(this, el); this._track(n); return n; }
  get destination() { return this._destination; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  close() { return Promise.resolve(); }
  _track(n) { this._createdNodes.push(n); }
}

// ===== Helpers de test =====

let pass = 0, fail = 0;
function assert(label, cond, detail) {
  if (cond) {
    console.log('  ✓', label);
    pass++;
  } else {
    console.log('  ✗', label, detail || '');
    fail++;
  }
}
function approx(a, b, tol = 0.001) { return Math.abs(a - b) < tol; }

// ===== Tests =====

async function main() {
  // Stub minimal pour faire tourner audio-engine.js
  const mockCtx = new MockAudioContext();
  global.window = {
    AudioContext: function () { return mockCtx; },
  };
  global.HTMLAudioElement = class HTMLAudioElement {};

  const path = require('path');
  const PROJECT_ROOT = path.resolve(__dirname, '..');
  require(path.join(PROJECT_ROOT, 'js/audio-engine.js'));
  const AE = global.window.AudioEngine;

  console.log('=== Test 1 : API publique exposée ===');
  assert('window.AudioEngine défini', !!AE);
  const expectedKeys = ['init', 'resume', 'createDeckChain', 'destroyDeckChain',
    'applyCrossfade', 'applyMasterVolume', 'setEQ', 'setDjFilter',
    'getAnalyser', 'getMasterAnalyser', 'hasDeck', 'getDeckAudioElement', 'CONST'];
  for (const k of expectedKeys) {
    assert('  - ' + k, typeof AE[k] !== 'undefined');
  }

  console.log('\n=== Test 2 : init() lazy et idempotent ===');
  assert('ctx null avant init', AE.getContext() === null);
  AE.init();
  const ctx1 = AE.getContext();
  assert('ctx créé après init', ctx1 !== null);
  AE.init(); // 2e appel
  assert('init() idempotent', AE.getContext() === ctx1);

  console.log('\n=== Test 3 : masterGain + masterAnalyser créés ===');
  const masterGain = mockCtx._createdNodes.find(n => n.type === 'GainNode');
  assert('masterGain (GainNode) existe', !!masterGain);
  assert('masterGain.gain.value = 1.0', masterGain.gain.value === 1.0);
  const masterAnalyser = mockCtx._createdNodes.find(n => n.type === 'AnalyserNode');
  assert('masterAnalyser existe', !!masterAnalyser);
  assert('masterAnalyser.fftSize = 2048', masterAnalyser.fftSize === 2048);
  assert('masterAnalyser connecté au GainNode', masterGain._connections.includes(masterAnalyser));
  assert('masterAnalyser connecté à destination', masterAnalyser._connections.includes(mockCtx._destination));

  console.log('\n=== Test 4 : createDeckChain crée le bon graphe ===');
  const audioEl = new global.HTMLAudioElement();
  audioEl.src = 'https://example.com/test.mp3';
  audioEl.crossOrigin = 'anonymous';
  const chainA = AE.createDeckChain('A', audioEl);
  assert('chain A retournée', !!chainA);
  assert('chain A contient audioEl', chainA.audioEl === audioEl);
  assert('chain A contient source (MediaElementSource)', chainA.source instanceof MockMediaElementAudioSourceNode);
  assert('chain A contient lowShelf (Biquad)', chainA.lowShelf instanceof MockBiquadFilterNode);
  assert('chain A contient midPeak (Biquad)', chainA.midPeak instanceof MockBiquadFilterNode);
  assert('chain A contient highShelf (Biquad)', chainA.highShelf instanceof MockBiquadFilterNode);
  assert('chain A contient djFilter (Biquad)', chainA.djFilter instanceof MockBiquadFilterNode);
  assert('chain A contient deckGain (GainNode)', chainA.deckGain instanceof MockGainNode);
  assert('chain A contient analyser (AnalyserNode)', chainA.analyser instanceof MockAnalyserNode);
  // deckGain initial = 0.5 (centre)
  assert('deckGain.gain.value initial = 0.5', chainA.deckGain.gain.value === 0.5);

  console.log('\n=== Test 5 : connexions en série correctes ===');
  // source → lowShelf → midPeak → highShelf → djFilter → deckGain → analyser
  // deckGain → masterGain (en plus)
  assert('source → lowShelf', chainA.source._connections.includes(chainA.lowShelf));
  assert('lowShelf → midPeak', chainA.lowShelf._connections.includes(chainA.midPeak));
  assert('midPeak → highShelf', chainA.midPeak._connections.includes(chainA.highShelf));
  assert('highShelf → djFilter', chainA.highShelf._connections.includes(chainA.djFilter));
  assert('djFilter → deckGain', chainA.djFilter._connections.includes(chainA.deckGain));
  assert('deckGain → analyser', chainA.deckGain._connections.includes(chainA.analyser));
  assert('deckGain → masterGain (2e connexion)', chainA.deckGain._connections.includes(masterGain));

  console.log('\n=== Test 6 : EQ init ===');
  assert('lowShelf.type = lowshelf', chainA.lowShelf._type === 'lowshelf');
  assert('lowShelf.frequency = 200 Hz', chainA.lowShelf.frequency.value === 200);
  assert('lowShelf.gain = 0 dB', chainA.lowShelf.gain.value === 0);
  assert('midPeak.type = peaking', chainA.midPeak._type === 'peaking');
  assert('midPeak.frequency = 1000 Hz', chainA.midPeak.frequency.value === 1000);
  assert('midPeak.Q = 1.0', chainA.midPeak.Q.value === 1.0);
  assert('highShelf.type = highshelf', chainA.highShelf._type === 'highshelf');
  assert('highShelf.frequency = 4000 Hz', chainA.highShelf.frequency.value === 4000);

  console.log('\n=== Test 7 : djFilter démarre en bypass ===');
  // À la création, on met le djFilter en 'allpass' (transparent, ne filtre rien).
  // C'est plus propre que lowpass@20kHz : pas de risque de résonance parasite.
  assert('djFilter.type = allpass (bypass)', chainA.djFilter.type === 'allpass');
  assert('djFilter.frequency = 20000 Hz (initial)', chainA.djFilter.frequency.value === 20000);

  console.log('\n=== Test 8 : applyCrossfade(0) → full A ===');
  AE.applyCrossfade(0);
  assert('A deckGain → cos(0) = 1.0', approx(chainA.deckGain.gain._lastTarget, 1.0));
  // B n\'a pas de chaîne encore, rien à tester

  console.log('\n=== Test 9 : applyCrossfade(0.5) → centre equal-power ===');
  const chainB_audioEl = new global.HTMLAudioElement();
  chainB_audioEl.src = 'https://example.com/b.mp3';
  chainB_audioEl.crossOrigin = 'anonymous';
  const chainB = AE.createDeckChain('B', chainB_audioEl);
  AE.applyCrossfade(0.5);
  // cos(π/4) = sin(π/4) = √2/2 ≈ 0.7071
  assert('A deckGain ≈ 0.7071', approx(chainA.deckGain.gain._lastTarget, Math.SQRT1_2));
  assert('B deckGain ≈ 0.7071', approx(chainB.deckGain.gain._lastTarget, Math.SQRT1_2));

  console.log('\n=== Test 10 : applyCrossfade(1) → full B ===');
  AE.applyCrossfade(1);
  assert('A deckGain → cos(π/2) = 0', approx(chainA.deckGain.gain._lastTarget, 0));
  assert('B deckGain → sin(π/2) = 1', approx(chainB.deckGain.gain._lastTarget, 1.0));

  console.log('\n=== Test 11 : applyCrossfade utilise setTargetAtTime (ramping) ===');
  const lastTarget = chainA.deckGain.gain._targets[chainA.deckGain.gain._targets.length - 1];
  assert('setTargetAtTime appelé avec timeConstant ≈ 0.015', lastTarget && lastTarget.timeConstant === 0.015);

  console.log('\n=== Test 12 : applyCrossfade clamp [0..1] ===');
  AE.applyCrossfade(2);
  assert('p=2 → clampé à 1 → B = 1 (full B)', approx(chainB.deckGain.gain._lastTarget, 1.0));
  assert('p=2 → clampé à 1 → A = 0 (silence sur A)', approx(chainA.deckGain.gain._lastTarget, 0));
  AE.applyCrossfade(-1);
  assert('p=-1 → clampé à 0 → A = 1 (full A)', approx(chainA.deckGain.gain._lastTarget, 1.0));
  assert('p=-1 → clampé à 0 → B = 0 (silence sur B)', approx(chainB.deckGain.gain._lastTarget, 0));

  console.log('\n=== Test 13 : applyMasterVolume ===');
  AE.applyMasterVolume(50);
  assert('masterGain.gain target = 0.5', approx(masterGain.gain._lastTarget, 0.5));
  AE.applyMasterVolume(0);
  assert('masterGain.gain target = 0.0', approx(masterGain.gain._lastTarget, 0));
  AE.applyMasterVolume(100);
  assert('masterGain.gain target = 1.0', approx(masterGain.gain._lastTarget, 1));

  console.log('\n=== Test 14 : setEQ low/mid/high ===');
  AE.setEQ('A', 'low', -6);
  assert('A.lowShelf.gain target = -6', approx(chainA.lowShelf.gain._lastTarget, -6));
  AE.setEQ('A', 'mid', 12);
  assert('A.midPeak.gain target = +12', approx(chainA.midPeak.gain._lastTarget, 12));
  AE.setEQ('A', 'high', -12);
  assert('A.highShelf.gain target = -12', approx(chainA.highShelf.gain._lastTarget, -12));

  console.log('\n=== Test 15 : setEQ clamp ±12 dB ===');
  AE.setEQ('A', 'low', 50);
  assert('low +50 → clampé à +12', approx(chainA.lowShelf.gain._lastTarget, 12));
  AE.setEQ('A', 'low', -50);
  assert('low -50 → clampé à -12', approx(chainA.lowShelf.gain._lastTarget, -12));

  console.log('\n=== Test 16 : setEQ throw sur band inconnue ===');
  try {
    AE.setEQ('A', 'bass', 0);
    assert('throw attendu', false);
  } catch (e) {
    assert('throw sur band invalide', e.message.indexOf('band inconnue') !== -1, e.message);
  }

  console.log('\n=== Test 17 : setDjFilter (lowpass ↔ bypass ↔ highpass) ===');
  AE.setDjFilter('A', -1);
  assert('pos=-1 → lowpass', chainA.djFilter.type === 'lowpass');
  assert('pos=-1 → freq = 200 Hz', approx(chainA.djFilter.frequency._lastTarget, 200));
  AE.setDjFilter('A', 0);
  assert('pos=0 → lowpass (bypass interne)', chainA.djFilter._type === 'lowpass');
  assert('pos=0 → freq = 20000 Hz', approx(chainA.djFilter.frequency._lastTarget, 20000));
  AE.setDjFilter('A', 1);
  assert('pos=+1 → highpass', chainA.djFilter._type === 'highpass');
  assert('pos=+1 → freq = 5000 Hz', approx(chainA.djFilter.frequency._lastTarget, 5000));

  console.log('\n=== Test 18 : setDjFilter clamp [-1..+1] ===');
  AE.setDjFilter('A', -2);
  assert('pos=-2 → clampé à -1 → freq = 200', approx(chainA.djFilter.frequency._lastTarget, 200));
  AE.setDjFilter('A', 5);
  assert('pos=+5 → clampé à +1 → freq = 5000', approx(chainA.djFilter.frequency._lastTarget, 5000));

  console.log('\n=== Test 19 : setDjFilter valeurs intermédiaires (log scale) ===');
  // pos = -0.5 → t = 0.5 → freq = exp(log(200) + 0.5 * (log(20000) - log(200)))
  //                       = exp(0.5 * (log(20000) + log(200)))
  //                       = sqrt(200 * 20000) = sqrt(4_000_000) = 2000 Hz
  AE.setDjFilter('A', -0.5);
  const expectedMid = Math.sqrt(200 * 20000);
  assert('pos=-0.5 → freq = √(200·20000) = ' + expectedMid.toFixed(1),
    approx(chainA.djFilter.frequency._lastTarget, expectedMid));

  console.log('\n=== Test 20 : getAnalyser / getMasterAnalyser ===');
  assert('getAnalyser(A) === chainA.analyser', AE.getAnalyser('A') === chainA.analyser);
  assert('getAnalyser(B) === chainB.analyser', AE.getAnalyser('B') === chainB.analyser);
  assert('getAnalyser(X) === null', AE.getAnalyser('X') === null);
  assert('getMasterAnalyser() === masterAnalyser', AE.getMasterAnalyser() === masterAnalyser);

  console.log('\n=== Test 21 : createDeckChain throw sur audioEl invalide ===');
  try {
    AE.createDeckChain('C', null);
    assert('throw attendu', false);
  } catch (e) {
    assert('throw sur audioEl null', e.message.indexOf('audioEl') !== -1, e.message);
  }
  try {
    AE.createDeckChain('C', { src: 'fake' });
    assert('throw attendu', false);
  } catch (e) {
    assert('throw sur audioEl non-HTMLElement', e.message.indexOf('audioEl') !== -1, e.message);
  }

  console.log('\n=== Test 22 : createDeckChain throw si deck déjà actif ===');
  try {
    AE.createDeckChain('A', audioEl);
    assert('throw attendu', false);
  } catch (e) {
    assert('throw sur doublon', e.message.indexOf('chaîne active') !== -1, e.message);
  }

  console.log('\n=== Test 23 : destroyDeckChain ===');
  const destroyed = AE.destroyDeckChain('A');
  assert('destroy retourne true', destroyed === true);
  assert('A plus dans chains', AE.hasDeck('A') === false);
  assert('B toujours là', AE.hasDeck('B') === true);
  assert('getAnalyser(A) === null après destroy', AE.getAnalyser('A') === null);
  // source déconnecté
  assert('source._connections vide', chainA.source._connections.length === 0);

  // Re-créer A possible après destroy
  const audioEl2 = new global.HTMLAudioElement();
  audioEl2.src = 'https://example.com/a2.mp3';
  audioEl2.crossOrigin = 'anonymous';
  const chainA2 = AE.createDeckChain('A', audioEl2);
  assert('re-création A OK', !!chainA2);

  console.log('\n=== Test 24 : resume() débloque un contexte suspendu ===');
  mockCtx.state = 'suspended';
  await AE.resume();
  assert('ctx.state = running après resume', mockCtx.state === 'running');

  console.log('\n=== Résumé ===');
  console.log('  Tests passés :', pass);
  console.log('  Tests échoués :', fail);
  if (fail === 0) {
    console.log('\n✓ Tous les tests passent');
    process.exit(0);
  } else {
    console.log('\n✗ ' + fail + ' test(s) échoué(s)');
    process.exit(1);
  }
}

main().catch(err => { console.error('Erreur fatale :', err); process.exit(1); });
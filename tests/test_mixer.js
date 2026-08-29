/* Test runner pour mixer.js (crossfader dual mode Piped / IFrame).
 *
 * Valide :
 *   - API publique exposée (window.YTMixer)
 *   - Mode par défaut = 'iframe'
 *   - setMode/getMode/isPipedMode
 *   - applyVolumes() en mode IFrame → appelle player.setVolume (equal-power)
 *   - applyVolumes() en mode Piped → appelle AudioEngine.applyCrossfade +
 *     AudioEngine.applyMasterVolume (pas de setVolume sur les players)
 *   - stepTowardsTarget() : paliers en IFrame, direct en Piped
 *   - syncBtoA : seek B au currentTime de A + play si A joue
 *   - toggleContinuousSync : seuil adaptatif (0.2s Piped / 0.5s IFrame)
 *   - getCurrentTime/getPlayerState inchangés
 *
 * On n'utilise PAS de DOM réel : on shim getElementById et on capture les
 * listeners enregistrés par wireUI().
 */

const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Initialiser global.window
global.window = {};
global.HTMLAudioElement = class {};

// ===== Shims DOM minimaux =====
// On capture tous les éléments par id dans un map, et on enregistre les
// listeners sur chaque élément pour pouvoir les invoquer dans les tests.
const elementsById = {};
function makeElement(id) {
  const el = {
    id: id,
    value: '50',
    textContent: '',
    setAttribute: function (k, v) { this[k] = v; },
    addEventListener: function (event, handler) {
      this._listeners = this._listeners || {};
      this._listeners[event] = this._listeners[event] || [];
      this._listeners[event].push(handler);
    },
    _emit: function (event, payload) {
      if (!this._listeners || !this._listeners[event]) return;
      this._listeners[event].forEach(h => h(payload || {}));
    },
  };
  elementsById[id] = el;
  return el;
}

// Pré-créer tous les éléments attendus par wireUI()
makeElement('crossfade'); // default value 50
makeElement('xf-value-a');
makeElement('xf-value-b');
makeElement('master-volume');
makeElement('master-value');
makeElement('play-both');
makeElement('pause-both');
makeElement('sync-ba');
makeElement('resync-toggle');

global.document = {
  getElementById: function (id) { return elementsById[id] || null; },
  querySelector: function () { return null; },
  addEventListener: function () {},
};

// ===== Mocks Players =====
// Players avec setVolume/getCurrentTime/getPlayerState/playVideo/pauseVideo/seekTo
function makePlayer() {
  return {
    _setVolumeCalls: [],
    _playCalls: 0,
    _pauseCalls: 0,
    _seekCalls: [],
    setVolume: function (v) { this._setVolumeCalls.push(v); },
    playVideo: function () { this._playCalls++; },
    pauseVideo: function () { this._pauseCalls++; },
    seekTo: function (sec) { this._seekCalls.push(sec); },
    getCurrentTime: function () { return this._currentTime || 0; },
    getPlayerState: function () { return this._playerState !== undefined ? this._playerState : 1; },
    _currentTime: 0,
    _playerState: 1,
  };
}

// ===== Mocks AudioEngine =====
const AE_mock = {
  applyCrossfadeCalls: [],
  applyMasterVolumeCalls: [],
  applyCrossfade: function (p) { this.applyCrossfadeCalls.push(p); },
  applyMasterVolume: function (v) { this.applyMasterVolumeCalls.push(v); },
};
global.window.AudioEngine = AE_mock;

// ===== Helpers de test =====
let pass = 0, fail = 0;
function assert(label, cond, detail) {
  if (cond) { console.log('  ✓', label); pass++; }
  else { console.log('  ✗', label, detail || ''); fail++; }
}
function approx(a, b, tol = 0.001) { return Math.abs(a - b) < tol; }

// ===== Tests =====
async function main() {
  console.log('=== Test 1 : API publique ===');
  require(path.join(PROJECT_ROOT, 'js/mixer.js'));
  const MX = global.window.YTMixer;
  assert('window.YTMixer défini', !!MX);
  const expectedKeys = ['init', 'applyVolumes', 'setStepOptions', 'setAutoXf', 'isAutoXf',
    'setMode', 'getMode', 'isPipedMode', 'syncBtoA', 'toggleContinuousSync', 'CONST'];
  for (const k of expectedKeys) {
    assert('  - ' + k, typeof MX[k] !== 'undefined');
  }
  assert('CONST.SYNC_DRIFT_THRESHOLD_PIPED = 0.2', MX.CONST.SYNC_DRIFT_THRESHOLD_PIPED === 0.2);
  assert('CONST.SYNC_DRIFT_THRESHOLD_IFRAME = 0.5', MX.CONST.SYNC_DRIFT_THRESHOLD_IFRAME === 0.5);

  console.log('\n=== Test 2 : mode par défaut = iframe ===');
  assert('getMode() initial = iframe', MX.getMode() === 'iframe');
  assert('isPipedMode() initial = false', MX.isPipedMode() === false);

  console.log('\n=== Test 3 : setMode invalide ignoré ===');
  MX.setMode('foo');
  assert('  mode reste iframe', MX.getMode() === 'iframe');
  MX.setMode(null);
  assert('  null ignoré', MX.getMode() === 'iframe');
  MX.setMode(undefined);
  assert('  undefined ignoré', MX.getMode() === 'iframe');

  console.log('\n=== Test 4 : setMode piped change le mode ===');
  MX.setMode('piped');
  assert('getMode() = piped', MX.getMode() === 'piped');
  assert('isPipedMode() = true', MX.isPipedMode() === true);

  console.log('\n=== Test 5 : setMode piped → applyVolumes() route vers AudioEngine ===');
  // reset
  AE_mock.applyCrossfadeCalls = [];
  AE_mock.applyMasterVolumeCalls = [];
  const players = { A: makePlayer(), B: makePlayer() };
  MX.init(players);
  MX.setMode('piped');
  // Trigger master volume change
  const mvEl = elementsById['master-volume'];
  mvEl.value = '70';
  mvEl._emit('input');
  assert('AudioEngine.applyMasterVolume(70) appelé', AE_mock.applyMasterVolumeCalls.includes(70));
  // setVolume PAS appelé sur les players en mode piped
  assert('  setVolume PAS appelé sur A', players.A._setVolumeCalls.length === 0);
  assert('  setVolume PAS appelé sur B', players.B._setVolumeCalls.length === 0);

  console.log('\n=== Test 6 : setMode piped → crossfader slider passe par AudioEngine ===');
  AE_mock.applyCrossfadeCalls = [];
  const xfEl = elementsById['crossfade'];
  xfEl.value = '25'; // 25% = 75% A / 25% B
  xfEl._emit('input');
  assert('AudioEngine.applyCrossfade(0.25) appelé',
    AE_mock.applyCrossfadeCalls.length > 0 && approx(AE_mock.applyCrossfadeCalls[AE_mock.applyCrossfadeCalls.length - 1], 0.25));
  assert('  xf-value-a = 75', elementsById['xf-value-a'].textContent == 75);
  assert('  xf-value-b = 25', elementsById['xf-value-b'].textContent == 25);

  console.log('\n=== Test 7 : retour en mode iframe → setVolume rétabli ===');
  MX.setMode('iframe');
  AE_mock.applyCrossfadeCalls = [];
  AE_mock.applyMasterVolumeCalls = [];
  players.A._setVolumeCalls = [];
  players.B._setVolumeCalls = [];
  // Re-trigger master change
  mvEl.value = '80';
  mvEl._emit('input');
  assert('  setVolume appelé sur A', players.A._setVolumeCalls.length > 0);
  assert('  setVolume appelé sur B', players.B._setVolumeCalls.length > 0);
  assert('  AudioEngine PAS appelé', AE_mock.applyMasterVolumeCalls.length === 0);
  // Valeur A attendue avec crossfade=25 et master=80 : cos(0.25*π/2)*100*0.8 ≈ 70.71
  const expectedA = Math.cos(0.25 * Math.PI / 2) * 100 * 0.8;
  const expectedB = Math.sin(0.25 * Math.PI / 2) * 100 * 0.8;
  assert('  setVolume A ≈ ' + expectedA.toFixed(2),
    approx(players.A._setVolumeCalls[players.A._setVolumeCalls.length - 1], expectedA, 0.01));
  assert('  setVolume B ≈ ' + expectedB.toFixed(2),
    approx(players.B._setVolumeCalls[players.B._setVolumeCalls.length - 1], expectedB, 0.01));

  console.log('\n=== Test 8 : paliers IFrame (setStepOptions + crossfader) ===');
  // Mode iframe, paliers de 10%, intervalle 50ms
  MX.setStepOptions(10, 50);
  // Re-trigger master pour appliquer les nouvelles options
  mvEl.value = '90';
  mvEl._emit('input');
  assert('  setVolume appelé après stepOptions',
    players.A._setVolumeCalls.length > 0);
  // Maintenant on bouge le crossfader : doit y avoir une transition par paliers
  players.A._setVolumeCalls = [];
  xfEl.value = '40'; // 40% = 60% A / 40% B (cible)
  xfEl._emit('input');
  // Pas instantané : on a appliqué crossfade=40 mais appliedCrossfade démarre à 25
  // → setVolume doit être appelé avec un volume intermédiaire (entre A=75%*0.9 et A=60%*0.9)
  // Premier palier seulement après 50ms (stepIntervalMs) → attendre 120ms.
  await new Promise(r => setTimeout(r, 180));
  assert('  palier intermédiaire appliqué',
    players.A._setVolumeCalls.length > 0, 'A calls: ' + players.A._setVolumeCalls.length);
  // Attendre la fin du stepping
  await new Promise(r => setTimeout(r, 500));
  const finalCall = players.A._setVolumeCalls[players.A._setVolumeCalls.length - 1];
  // Final cible crossfade=40, master=90 : vA = cos(0.4*π/2)*100*0.9 ≈ 56.66
  const expectedFinalA = Math.cos(0.4 * Math.PI / 2) * 100 * 0.9;
  assert('  cible finale atteinte ≈ ' + expectedFinalA.toFixed(2),
    approx(finalCall, expectedFinalA, 0.5));

  console.log('\n=== Test 9 : mode Piped → crossfader instantané (pas de paliers) ===');
  MX.setMode('piped');
  MX.setStepOptions(10, 50); // même avec paliers configurés, ignoré en Piped
  AE_mock.applyCrossfadeCalls = [];
  xfEl.value = '60';
  xfEl._emit('input');
  // En Piped, stepTowardsTarget() appelle applyVolumes() directement avec
  // la cible, sans passer par un setInterval.
  await new Promise(r => setTimeout(r, 30));
  assert('  applyCrossfade appelé avec 0.60',
    approx(AE_mock.applyCrossfadeCalls[AE_mock.applyCrossfadeCalls.length - 1], 0.6));
  // Pas de setVolume sur players en Piped (reset les appels du test 8 d'abord)
  players.A._setVolumeCalls = [];
  players.B._setVolumeCalls = [];
  await new Promise(r => setTimeout(r, 10));
  assert('  setVolume PAS appelé sur A', players.A._setVolumeCalls.length === 0);
  assert('  setVolume PAS appelé sur B', players.B._setVolumeCalls.length === 0);

  console.log('\n=== Test 9.5 : Auto XF désarmé par défaut ===');
  assert('  isAutoXf() initial = false', MX.isAutoXf() === false);
  assert('  setAutoXf(false) → reste false', (MX.setAutoXf(false), MX.isAutoXf()) === false);

  console.log('\n=== Test 9.6 : Piped + Auto XF armé → crossfader atteint la cible par paliers ===');
  // Mode Piped déjà actif. On arme l'auto crossfade avec paliers 10%, intervalle 25ms.
  MX.setAutoXf(true);
  assert('  isAutoXf() = true après setAutoXf(true)', MX.isAutoXf() === true);
  MX.setStepOptions(10, 25);
  AE_mock.applyCrossfadeCalls = [];
  // Valeur courante (appliquée) = 60 depuis le test 9. On bouge vers 20.
  xfEl.value = '20';
  xfEl._emit('input');
  // Pas d'application immédiate de 0.6 → on attend le stepping
  await new Promise(r => setTimeout(r, 180)); // 25ms × ~40% de la distance → environ 4 paliers de 10
  const tail = AE_mock.applyCrossfadeCalls;
  assert('  au moins 2 applyCrossfade appelés (ramp-up)',
    tail.length >= 2, 'got ' + tail.length + ' calls: ' + tail.join(','));
  // Dernière valeur = 0.2 (cible atteinte)
  assert('  cible 0.20 atteinte',
    approx(tail[tail.length - 1], 0.2, 0.001));
  // Pendant la rampe, au moins une valeur strictement entre 0.6 et 0.2
  const hasIntermediate = tail.slice(0, -1).some(v => v > 0.201 && v < 0.599);
  assert('  valeurs intermédiaires (pas de saut direct)',
    hasIntermediate, 'calls: ' + tail.join(','));
  // setVolume jamais appelé en Piped (même en auto XF). On reset les calls
  // précédents (test 8/9 en mode iframe) avant de vérifier.
  players.A._setVolumeCalls = [];
  players.B._setVolumeCalls = [];
  await new Promise(r => setTimeout(r, 10));
  assert('  setVolume PAS appelé sur A (Piped + auto XF)', players.A._setVolumeCalls.length === 0);
  assert('  setVolume PAS appelé sur B (Piped + auto XF)', players.B._setVolumeCalls.length === 0);

  console.log('\n=== Test 9.7 : Désarmer Auto XF → cible appliquée immédiatement===');
  // Bouger le slider avec autoXf=false pendant un potentiel stepping → cible directe
  MX.setAutoXf(false);
  AE_mock.applyCrossfadeCalls = [];
  xfEl.value = '45';
  xfEl._emit('input');
  await new Promise(r => setTimeout(r, 30));
  assert('  applyCrossfade(0.45) immédiat (pas de palier)',
    approx(AE_mock.applyCrossfadeCalls[AE_mock.applyCrossfadeCalls.length - 1], 0.45));
  assert('  pas d\'appels multiples', AE_mock.applyCrossfadeCalls.length === 1);

  console.log('\n=== Test 9.8 : IFrame + Auto XF armé → paliers par setVolume ===');
  MX.setMode('iframe');
  MX.setAutoXf(true);
  MX.setStepOptions(10, 25);
  players.A._setVolumeCalls = [];
  players.B._setVolumeCalls = [];
  // appliedCrossfade repart de l'identique après setMode → = 0.45 (crossfade=45).
  xfEl.value = '10';
  xfEl._emit('input');
  await new Promise(r => setTimeout(r, 150));
  const tailA = players.A._setVolumeCalls;
  assert('  au moins 2 setVolume A (ramp-up)', tailA.length >= 2, 'got ' + tailA.length);
  // Cible finale : crossfade=10, master=90 → vA = cos(0.1*π/2)*100*0.9 ≈ 88.9
  const finalA = Math.cos(0.1 * Math.PI / 2) * 100 * 0.9;
  assert('  cible finale A ≈ ' + finalA.toFixed(1),
    approx(tailA[tailA.length - 1], finalA, 0.5));
  // Valeur intermédiaire présente (pas de saut direct). Départ : crossfade=45
  // → vA = cos(0.45·π/2)·100·0.9 ≈ 56.6 ; cible : crossfade=10 → ≈ 88.9.
  const firstA = Math.cos(0.45 * Math.PI / 2) * 100 * 0.9; // départ ≈ 56.6
  const hasMid = tailA.slice(0, -1).some(v => v > Math.min(firstA, finalA) + 0.5 && v < Math.max(firstA, finalA) - 0.5);
  assert('  valeurs intermédiaires A (ramp-up)', hasMid, tailA.join(','));
  // setVolume PAS appelé sur AudioEngine en iframe
  AE_mock.applyCrossfadeCalls = [];
  xfEl.value = '10'; // même cible, pas de changement
  xfEl._emit('input');
  assert('  AudioEngine PAS appelé en mode iframe (même cible)',
    AE_mock.applyCrossfadeCalls.length === 0);
  // Reset
  MX.setAutoXf(false);
  MX.setMode('piped');
  MX.setStepOptions(100, 0);

  console.log('\n=== Test 10 : syncBtoA → seek B au currentTime de A + play si A joue ===');
  MX.setMode('iframe'); // retour iframe pour ce test
  players.A._currentTime = 42.5;
  players.A._playerState = 1; // PLAYING
  players.B._seekCalls = [];
  players.B._playCalls = 0;
  MX.syncBtoA();
  assert('  B.seekTo(42.5) appelé', players.B._seekCalls.length === 1 && players.B._seekCalls[0] === 42.5);
  assert('  B.playVideo() appelé (A joue)', players.B._playCalls === 1);

  console.log('\n=== Test 11 : syncBtoA → seek sans play si A est PAUSED ===');
  players.A._playerState = 2; // PAUSED
  players.B._seekCalls = [];
  players.B._playCalls = 0;
  MX.syncBtoA();
  assert('  B.seekTo appelé', players.B._seekCalls.length === 1);
  assert('  B.playVideo PAS appelé (A paused)', players.B._playCalls === 0);

  console.log('\n=== Test 12 : toggleContinuousSync avec seuil adaptatif Piped (0.2s) ===');
  // On simule le bouton
  const resyncBtn = elementsById['resync-toggle'];
  // On accède au handle interne via un hack : on intercepte setInterval
  // avant d'activer le sync continu.
  let intervalFn = null;
  const origSetInterval = global.setInterval;
  global.setInterval = function (fn, ms) {
    if (ms === 1000) {
      intervalFn = fn;
      return 'mock-handle';
    }
    return origSetInterval(fn, ms);
  };
  MX.setMode('piped');
  resyncBtn._emit('click');
  assert('  setInterval capturé', typeof intervalFn === 'function');
  // Configurer A et B pour un drift > 0.2s (seuil Piped)
  players.A._currentTime = 10.0;
  players.B._currentTime = 9.7; // drift = 0.3s > 0.2s
  players.B._seekCalls = [];
  intervalFn();
  assert('  drift 0.3s en Piped → seek appelé', players.B._seekCalls.length === 1);
  // Maintenant drift < 0.2s (seuil Piped) : PAS de seek
  players.B._currentTime = 9.85; // drift = 0.15s < 0.2s
  players.B._seekCalls = [];
  intervalFn();
  assert('  drift 0.15s en Piped → PAS de seek', players.B._seekCalls.length === 0);

  console.log('\n=== Test 13 : toggleContinuousSync seuil IFrame (0.5s) ===');
  // Toggle off
  resyncBtn._emit('click');
  assert('  aria-pressed=false après off', resyncBtn['aria-pressed'] === 'false');
  // Toggle on en mode iframe
  MX.setMode('iframe');
  intervalFn = null;
  resyncBtn._emit('click');
  assert('  setInterval capturé (iframe)', typeof intervalFn === 'function');
  // Drift 0.3s < 0.5s (seuil iframe) : PAS de seek
  players.A._currentTime = 10.0;
  players.B._currentTime = 9.7;
  players.B._seekCalls = [];
  intervalFn();
  assert('  drift 0.3s en IFrame → PAS de seek (< 0.5s)', players.B._seekCalls.length === 0);
  // Drift 0.6s > 0.5s (seuil iframe) : seek
  players.B._currentTime = 9.4;
  players.B._seekCalls = [];
  intervalFn();
  assert('  drift 0.6s en IFrame → seek appelé', players.B._seekCalls.length === 1);

  console.log('\n=== Test 14 : playBoth / pauseBoth déclenchent les 2 players ===');
  MX.setMode('iframe');
  players.A._playCalls = 0; players.B._playCalls = 0;
  elementsById['play-both']._emit('click');
  assert('  playBoth → A.playVideo', players.A._playCalls === 1);
  assert('  playBoth → B.playVideo', players.B._playCalls === 1);
  players.A._pauseCalls = 0; players.B._pauseCalls = 0;
  elementsById['pause-both']._emit('click');
  assert('  pauseBoth → A.pauseVideo', players.A._pauseCalls === 1);
  assert('  pauseBoth → B.pauseVideo', players.B._pauseCalls === 1);

  console.log('\n=== Test 15 : bouton sync-ba déclenche syncBtoA ===');
  players.A._currentTime = 99.9;
  players.B._seekCalls = [];
  elementsById['sync-ba']._emit('click');
  assert('  sync-ba → B.seekTo(99.9)', players.B._seekCalls.length === 1 && players.B._seekCalls[0] === 99.9);

  console.log('\n=== Test 16 : setMode piped → stopStepping + applyVolumes immédiat ===');
  MX.setMode('piped');
  AE_mock.applyMasterVolumeCalls = [];
  mvEl.value = '60';
  mvEl._emit('input');
  // En Piped, l'application est instantanée (pas de paliers)
  assert('  applyMasterVolume(60) appelé immédiatement',
    AE_mock.applyMasterVolumeCalls.includes(60));

  console.log('\n=== Résumé ===');
  console.log('Pass:', pass, '/ Fail:', fail);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(function (e) {
  console.error('Test runner crashed:', e);
  process.exit(2);
});

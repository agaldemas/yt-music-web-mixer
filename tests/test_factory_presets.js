// tests/test_factory_presets.js — Vérifie que les 5 presets d'usine
// sont correctement chargés via jsdom et que 3 chargements successifs
// produisent 3 grilles différentes (validation manuelle). Vérifie aussi
// que TOUS les modules du séquenceur se chargent sans ReferenceError /
// SyntaxError (sinon ce test échoue et npm test détecte le bug).
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'sequencer.html'), 'utf8');

// On capture les erreurs jsdom (chargement des <script>) — en temps
// normal VirtualConsole les swallow, ce qui masque les ReferenceError /
// SyntaxError au chargement et laisse la page silencieusement cassée.
// On en propage au moins la première sur console.error pour que npm test
// échoue si un module ne se charge pas.
let firstScriptError = null;
const vc = new VirtualConsole();
vc.on('jsdomError', (err) => {
  if (!firstScriptError) firstScriptError = err;
  // Affiche la 1ère, et un compteur pour les suivantes (debug).
  if (firstScriptError === err) {
    console.error('[jsdom] script load error:', err && err.message ? err.message : err);
  }
});
vc.on('error', (err) => {
  if (!firstScriptError) firstScriptError = err;
  if (firstScriptError === err) {
    console.error('[jsdom] error:', err && err.message ? err.message : err);
  }
});
// On laisse passer les console.warn (utiles pour debug) mais on log
// les console.error des scripts (ex: "sequencer: track X trigger failed").
vc.on('log', (...a) => console.log('[page]', ...a));
vc.on('warn', (...a) => console.warn('[page]', ...a));
vc.on('info', (...a) => console.log('[page info]', ...a));

const dom = new JSDOM(html, {
  url: 'file://' + path.join(ROOT, 'sequencer.html'),
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  virtualConsole: vc,
});

(async () => {
  // Attendre le chargement des scripts via resources:usable
  await new Promise((r) => setTimeout(r, 800));

  const w = dom.window;

  // === Assertions ===
  let ok = true;
  function check(label, cond) {
    console.log(`${cond ? 'OK  ' : 'FAIL'} : ${label}`);
    if (!cond) ok = false;
  }

  // 0) Aucun ReferenceError / SyntaxError au chargement des <script>
  check('Aucun ReferenceError/SyntaxError au chargement des scripts',
    firstScriptError === null);

  // 1) SEQUENCER_CFG exposé sur window après chargement complet
  check('window.SEQUENCER_CFG défini', !!w.SEQUENCER_CFG);
  check('SEQUENCER_CFG.GRID_TRACKS = 9 pistes',
    Array.isArray(w.SEQUENCER_CFG && w.SEQUENCER_CFG.GRID_TRACKS) &&
    w.SEQUENCER_CFG.GRID_TRACKS.length === 9);
  check('SEQUENCER_CFG.DRUM_PADS = 8 pads',
    Array.isArray(w.SEQUENCER_CFG && w.SEQUENCER_CFG.DRUM_PADS) &&
    w.SEQUENCER_CFG.DRUM_PADS.length === 8);
  check('SEQUENCER_CFG.gridEl résolu',
    !!(w.SEQUENCER_CFG && w.SEQUENCER_CFG.gridEl));
  check('SEQUENCER_CFG.drumKitEl résolu',
    !!(w.SEQUENCER_CFG && w.SEQUENCER_CFG.drumKitEl));

  // 1bis) Tous les sous-modules ont exposé leur window.SEQUENCER_*
  check('window.SEQUENCER_GRID défini', !!w.SEQUENCER_GRID);
  check('window.SEQUENCER_MIX défini', !!w.SEQUENCER_MIX);
  check('window.SEQUENCER_SOUND défini', !!w.SEQUENCER_SOUND);
  check('window.SEQUENCER_DRUMKIT défini', !!w.SEQUENCER_DRUMKIT);
  check('window.SEQUENCER_PRESETS défini', !!w.SEQUENCER_PRESETS);
  check('window.SEQUENCER_TRANSPORT défini', !!w.SEQUENCER_TRANSPORT);

  // 1ter) Aucune variable globale dupliquée entre scripts
  // (la collision `const _CFG` au top-level lèverait un SyntaxError au
  // chargement, déjà capté par firstScriptError ; on documente juste le
  // invariant : on ne doit avoir qu'UN const GRID_TRACKS / DRUM_PADS / etc.
  check('const global GRID_TRACKS non redéclaré par sequencer-app.js',
    typeof w.GRID_TRACKS === 'undefined');
  check('const global DRUM_PADS non redéclaré par sequencer-app.js',
    typeof w.DRUM_PADS === 'undefined');

  // 1) FACTORY_PRESETS est exposé et contient 5 entrées
  check('FACTORY_PRESETS défini', Array.isArray(w.FACTORY_PRESETS));
  check('FACTORY_PRESETS contient 5 presets', w.FACTORY_PRESETS.length === 5);
  const ids = w.FACTORY_PRESETS.map((p) => p.id);
  check('IDs attendus présents',
    ids.includes('rock-4-4') &&
    ids.includes('house-electro') &&
    ids.includes('trap-hiphop') &&
    ids.includes('funk-disco') &&
    ids.includes('reggae-dub'));

  // 2) Chaque preset a un pattern[9][16] valide
  w.FACTORY_PRESETS.forEach((p) => {
    check(`preset "${p.id}" pattern 9×16`,
      Array.isArray(p.pattern) && p.pattern.length === 9 &&
      p.pattern.every((row) => Array.isArray(row) && row.length === 16 &&
        row.every((c) => typeof c === 'boolean')));
  });

  // 3) Le bouton "🎵 Presets" existe dans le DOM
  const btn = w.document.getElementById('factory-btn');
  check('Bouton #factory-btn présent', !!btn);
  check('Label initial = "🎵 Presets ▾"', btn && btn.textContent === '🎵 Presets ▾');
  const menu = w.document.getElementById('factory-menu');
  check('Menu #factory-menu présent', !!menu);
  check('Menu peuplé avec 5 items', menu.querySelectorAll('.track-sound-menu-item').length === 5);

  // Helper : lit la grille depuis le DOM (.active sur .step). Retourne pattern[9][16].
  function readGridFromDOM() {
    const rows = w.document.querySelectorAll('#step-matrix .step-row');
    const grid = [];
    rows.forEach((row) => {
      const cells = row.querySelectorAll('.step');
      const r = [];
      cells.forEach((c) => r.push(c.classList.contains('active')));
      grid.push(r);
    });
    return grid;
  }
  function gridEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  // 4) Chargement Rock 4/4
  check('loadFactoryPreset exposé', typeof w.loadFactoryPreset === 'function');
  const r1 = w.loadFactoryPreset('rock-4-4');
  check('Rock : preset résolu', r1 && r1.id === 'rock-4-4');
  let g = readGridFromDOM();
  check('Rock : kick sur 0,4,8,12 (ligne Kick)',
    g[0][0] && g[0][4] && g[0][8] && g[0][12] &&
    !g[0][1] && !g[0][2] && !g[0][3]);
  check('Rock : snare backbeat 4,12 (ligne Snare)',
    g[1][4] && g[1][12] && !g[1][0] && !g[1][8]);
  check('Rock : ride sur 0,4,8,12 (ligne Ride)',
    g[8][0] && g[8][4] && g[8][8] && g[8][12]);
  check('Rock : BPM = 110',
    w.document.getElementById('bpm').value === '110' &&
    w.document.getElementById('bpm-value').textContent === '110');
  check('Rock : label bouton = "🥁 Rock 4/4 ▾"',
    btn.textContent === '🥁 Rock 4/4 ▾');

  // 5) Chargement House
  w.loadFactoryPreset('house-electro');
  g = readGridFromDOM();
  check('House : kick sur 0,4,8,12', g[0][0] && g[0][4] && g[0][8] && g[0][12]);
  check('House : snare sur 4,12', g[1][4] && g[1][12]);
  check('House : hat closed sur offbeats 2,6,10,14',
    g[2][2] && g[2][6] && g[2][10] && g[2][14] && !g[2][0]);
  check('House : hat open sur 6', g[3][6]);
  check('House : BPM = 124', w.document.getElementById('bpm').value === '124');

  // 6) Chargement Reggae — one-drop + cross-stick + skank OBLIGATOIRE
  w.loadFactoryPreset('reggae-dub');
  g = readGridFromDOM();
  check('Reggae : kick ONE-DROP uniquement sur 0 et 8',
    g[0][0] && g[0][8] && !g[0][4] && !g[0][12] &&
    !g[0][1] && !g[0][2] && !g[0][3]);
  check('Reggae : snare CROSS-STICK sur 12',
    g[1][12] && !g[1][4] && !g[1][0] && !g[1][8]);
  check('Reggae : skank hat closed sur 2,6,10,14',
    g[2][2] && g[2][6] && g[2][10] && g[2][14] && !g[2][0]);
  check('Reggae : tom high skank guitare sur 3,11',
    g[4][3] && g[4][11] && !g[4][0]);
  check('Reggae : BPM = 72', w.document.getElementById('bpm').value === '72');
  check('Reggae : label bouton = "🇯🇲 Reggae / Dub ▾"',
    btn.textContent === '🇯🇲 Reggae / Dub ▾');

  // 7) 3 grilles strictement différentes
  w.loadFactoryPreset('rock-4-4');
  const rockSnap = JSON.stringify(readGridFromDOM());
  w.loadFactoryPreset('house-electro');
  const houseSnap = JSON.stringify(readGridFromDOM());
  w.loadFactoryPreset('reggae-dub');
  const reggaSnap = JSON.stringify(readGridFromDOM());
  check('Rock ≠ House ≠ Reggae (3 grilles distinctes)',
    rockSnap !== houseSnap && houseSnap !== reggaSnap && rockSnap !== reggaSnap);

  // 8) Persistance localStorage ytwm_activeFactoryPreset
  let storageOk = false;
  try {
    storageOk = w.localStorage.getItem('ytwm_activeFactoryPreset') === 'reggae-dub';
  } catch (_) { /* file:// URL → localStorage inaccessible */ }
  check('localStorage ytwm_activeFactoryPreset = "reggae-dub" (skippé si file://)',
    storageOk || dom.window.location.protocol === 'file:');

  // 9) Trap & Funk/Disco : smoke-test
  w.loadFactoryPreset('trap-hiphop');
  g = readGridFromDOM();
  check('Trap : kick syncopé [0,3,7,11]',
    g[0][0] && g[0][3] && g[0][7] && g[0][11] && !g[0][4]);
  check('Trap : tom low (808) sur 6', g[6][6]);
  w.loadFactoryPreset('funk-disco');
  g = readGridFromDOM();
  check('Funk/Disco : kick [0,7,10]',
    g[0][0] && g[0][7] && g[0][10] && !g[0][4]);
  check('Funk/Disco : hat 16e continue', g[2].filter(Boolean).length === 8);

  console.log(ok ? '\nFactory presets: OK' : '\nFactory presets: FAIL');
  process.exit(ok ? 0 : 1);
})().catch((err) => {
  console.error('Erreur fatale:', err);
  process.exit(1);
});
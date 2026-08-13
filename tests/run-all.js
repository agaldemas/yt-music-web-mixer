#!/usr/bin/env node
/* run-all.js — lance tous les tests de la suite en séquence
 *
 * Chaque fichier test_*.js est exécuté dans un sous-process Node pour
 * isolation totale (mocks, globals, etc.). Les tests "réseau" (qui tapent
 * sur les vraies instances Piped) sont marqués "non-bloquants" : un échec
 * là-bas est signalé en warning mais ne fait pas échouer la suite.
 *
 * Usage : node tests/run-all.js
 */

const path = require('path');
const { spawnSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const TEST_DIR = __dirname;

const TESTS = [
  { file: 'test_piped_streams.js', network: false },
  { file: 'test_audio_engine.js', network: false },
  { file: 'test_audio_player.js', network: false },
  { file: 'test_multi.js', network: true },
  { file: 'test_audio_track.js', network: true },
];

let totalFail = 0;
let totalPass = 0;
let netFails = 0;

for (const t of TESTS) {
  console.log('\n=========================================================');
  console.log('▶ ' + t.file + (t.network ? '  (network — non-blocking)' : ''));
  console.log('=========================================================');
  const result = spawnSync('node', [path.join(TEST_DIR, t.file)], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.status === 0) {
    console.log('✓ ' + t.file + ' : OK');
  } else if (t.network) {
    console.log('⚠ ' + t.file + ' : ÉCHEC (network — non-bloquant)');
    netFails += 1;
  } else {
    console.log('✗ ' + t.file + ' : ÉCHEC');
    totalFail += 1;
  }
}

console.log('\n=========================================================');
console.log('▶ Résumé global');
console.log('=========================================================');
if (totalFail === 0) {
  console.log('✅ Tous les tests non-réseau sont passés.');
} else {
  console.log('❌ ' + totalFail + ' fichier(s) de test en échec.');
}
if (netFails > 0) {
  console.log('⚠ ' + netFails + ' test(s) réseau en échec (non-bloquant, dépend des instances Piped).');
}

process.exit(totalFail > 0 ? 1 : 0);
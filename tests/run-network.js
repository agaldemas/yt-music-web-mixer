#!/usr/bin/env node
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');
const TESTS = ['test_multi.js', 'test_audio_track.js'];
let failed = 0;
for (const file of TESTS) {
  console.log(`\n=== réseau: ${file} ===`);
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
  if (result.status !== 0) failed += 1;
}
console.log(`\nRéseau: ${TESTS.length - failed}/${TESTS.length} réussis.`);
process.exit(failed ? 1 : 0);

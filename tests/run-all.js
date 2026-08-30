#!/usr/bin/env node
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const TESTS = [
  'test_id3.js',
  'test_task_queue.js',
  'test_piped_streams.js',
  'test_youtube.js',
  'test_audio_engine.js',
  'test_audio_player.js',
  'test_mixer.js',
  'test_server.js',
  'test_scratch_slice.js',
];
let failed = 0;
for (const file of TESTS) {
  console.log(`\n=== ${file} ===`);
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) failed += 1;
}
console.log(`\n${failed ? '❌' : '✅'} ${TESTS.length - failed}/${TESTS.length} fichiers de tests passés.`);
process.exit(failed ? 1 : 0);

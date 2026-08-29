#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const files = [];
for (const dir of ['js', 'server', 'tests']) {
  for (const name of fs.readdirSync(path.join(ROOT, dir))) {
    if (name.endsWith('.js') || name.endsWith('.cjs')) files.push(path.join(ROOT, dir, name));
  }
}
let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) failed += 1;
}
console.log(`Syntaxe: ${files.length - failed}/${files.length} fichiers valides.`);
process.exit(failed ? 1 : 0);

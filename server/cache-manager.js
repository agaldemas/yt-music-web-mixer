'use strict';

const fs = require('fs');
const path = require('path');
const AUDIO_EXT_RE = /\.(mp3|m4a|opus|webm|aac)$/i;
const TEMP_RE = /\.(tmp|cover\.mp3|meta\.mp3|jpg)$/i;

function createCacheManager(options) {
  const opts = options || {};
  const dir = opts.dir;
  const maxBytes = Math.max(1, Number(opts.maxBytes) || 2 * 1024 * 1024 * 1024);
  const maxEntries = Math.max(1, Number(opts.maxEntries) || 100);
  const tempMaxAgeMs = Math.max(60000, Number(opts.tempMaxAgeMs) || 24 * 3600 * 1000);

  async function listAudio() {
    let names = [];
    try { names = await fs.promises.readdir(dir); } catch (_) { return []; }
    const rows = [];
    for (const name of names) {
      if (!AUDIO_EXT_RE.test(name)) continue;
      const file = path.join(dir, name);
      try {
        const st = await fs.promises.stat(file);
        if (st.isFile()) rows.push({ file, name, size: st.size, mtimeMs: st.mtimeMs });
      } catch (_) {}
    }
    return rows;
  }

  async function stats() {
    const rows = await listAudio();
    return { audioBytes: rows.reduce((sum, row) => sum + row.size, 0), audioEntries: rows.length, maxBytes, maxEntries };
  }

  async function touch(file) {
    const now = new Date();
    try { await fs.promises.utimes(file, now, now); } catch (_) {}
  }

  async function prune(protectedFiles) {
    const protectedSet = new Set((protectedFiles || []).map((f) => path.resolve(f)));
    const rows = await listAudio();
    rows.sort((a, b) => a.mtimeMs - b.mtimeMs);
    let bytes = rows.reduce((sum, row) => sum + row.size, 0);
    let count = rows.length;
    const removed = [];
    for (const row of rows) {
      if (bytes <= maxBytes && count <= maxEntries) break;
      if (protectedSet.has(path.resolve(row.file))) continue;
      try {
        await fs.promises.unlink(row.file);
        bytes -= row.size;
        count -= 1;
        removed.push(row.file);
      } catch (_) {}
    }
    return { removed, audioBytes: bytes, audioEntries: count, maxBytes, maxEntries };
  }

  async function cleanupTemps() {
    let names = [];
    try { names = await fs.promises.readdir(dir); } catch (_) { return []; }
    const cutoff = Date.now() - tempMaxAgeMs;
    const removed = [];
    for (const name of names) {
      if (!TEMP_RE.test(name)) continue;
      const file = path.join(dir, name);
      try {
        const st = await fs.promises.stat(file);
        if (st.isFile() && st.mtimeMs < cutoff) {
          await fs.promises.unlink(file);
          removed.push(file);
        }
      } catch (_) {}
    }
    return removed;
  }

  return { stats, touch, prune, cleanupTemps, maxBytes, maxEntries };
}

module.exports = { createCacheManager };

'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
global.window = { location: { protocol: 'file:' } };
global.localStorage = { getItem(){return null;}, setItem(){}, removeItem(){} };
let calls = 0;
global.fetch = async function () {
  calls += 1;
  return {
    ok: true,
    status: 200,
    json: async function () {
      return {
        title: 'Mock', duration: 120, thumbnailUrl: 'https://x/img.jpg', uploader: 'Tester',
        audioStreams: [{ url: 'https://x/audio.m4a', format: 'M4A', bitrate: 128, mimeType: 'audio/mp4', videoOnly: false }],
        videoStreams: [],
      };
    },
  };
};
require(path.join(ROOT, 'js/config.js'));
window.YT_CONFIG.PIPED_INSTANCES = ['mock.instance'];
require(path.join(ROOT, 'js/piped-streams.js'));
(async function () {
  const P = window.PipedStreams;
  let invalid = false;
  try { await P.fetchStreamInfo('!'); } catch (e) { invalid = e.kind === 'invalid-id'; }
  if (!invalid) throw new Error('invalid id');
  const entry = await P.fetchStreamInfo('abc123XYZ_-');
  if (!entry.bestAudio || entry.durationSeconds !== 120) throw new Error('normalisation');
  if (calls !== 1) throw new Error('fetch count');
  const cached = await P.fetchStreamInfo('abc123XYZ_-');
  if (cached !== entry || calls !== 1) throw new Error('cache');
  console.log('PipedStreams: tests déterministes passés.');
})().catch(function (e) { console.error(e); process.exit(1); });

/* mp3-filename.js — nom de sauvegarde commun au serveur et au navigateur. */
(function () {
  'use strict';

  function buildMp3Filename(title, artist, videoId) {
    function clean(text) {
      return String(text || '').replace(/[/\\:*?"<>|\x00-\x1f\x7f]/g, '-').replace(/\s+/g, ' ').trim();
    }
    var name = clean(title);
    var author = clean(artist);
    if (name && author) name += '-' + author;
    if (!name) {
      var id = clean(videoId);
      name = id ? 'audio-' + id : 'audio';
    }
    var encoder = new TextEncoder();
    var filename = '';
    var bytes = 0;
    for (var char of name) {
      bytes += encoder.encode(char).length;
      if (bytes > 250) break;
      filename += char;
    }
    return (filename.trim() || 'audio') + '.mp3';
  }

  if (typeof module === 'object' && module.exports) module.exports = buildMp3Filename;
  else window.buildMp3Filename = buildMp3Filename;
})();

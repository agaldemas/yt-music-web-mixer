/* id3.js — parseur ID3v2.3/v2.4 borné, compatible file:// */
(function () {
  'use strict';

  function synchsafe(bytes, offset) {
    return ((bytes[offset] & 0x7f) << 21) | ((bytes[offset + 1] & 0x7f) << 14)
      | ((bytes[offset + 2] & 0x7f) << 7) | (bytes[offset + 3] & 0x7f);
  }

  function uint32(bytes, offset) {
    return (((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16)
      + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
  }

  function trimNulls(value) { return String(value || '').replace(/^\uFEFF/, '').replace(/\0+$/g, '').trim(); }

  function swap16(bytes) {
    var out = new Uint8Array(bytes.length - (bytes.length % 2));
    for (var i = 0; i < out.length; i += 2) { out[i] = bytes[i + 1]; out[i + 1] = bytes[i]; }
    return out;
  }

  function decodeText(body) {
    if (!body || !body.length) return '';
    var encoding = body[0];
    var payload = body.slice(1);
    try {
      if (encoding === 0) return trimNulls(new TextDecoder('windows-1252').decode(payload));
      if (encoding === 3) return trimNulls(new TextDecoder('utf-8').decode(payload));
      if (encoding === 2) return trimNulls(new TextDecoder('utf-16le').decode(swap16(payload)));
      if (encoding === 1) {
        if (payload[0] === 0xfe && payload[1] === 0xff) return trimNulls(new TextDecoder('utf-16le').decode(swap16(payload.slice(2))));
        if (payload[0] === 0xff && payload[1] === 0xfe) return trimNulls(new TextDecoder('utf-16le').decode(payload.slice(2)));
        return trimNulls(new TextDecoder('utf-16le').decode(payload));
      }
    } catch (_) {}
    return '';
  }

  function parseTag(buffer) {
    var bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer || 0);
    if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return null;
    var version = bytes[3];
    if (version !== 3 && version !== 4) return null;
    var tagSize = synchsafe(bytes, 6);
    var end = Math.min(bytes.length, 10 + tagSize);
    var frames = [];
    var pos = 10;
    while (pos + 10 <= end) {
      var id = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      var size = version === 4 ? synchsafe(bytes, pos + 4) : uint32(bytes, pos + 4);
      if (!size || size > end - pos - 10) break;
      frames.push({ id: id, body: bytes.slice(pos + 10, pos + 10 + size) });
      pos += 10 + size;
    }
    return { version: version, frames: frames };
  }

  function metadata(buffer, fileName) {
    var tag = parseTag(buffer);
    var result = { title: fileName || '', artist: '' };
    if (!tag) return result;
    tag.frames.forEach(function (frame) {
      if (frame.id === 'TIT2' && !result._title) { result.title = decodeText(frame.body) || result.title; result._title = true; }
      if (frame.id === 'TPE1' && !result._artist) { result.artist = decodeText(frame.body); result._artist = true; }
    });
    delete result._title; delete result._artist;
    return result;
  }

  function picture(buffer) {
    var tag = parseTag(buffer);
    if (!tag) return null;
    var frame = tag.frames.find(function (f) { return f.id === 'APIC'; });
    if (!frame || frame.body.length < 8) return null;
    var body = frame.body;
    var encoding = body[0];
    var mimeEnd = 1;
    while (mimeEnd < body.length && body[mimeEnd] !== 0) mimeEnd++;
    var mime = trimNulls(new TextDecoder('latin1').decode(body.slice(1, mimeEnd))).toLowerCase();
    var allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.indexOf(mime) === -1) mime = 'image/jpeg';
    var pos = mimeEnd + 2; // séparateur + picture type
    var wide = encoding === 1 || encoding === 2;
    if (wide) {
      while (pos + 1 < body.length && !(body[pos] === 0 && body[pos + 1] === 0)) pos += 2;
      pos += 2;
    } else {
      while (pos < body.length && body[pos] !== 0) pos++;
      pos += 1;
    }
    if (pos >= body.length) return null;
    return { mime: mime, bytes: body.slice(pos) };
  }

  window.ID3 = { parseTag: parseTag, metadata: metadata, picture: picture, decodeText: decodeText };
})();

'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
let pass = 0;
function ok(value, message) { if (!value) throw new Error(message); pass += 1; }
const context = { window: {}, TextDecoder, Uint8Array, URL, Blob };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/id3.js'), 'utf8'), context);
function frame(id, body, version) {
  const out = Buffer.alloc(10 + body.length); out.write(id, 0, 'ascii');
  if (version === 4) {
    out[4] = (body.length >> 21) & 0x7f; out[5] = (body.length >> 14) & 0x7f;
    out[6] = (body.length >> 7) & 0x7f; out[7] = body.length & 0x7f;
  } else out.writeUInt32BE(body.length, 4);
  body.copy(out, 10); return out;
}
function tag(frames, version) {
  const body = Buffer.concat(frames); const out = Buffer.alloc(10 + body.length);
  out.write('ID3'); out[3] = version; out[6] = (body.length >> 21) & 0x7f;
  out[7] = (body.length >> 14) & 0x7f; out[8] = (body.length >> 7) & 0x7f; out[9] = body.length & 0x7f;
  body.copy(out, 10); return out;
}
const title = Buffer.concat([Buffer.from([3]), Buffer.from('Titre UTF-8')]);
const artist = Buffer.concat([Buffer.from([3]), Buffer.from('Artiste')]);
const parsed = context.window.ID3.metadata(tag([frame('TIT2', title, 3), frame('TPE1', artist, 3)], 3), 'fallback.mp3');
ok(parsed.title === 'Titre UTF-8', 'octet encodage non retiré');
ok(parsed.artist === 'Artiste', 'artiste incorrect');
const png = Buffer.from([1,2,3,4]);
const apic = Buffer.concat([Buffer.from([3]), Buffer.from('image/png\0'), Buffer.from([3]), Buffer.from('cover\0'), png]);
const pic = context.window.ID3.picture(tag([frame('APIC', apic, 4)], 4));
ok(pic.mime === 'image/png', 'MIME APIC incorrect');
ok(Buffer.from(pic.bytes).equals(png), 'données APIC incorrectes');
ok(context.window.ID3.parseTag(Buffer.from('invalid')) === null, 'tag invalide accepté');
console.log(`ID3: ${pass} assertions passées.`);

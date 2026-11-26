'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { JSDOM } = require('jsdom');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

async function run() {
    const dom = new JSDOM(read('sequencer.html'), { runScripts: 'outside-only' });
    const { window: w } = dom;
    try {
        const get = id => w.document.getElementById(id);
        const transport = new EventEmitter();
        const starts = [], stops = [];
        let source;
        w.Tone = {
            Transport: transport,
            Destination: {},
            immediate: () => 40,
            connect: (node, destination) => assert.equal(destination, w.Tone.Destination),
            getContext: () => ({
                decodeAudioData: async bytes => {
                    if (!bytes.byteLength) throw new Error('Fichier illisible');
                    return { duration: 4, length: 4, sampleRate: 100, numberOfChannels: 1,
                        getChannelData: () => Float32Array.of(0, 0.5, -0.8, 0.2) };
                },
                createBufferSource: () => (source = {
                    start: (...args) => starts.push(args),
                    stop: time => stops.push(time),
                    disconnect() {},
                }),
            }),
        };
        w.eval(read('js/track-waveform.js'));
        w.eval(read('js/sequencer-sample-track.js'));
        await new Promise(resolve => w.addEventListener('DOMContentLoaded', resolve, { once: true }));
        async function drop(name, size) {
            const event = new w.Event('drop', { cancelable: true });
            event.dataTransfer = { files: [{ name, size, arrayBuffer: async () => new ArrayBuffer(size) }] };
            assert.equal(get('sample-track').dispatchEvent(event), false);
            await new Promise(resolve => setImmediate(resolve));
        }
        await drop('boucle.mp3', 1);
        assert.equal(get('sample-name')?.textContent, 'boucle.mp3');
        assert.equal(get('sample-status').textContent, '');
        assert.equal(get('sample-end-time').textContent, '0:04,00');
        assert.match(get('sample-peaks').getAttribute('d'), /M375\.00 -2\.00V102\.00/);
        assert.equal(starts.length, 0);
        const axis = get('sample-timeline');
        axis.getBoundingClientRect = () => ({ left: 50, width: 400 });
        const pointer = (id, type, clientX, pointerType = 'mouse') => get(id).dispatchEvent(
            new w.PointerEvent(type, { bubbles: true, pointerId: 1, pointerType, button: 0, clientX }));
        for (const id of ['sample-start', 'sample-end']) get(id).setPointerCapture = () => {};
        pointer('sample-start', 'pointerdown', 50);
        pointer('sample-start', 'pointermove', 141);
        assert.equal(get('sample-start-time').textContent, '0:00,91');
        pointer('sample-start', 'pointermove', 150);
        assert.equal(get('sample-start-time').textContent, '0:01,00');
        pointer('sample-start', 'pointerup', 150);
        pointer('sample-end', 'pointerdown', 450, 'touch');
        pointer('sample-end', 'pointermove', 80, 'touch');
        assert.equal(get('sample-end-time').textContent, '0:01,01');
        pointer('sample-end', 'pointermove', 350, 'touch');
        assert.equal(get('sample-end-time').textContent, '0:03,00');
        pointer('sample-end', 'pointerup', 350, 'touch');
        transport.emit('start', 10);
        assert.deepEqual(starts, [[10, 1]]);
        assert.deepEqual([source.loop, source.loopStart, source.loopEnd], [true, 1, 3]);
        transport.emit('pause', 12.5);
        transport.emit('start', 20);
        assert.deepEqual(starts.at(-1), [20, 1.5]);
        transport.emit('stop', 21);
        assert.deepEqual(stops, [12.5, 21]);
        await drop('invalide.mp3', 0);
        assert.match(get('sample-status').textContent, /La piste actuelle est conservée/);
        assert.equal(get('sample-name').textContent, 'boucle.mp3');
        assert.equal(get('sample-end-time').textContent, '0:03,00');
        get('sample-loop').checked = false;
        transport.emit('start', 30);
        assert.deepEqual(starts.at(-1), [30, 1, 2]);
        get('sample-remove').click();
        transport.emit('start', 50);
        assert.equal(stops.at(-1), 40);
        assert.equal(starts.length, 3);
        console.log('Piste audio : import, boucle, pause, stop, lecture unique et retrait vérifiés.');
    } finally {
        w.close();
    }
}
run().catch(error => { console.error(error); process.exitCode = 1; });

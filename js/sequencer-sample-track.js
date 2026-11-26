// Piste audio locale distincte des pads. Les événements du transport Tone
// fournissent la même horloge Web Audio que les frappes de la batterie.
(() => {
    const MAX_FILE_SIZE = 20 * 1024 * 1024;
    const WAVEFORM_BARS = 600;

    function waveformPath(buffer) {
        const count = Math.min(buffer.length, WAVEFORM_BARS);
        const peaks = new Float32Array(count);
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            const samples = buffer.getChannelData(channel);
            for (let bar = 0, from = 0; bar < count; bar++) {
                const to = Math.floor((bar + 1) * samples.length / count);
                let peak = peaks[bar];
                for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(samples[i]));
                peaks[bar] = peak;
                from = to;
            }
        }
        const maxPeak = Math.max(...peaks, 0.0001);
        return Array.from(peaks, (peak, bar) => {
            const x = ((bar + 0.5) * WAVEFORM_BARS / count).toFixed(2);
            // Normalise le morceau pour que son pic touche la zone utile :
            // le silence vertical doit venir des marqueurs, pas du niveau du fichier.
            const height = Math.max(0.6, (peak / maxPeak) * 52);
            return `M${x} ${(50 - height).toFixed(2)}V${(50 + height).toFixed(2)}`;
        }).join('');
    }

    function formatTime(seconds) {
        const ticks = Math.round(seconds * 100);
        const minutes = Math.floor(ticks / 6000);
        const wholeSeconds = String(Math.floor(ticks / 100) % 60).padStart(2, '0');
        return `${minutes}:${wholeSeconds},${String(ticks % 100).padStart(2, '0')}`;
    }
    window.addEventListener('DOMContentLoaded', () => {
        const track = document.getElementById('sample-track');
        if (!track || typeof Tone === 'undefined') return;
        const fileInput = document.getElementById('sample-file');
        const remove = document.getElementById('sample-remove');
        const options = document.getElementById('sample-options');
        const name = document.getElementById('sample-name');
        const timeline = document.getElementById('sample-timeline');
        const empty = document.getElementById('sample-empty');
        const peaks = document.getElementById('sample-peaks');
        const duration = document.getElementById('sample-duration');
        const markers = ['start', 'end'].map(key => ({
            key,
            handle: document.getElementById('sample-' + key),
            label: document.getElementById('sample-' + key + '-time'),
        }));
        const loopInput = document.getElementById('sample-loop');
        const status = document.getElementById('sample-status');
        const transport = Tone.Transport;
        if (typeof transport?.on !== 'function') return;
        const initialName = name.textContent;
        let drag = null;
        let clip = null;
        let voice = null;
        let elapsed = 0;
        let importId = 0;

        function show(message, error = false) {
            status.textContent = message;
            status.classList.toggle('sample-error', error);
        }

        function stopVoice(time) {
            if (!voice) return;
            voice.source.stop(time);
            voice = null;
        }

        function renderBounds() {
            for (const { key, label } of markers) {
                timeline.style.setProperty('--sample-' + key, (clip[key] / clip.buffer.duration * 100) + '%');
                label.textContent = formatTime(clip[key]);
            }
        }

        function cancelDrag() {
            if (!drag) return;
            const { handle, pointerId } = drag;
            drag = null;
            if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
        }

        function setLocked(locked) {
            if (locked) cancelDrag();
            options.disabled = locked;
            timeline.classList.toggle('sample-locked', locked);
        }

        for (const { key, handle } of markers) {
            handle.addEventListener('pointerdown', event => {
                if (event.button !== 0 || !clip || options.disabled || drag) return;
                const rect = timeline.getBoundingClientRect();
                if (!rect.width) return;
                const offset = event.clientX - (rect.left + clip[key] / clip.buffer.duration * rect.width);
                event.preventDefault();
                handle.setPointerCapture(event.pointerId);
                drag = { key, handle, pointerId: event.pointerId, offset };
            });
        }
        document.addEventListener('pointermove', event => {
            if (drag?.pointerId !== event.pointerId) return;
            const rect = timeline.getBoundingClientRect();
            if (!rect.width) return;
            const { key, offset } = drag;
            const total = clip.buffer.duration;
            const seconds = (event.clientX - offset - rect.left) / rect.width * total;
            const gap = Math.min(0.01, total);
            const next = key === 'start'
                ? Math.max(0, Math.min(clip.end - gap, seconds))
                : Math.min(total, Math.max(clip.start + gap, seconds));
            if (next === clip[key]) return;
            clip[key] = next;
            elapsed = 0;
            renderBounds();
        });
        for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
            document.addEventListener(type, event => {
                if (drag?.pointerId === event.pointerId) cancelDrag();
            });
        }

        function play(time) {
            setLocked(true);
            if (!clip) return;
            if (!status.classList.contains('sample-error')) show('');
            const { start, end } = clip;
            const length = end - start;
            const loop = loopInput.checked;
            const position = loop ? elapsed % length : elapsed;
            if (position >= length) return;

            const source = Tone.getContext().createBufferSource();
            source.buffer = clip.buffer;
            source.loop = loop;
            source.loopStart = start;
            source.loopEnd = end;
            Tone.connect(source, Tone.Destination);
            voice = { source, time };
            source.onended = () => {
                source.disconnect();
                if (voice?.source === source) {
                    voice = null;
                    elapsed = length;
                }
            };
            if (loop) source.start(time, start + position);
            else source.start(time, start + position, length - position);
        }

        transport.on('start', play);
        transport.on('pause', (time) => {
            if (voice) elapsed += Math.max(0, time - voice.time);
            stopVoice(time);
            setLocked(!clip);
        });
        transport.on('stop', (time) => {
            stopVoice(time);
            elapsed = 0;
            setLocked(!clip);
        });

        async function load(file) {
            if (!file) return;
            const id = ++importId;
            remove.disabled = false;
            if (file.size > MAX_FILE_SIZE) {
                show('Ce fichier dépasse 20 Mio.', true);
                remove.disabled = !clip;
                return;
            }
            show('Chargement : ' + file.name);
            try {
                const buffer = await Tone.getContext().decodeAudioData(await file.arrayBuffer());
                if (id !== importId) return;
                const path = waveformPath(buffer);
                cancelDrag();
                stopVoice(Tone.immediate());
                elapsed = 0;
                clip = { buffer, start: 0, end: buffer.duration };
                name.textContent = name.title = file.name;
                peaks.setAttribute('d', path);
                duration.textContent = formatTime(buffer.duration);
                renderBounds();
                empty.hidden = true;
                timeline.hidden = false;
                const playing = transport.state === 'started';
                setLocked(playing);
                show(playing ? 'Prêt pour le prochain Play.' : '');
            } catch {
                if (id !== importId) return;
                remove.disabled = !clip;
                show('Impossible de lire ce fichier audio.' + (clip ? ' La piste actuelle est conservée.' : ''), true);
            }
        }

        document.getElementById('sample-load').addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', () => {
            load(fileInput.files[0]);
            fileInput.value = '';
        });
        track.addEventListener('dragover', (event) => {
            if (!event.dataTransfer.types.includes('Files')) return;
            event.preventDefault();
            track.classList.add('sample-dragover');
        });
        track.addEventListener('dragleave', (event) => {
            if (!track.contains(event.relatedTarget)) track.classList.remove('sample-dragover');
        });
        track.addEventListener('drop', (event) => {
            event.preventDefault();
            track.classList.remove('sample-dragover');
            load(event.dataTransfer.files[0]);
        });
        loopInput.addEventListener('input', () => { elapsed = 0; });
        remove.addEventListener('click', () => {
            ++importId;
            stopVoice(Tone.immediate());
            clip = null;
            elapsed = 0;
            setLocked(true);
            remove.disabled = true;
            name.textContent = initialName;
            name.removeAttribute('title');
            peaks.removeAttribute('d');
            timeline.hidden = true;
            empty.hidden = false;
            show('');
        });
    });
})();

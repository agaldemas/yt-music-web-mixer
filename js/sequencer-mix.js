// ============================================================
// js/sequencer-mix.js — Contrôles par piste : Volume / Mute / Solo
// - DOM : .track-mix (slider + 2 pastilles) injecté dans chaque .track-name-wrap.
// - Audio : Tone.Gain par note (TRACK_GAIN_NODES), inséré entre la
//   source (synth ou sample) et Tone.Destination. On ne touche JAMAIS
//   aux connexions source→gain (zéro coupure audio) : seul .gain.value
//   varie (ramp linéaire 20ms anti-clic).
// - Persistance : localStorage (3 clés : volume, mute, solo).
// Dépendances : window.SEQUENCER_CFG (GRID_TRACKS), Tone.
// ============================================================

// Note : pas de `const _CFG` au top-level — en mode <script> classique,
// les `const` partagent le scope global et plusieurs fichiers en
// déclareraient un → SyntaxError. On accède à window.SEQUENCER_CFG
// directement partout dans ce module.

const TRACK_GAIN_NODES = new Map(); // note → Tone.Gain
const TRACK_MIX_STATE = new Map();  // note → { volume: 0..1, muted: bool, soloed: bool }
const TRACK_MIX_DEFAULT = { volume: 1.0, muted: false, soloed: false };

function getOrCreateTrackGain(note) {
    if (typeof Tone === 'undefined') return null;
    let g = TRACK_GAIN_NODES.get(note);
    if (!g) {
        g = new Tone.Gain(1);
        g.toDestination();
        TRACK_GAIN_NODES.set(note, g);
    }
    return g;
}

function ensureTrackMixState(note) {
    if (!TRACK_MIX_STATE.has(note)) {
        TRACK_MIX_STATE.set(note, { ...TRACK_MIX_DEFAULT });
    }
    return TRACK_MIX_STATE.get(note);
}

// Calcule le gain effectif d'une piste : volume * (mute ? 0 : 1) *
// (anySolo && !thisSolo ? 0 : 1). Ramp linéaire 20ms anti-clic.
function applyTrackMix(note) {
    if (typeof Tone === 'undefined') return;
    const gain = getOrCreateTrackGain(note);
    if (!gain) return;
    const state = ensureTrackMixState(note);
    let anySolo = false;
    TRACK_MIX_STATE.forEach((s) => { if (s.soloed) anySolo = true; });
    let eff = state.volume;
    if (state.muted) eff = 0;
    if (anySolo && !state.soloed) eff = 0;
    const now = Tone.now();
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(eff, now + 0.02);
}

// Recalcule le mix de TOUTES les pistes (utilisé quand un solo change
// car il affecte les autres pistes).
function applyAllTrackMix() {
    if (typeof Tone === 'undefined') return;
    const now = Tone.now();
    TRACK_MIX_STATE.forEach((state, note) => {
        const gain = getOrCreateTrackGain(note);
        if (!gain) return;
        let anySolo = false;
        TRACK_MIX_STATE.forEach((s) => { if (s.soloed) anySolo = true; });
        let eff = state.volume;
        if (state.muted) eff = 0;
        if (anySolo && !state.soloed) eff = 0;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(eff, now + 0.02);
    });
}

// Construit le bloc .track-mix pour une piste : slider volume + pastilles
// mute/solo. Exposé en `window.buildTrackMix` pour que sequencer-grid.js
// puisse l'appeler pendant initGrid().
function buildTrackMix(track) {
    const wrap = document.createElement('div');
    wrap.className = 'track-mix';

    const vol = document.createElement('input');
    vol.type = 'range';
    vol.className = 'track-volume';
    vol.min = '0'; vol.max = '100'; vol.step = '1'; vol.value = '100';
    vol.dataset.note = track.note;
    vol.title = 'Volume de la piste (' + track.name + ')';

    const mute = document.createElement('button');
    mute.type = 'button';
    mute.className = 'track-mute';
    mute.dataset.note = track.note;
    mute.title = 'Mute (' + track.name + ')';
    mute.setAttribute('aria-label', 'Mute ' + track.name);
    mute.textContent = '\uD83D\uDD0A';

    const solo = document.createElement('button');
    solo.type = 'button';
    solo.className = 'track-solo';
    solo.dataset.note = track.note;
    solo.title = 'Solo (' + track.name + ')';
    solo.setAttribute('aria-label', 'Solo ' + track.name);
    solo.textContent = 'S';

    vol.addEventListener('input', (e) => setTrackVolume(track.note, Number(e.target.value)));
    vol.addEventListener('dblclick', () => {
        // Double-clic = reset à 100% (UX standard des DAW).
        vol.value = '100';
        setTrackVolume(track.note, 100);
    });
    mute.addEventListener('click', () => toggleMute(track.note));
    solo.addEventListener('click', () => toggleSolo(track.note));

    wrap.appendChild(vol);
    wrap.appendChild(mute);
    wrap.appendChild(solo);
    return wrap;
}

function setTrackVolume(note, percent) {
    const v = Math.max(0, Math.min(100, Number(percent) || 0));
    const state = ensureTrackMixState(note);
    state.volume = v / 100;
    applyTrackMix(note);
    saveTrackMixStates();
}

function toggleMute(note) {
    const state = ensureTrackMixState(note);
    state.muted = !state.muted;
    const btn = document.querySelector('#instrument-names .track-mute[data-note="' + note + '"]');
    if (btn) {
        btn.classList.toggle('is-muted', state.muted);
        btn.textContent = state.muted ? '\uD83D\uDD07' : '\uD83D\uDD0A';
    }
    applyTrackMix(note);
    saveTrackMixStates();
}

function toggleSolo(note) {
    const state = ensureTrackMixState(note);
    state.soloed = !state.soloed;
    const btn = document.querySelector('#instrument-names .track-solo[data-note="' + note + '"]');
    if (btn) btn.classList.toggle('is-solo', state.soloed);
    applyAllTrackMix();
    saveTrackMixStates();
}

// Persistance : 3 clés distinctes en localStorage pour ne pas se marcher
// dessus avec d'autres features (padConfig, presets) déjà sauvegardées.
function saveTrackMixStates() {
    try {
        const volumes = {};
        const muted = {};
        const soloed = {};
        TRACK_MIX_STATE.forEach((s, note) => {
            volumes[note] = s.volume;
            muted[note] = s.soloed ? null : s.muted; // null si solo (pas pertinent)
            soloed[note] = s.soloed;
        });
        localStorage.setItem('ytwm_trackVolume', JSON.stringify(volumes));
        localStorage.setItem('ytwm_trackMute', JSON.stringify(muted));
        localStorage.setItem('ytwm_trackSolo', JSON.stringify(soloed));
    } catch (e) { /* ignore quota / privacy mode */ }
}

// Restaure volume/mute/solo depuis localStorage et les applique au DOM
// (slider value + classes .is-muted/.is-solo). Les GainNodes sont créés
// au 1er play ; applyAllTrackMix() appliqué alors propage ces états.
function restoreAllTrackMixStates() {
    let volumes = {};
    let muted = {};
    let soloed = {};
    try {
        const v = localStorage.getItem('ytwm_trackVolume');
        if (v) volumes = JSON.parse(v) || {};
        const m = localStorage.getItem('ytwm_trackMute');
        if (m) muted = JSON.parse(m) || {};
        const s = localStorage.getItem('ytwm_trackSolo');
        if (s) soloed = JSON.parse(s) || {};
    } catch (e) { /* ignore parse errors */ }

    window.SEQUENCER_CFG.GRID_TRACKS.forEach((track) => {
        const note = track.note;
        const state = ensureTrackMixState(note);
        if (typeof volumes[note] === 'number') state.volume = Math.max(0, Math.min(1, volumes[note]));
        if (muted[note] === true) state.muted = true;
        if (soloed[note] === true) state.soloed = true;

        const volEl = document.querySelector('#instrument-names .track-volume[data-note="' + note + '"]');
        if (volEl) volEl.value = String(Math.round(state.volume * 100));

        const muteBtn = document.querySelector('#instrument-names .track-mute[data-note="' + note + '"]');
        if (muteBtn) {
            muteBtn.classList.toggle('is-muted', state.muted);
            muteBtn.textContent = state.muted ? '\uD83D\uDD07' : '\uD83D\uDD0A';
        }

        const soloBtn = document.querySelector('#instrument-names .track-solo[data-note="' + note + '"]');
        if (soloBtn) soloBtn.classList.toggle('is-solo', state.soloed);
    });
}

// Expose sur window pour que le module grid (initGrid) puisse appeler
// buildTrackMix avant que ce module soit complètement chargé en ordre
// "function declaration" — function declarations sont hoistées, mais
// les scripts de type classique s'exécutent dans l'ordre où ils sont
// inclus dans sequencer.html.
window.SEQUENCER_MIX = {
    getOrCreateTrackGain, applyTrackMix, applyAllTrackMix,
    setTrackVolume, toggleMute, toggleSolo,
    saveTrackMixStates, restoreAllTrackMixStates,
    buildTrackMix, // alias global pour sequencer-grid.js
};

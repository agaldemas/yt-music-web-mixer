// ============================================================
// js/sequencer-sound.js — Configuration son par pad (synth ou sample)
// + création paresseuse des Tone.Synth / Tone.Player + helpers.
// - padConfig : { mode, kit, sampleFile } par note, persisté en localStorage.
// - SYNTH_CACHE / PLAYER_CACHE : Tone.MembraneSynth (fûts) / Tone.MetalSynth
//   (cymbales) / Tone.Player (samples) créés au 1er appel.
// - Routage par piste : source → trackGains[note] (du module mix) → Destination.
// Dépendances : window.SEQUENCER_CFG, window.SEQUENCER_MIX, window.SEQUENCER_GRID.
// ============================================================

// Note : pas de `const _CFG` au top-level — en mode <script> classique,
// les `const` partagent le scope global et plusieurs fichiers en
// déclareraient un → SyntaxError. On accède à window.SEQUENCER_CFG
// directement partout dans ce module.

// Notes pilotées par le MetalSynth (cymbales) ; le reste par MembraneSynth.
const CYM_NOTE = new Set(['E1', 'F1', 'C2', 'D2']); // E1/F1 = hats, C2/D2 = crash/ride

// padConfig par note, init par défaut à 'synth', surchargeable via UI.
// La persistance (sauvegarde/restauration) est gérée par savePadConfig()
// / loadPadConfigFromStorage() — appelées au boot.
const padConfig = {};
window.SEQUENCER_CFG.GRID_TRACKS.forEach((t) => {
    padConfig[t.note] = { mode: 'synth', kit: 'acoustic', sampleFile: null };
});
loadPadConfigFromStorage();

function savePadConfig() {
    try { localStorage.setItem('ytwm_padConfig', JSON.stringify(padConfig)); } catch (e) { /* ignore */ }
}
function loadPadConfigFromStorage() {
    try {
        const raw = localStorage.getItem('ytwm_padConfig');
        if (!raw) return;
        const saved = JSON.parse(raw);
        Object.keys(saved).forEach((note) => {
            if (padConfig[note] && saved[note]) {
                padConfig[note] = { ...padConfig[note], ...saved[note] };
            }
        });
    } catch (e) { /* ignore */ }
}

function hasSampleForNote(note) {
    if (typeof DRUM_KITS === 'undefined') return false;
    return !!(DRUM_KITS.acoustic.samples[note] || DRUM_KITS.electronic.samples[note]);
}

function getSampleUrlForNote(note) {
    const cfg = padConfig[note];
    if (!cfg || cfg.mode !== 'sample' || !cfg.sampleFile) return null;
    const kit = DRUM_KITS[cfg.kit];
    if (!kit) return null;
    return kit.basePath + cfg.sampleFile;
}

// Bascule le mode d'un pad (synth ↔ sample). Met aussi à jour le bouton
// toggle dans l'en-tête de piste et pré-charge le buffer si on passe en 'sample'.
function setPadMode(note, mode) {
    const cfg = padConfig[note];
    if (!cfg) return;
    cfg.mode = mode;
    if (mode === 'sample' && !cfg.sampleFile) {
        const kit = DRUM_KITS[cfg.kit];
        if (kit && kit.samples[note]) cfg.sampleFile = kit.samples[note];
    }
    if (mode === 'sample' && cfg.sampleFile) preloadSample(note);
    const tog = window.findTrackToggle ? window.findTrackToggle(note) : null;
    if (tog) updateToggleLabel(tog, cfg);
    savePadConfig();
}

function setPadSample(note, kitName, fname) {
    if (!DRUM_KITS[kitName]) return;
    const cfg = padConfig[note];
    if (!cfg) return;
    cfg.kit = kitName;
    cfg.sampleFile = fname;
    if (cfg.mode === 'sample') preloadSample(note);
    savePadConfig();
}

// ============================================================
// UI : bouton toggle Synth/Sample + dropdown des options disponibles
// ============================================================

function updateToggleLabel(btn, cfg) {
    btn.dataset.mode = cfg.mode;
    if (cfg.mode === 'sample') {
        const fname = cfg.sampleFile ? cfg.sampleFile.replace('.wav', '') : 'sample';
        btn.textContent = '◉ ' + cfg.kit + ' / ' + fname;
        btn.classList.add('sample-on');
    } else {
        btn.textContent = '♪ Synth';
        btn.classList.remove('sample-on');
    }
}

function listSamplesForNote(note) {
    if (typeof DRUM_KITS === 'undefined') return [];
    const out = [];
    (typeof KIT_LIST !== 'undefined' ? KIT_LIST : []).forEach((kitName) => {
        const kit = DRUM_KITS[kitName];
        if (!kit || !kit.samples) return;
        const main = kit.samples[note];
        if (main) {
            out.push({ kit: kitName, filename: main, shortName: main.replace('.wav', ''), isAlternate: false });
        }
        if (kit.alternates && kit.alternates[note]) {
            const alt = kit.alternates[note];
            out.push({ kit: kitName, filename: alt, shortName: alt.replace('.wav', ''), isAlternate: true });
        }
    });
    return out;
}

function addMenuItem(menu, label, isActive, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'track-sound-menu-item' + (isActive ? ' active' : '');
    btn.textContent = label;
    btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    menu.appendChild(btn);
}

function populateSoundMenu(menu, note, onPick) {
    const cfg = padConfig[note];
    if (!cfg) return;
    addMenuItem(menu, '♪ Synth (MembraneSynth / MetalSynth)', cfg.mode === 'synth', () => {
        setPadMode(note, 'synth');
        const tog = window.findTrackToggle ? window.findTrackToggle(note) : null;
        if (tog) updateToggleLabel(tog, padConfig[note]);
        onPick();
    });
    const variants = listSamplesForNote(note);
    if (variants.length > 0) {
        const sep = document.createElement('div');
        sep.className = 'track-sound-menu-sep';
        menu.appendChild(sep);
        variants.forEach((v) => {
            const isAlt = v.isAlternate;
            const isActive = (cfg.mode === 'sample'
                && cfg.kit === v.kit && cfg.sampleFile === v.filename);
            const label = (isActive ? '✓ ' : '○ ') + v.kit + ' / ' + v.shortName + (isAlt ? ' (alt)' : '');
            addMenuItem(menu, label, isActive, () => {
                cfg.mode = 'sample';
                cfg.kit = v.kit;
                cfg.sampleFile = v.filename;
                preloadSample(note);
                savePadConfig();
                const tog = window.findTrackToggle ? window.findTrackToggle(note) : null;
                if (tog) updateToggleLabel(tog, cfg);
                onPick();
            });
        });
    }
}

function buildTrackSoundToggle(track) {
    const cfg = padConfig[track.note];
    const wrap = document.createElement('div');
    wrap.className = 'track-sound-wrap';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'track-sound-toggle';
    b.dataset.note = track.note;
    b.dataset.mode = cfg.mode;
    b.title = 'Cliquer pour choisir le son (synth ou sample)';
    updateToggleLabel(b, cfg);

    const menu = document.createElement('div');
    menu.className = 'track-sound-menu';
    menu.dataset.note = track.note;
    menu.hidden = true;

    function closeMenu() {
        menu.hidden = true;
        b.classList.remove('menu-open');
        document.removeEventListener('click', onDocClick, true);
        document.removeEventListener('keydown', onKey, true);
    }
    function onDocClick(ev) { if (!wrap.contains(ev.target)) closeMenu(); }
    function onKey(ev) { if (ev.key === 'Escape') closeMenu(); }

    b.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.track-sound-menu').forEach((m) => { m.hidden = true; });
        document.querySelectorAll('.track-sound-toggle.menu-open').forEach((tb) => { tb.classList.remove('menu-open'); });
        menu.hidden = !menu.hidden;
        b.classList.toggle('menu-open', !menu.hidden);
        menu.innerHTML = '';
        populateSoundMenu(menu, track.note, closeMenu);
        if (!menu.hidden) {
            const r = b.getBoundingClientRect();
            menu.style.position = 'fixed';
            menu.style.top = (r.bottom + 4) + 'px';
            menu.style.left = r.left + 'px';
            menu.style.minWidth = Math.max(r.width, 180) + 'px';
            setTimeout(() => {
                document.addEventListener('click', onDocClick, true);
                document.addEventListener('keydown', onKey, true);
            }, 0);
        }
    });

    populateSoundMenu(menu, track.note, closeMenu);
    wrap.appendChild(b);
    wrap.appendChild(menu);
    return wrap;
}

// ============================================================
// Pipeline audio : synths / players paresseux, routés via trackGain[note]
// ============================================================

const SYNTH_CACHE = new Map(); // note → synth Tone.js
function getSynthForNote(note) {
    if (typeof Tone === 'undefined') return null;
    if (SYNTH_CACHE.has(note)) return SYNTH_CACHE.get(note);
    let s;
    if (CYM_NOTE.has(note)) {
        s = new Tone.MetalSynth({
            harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5,
            envelope: { attack: 0.001, decay: 0.4, release: 0.2 }, volume: -10,
        });
    } else {
        s = new Tone.MembraneSynth({
            pitchDecay: 0.05, octaves: 4,
            envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 1.4 },
            volume: -6,
        });
    }
    const trackGain = window.SEQUENCER_MIX ? window.SEQUENCER_MIX.getOrCreateTrackGain(note) : null;
    if (trackGain) {
        s.connect(trackGain);
        window.SEQUENCER_MIX.applyTrackMix(note);
    } else {
        s.toDestination();
    }
    SYNTH_CACHE.set(note, s);
    return s;
}

const PLAYER_CACHE = new Map(); // note → { player, currentUrl, loadPromise }
function getPlayerForNote(note) {
    if (typeof Tone === 'undefined') return null;
    const url = getSampleUrlForNote(note);
    if (!url) return null;
    let entry = PLAYER_CACHE.get(note);
    if (!entry) {
        const player = new Tone.Player({ url: url, autostart: false });
        const trackGain = window.SEQUENCER_MIX ? window.SEQUENCER_MIX.getOrCreateTrackGain(note) : null;
        if (trackGain) {
            player.connect(trackGain);
            window.SEQUENCER_MIX.applyTrackMix(note);
        } else {
            player.toDestination();
        }
        entry = { player: player, currentUrl: url, loadPromise: Promise.resolve() };
        PLAYER_CACHE.set(note, entry);
    } else if (entry.currentUrl !== url) {
        entry.player.load(url);
        entry.currentUrl = url;
        entry.loadPromise = entry.player.loaded
            ? Promise.resolve()
            : new Promise((resolve) => { entry.player.once('load', resolve); });
    }
    return entry.player;
}

function preloadSample(note) {
    if (typeof Tone === 'undefined') return Promise.resolve();
    const url = getSampleUrlForNote(note);
    if (!url) return Promise.resolve();
    let entry = PLAYER_CACHE.get(note);
    if (!entry) {
        const player = new Tone.Player({ url: url, autostart: false });
        const trackGain = window.SEQUENCER_MIX ? window.SEQUENCER_MIX.getOrCreateTrackGain(note) : null;
        if (trackGain) {
            player.connect(trackGain);
            window.SEQUENCER_MIX.applyTrackMix(note);
        } else {
            player.toDestination();
        }
        entry = { player: player, currentUrl: url, loadPromise: player.loaded ? Promise.resolve() : null };
        PLAYER_CACHE.set(note, entry);
    } else if (entry.currentUrl !== url) {
        const p = entry.player.load(url);
        entry.currentUrl = url;
        entry.loadPromise = p;
        return p;
    }
    if (entry.loadPromise) return entry.loadPromise;
    entry.loadPromise = entry.player.loaded
        ? Promise.resolve()
        : entry.player.load(entry.currentUrl);
    return entry.loadPromise;
}

// Pré-charge TOUS les samples configurés en mode='sample' au boot.
function preloadAllSamples() {
    if (typeof Tone === 'undefined') return;
    Object.keys(padConfig).forEach((note) => {
        const cfg = padConfig[note];
        if (cfg && cfg.mode === 'sample' && cfg.sampleFile) preloadSample(note);
    });
}

// Joue un pad selon sa config (synth ou sample). Point d'entrée unique.
// `time` = timestamp Tone.js du step (Transport.scheduleRepeat), pour des
// re-triggers propres (sinon "Start time must be strictly greater than previous").
function playNoteByConfig(note, time) {
    const cfg = padConfig[note];
    if (!cfg) return;
    if (cfg.mode === 'sample') {
        const player = getPlayerForNote(note);
        if (player && player.loaded) {
            if (typeof time === 'number') player.start(time);
            else player.start();
            return;
        }
        // Fallback : on lance le pré-chargement (idempotent) et on joue le synth.
        preloadSample(note);
        const synth = getSynthForNote(note);
        if (synth) {
            if (typeof time === 'number') synth.triggerAttackRelease(note, '16n', time);
            else synth.triggerAttackRelease(note, '16n');
        }
    } else {
        const synth = getSynthForNote(note);
        if (synth) {
            if (typeof time === 'number') synth.triggerAttackRelease(note, '16n', time);
            else synth.triggerAttackRelease(note, '16n');
        }
    }
}

// Son de la cymbale Hat selon l'état mémoire. time = timestamp Tone.js.
function playHatNote(state, time) {
    const pad = window.SEQUENCER_CFG.DRUM_PADS.find((p) => p.name === 'Hat');
    if (!pad || typeof Tone === 'undefined') return;
    const note = state === 'DOWN' ? pad.note : pad.openNote;
    const cfg = padConfig[note];
    if (!cfg) return;
    if (cfg.mode === 'sample') {
        const player = getPlayerForNote(note);
        if (player && player.loaded) {
            if (typeof time === 'number') player.start(time);
            else player.start();
        }
    } else {
        const synth = getSynthForNote(note);
        if (!synth) return;
        const duration = state === 'DOWN' ? '16n' : '8n';
        if (typeof time === 'number') synth.triggerAttackRelease(note, duration, time);
        else synth.triggerAttackRelease(note, duration);
    }
}

window.SEQUENCER_SOUND = {
    padConfig, savePadConfig, loadPadConfigFromStorage,
    setPadMode, setPadSample, hasSampleForNote, getSampleUrlForNote,
    buildTrackSoundToggle, updateToggleLabel, populateSoundMenu, listSamplesForNote,
    getSynthForNote, getPlayerForNote, preloadSample, preloadAllSamples,
    playNoteByConfig, playHatNote,
    CYM_NOTE, SYNTH_CACHE, PLAYER_CACHE,
};

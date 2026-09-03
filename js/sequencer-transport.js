// ============================================================
// js/sequencer-transport.js — Transport Tone.js : Play / Stop / BPM
// - pattern[9][16] vit dans sequencer-grid.js (window.SEQUENCER_GRID.pattern).
// - rescheduleLoop() : source unique de la création/recréation du
//   scheduleRepeat. Appelée par togglePlay() (au démarrage) et par
//   setBpm() (changement de BPM). Le Transport lui-même n'est jamais
//   arrêté en live — seul le loop est recréé → pas de coupure audio.
// - onSequencerStep(time) : step courant → play des notes + playhead.
//   try/catch par piste pour qu'une erreur sur un piste ne fige pas
//   le scheduler (le playhead continue d'avancer).
// Dépendances : window.SEQUENCER_CFG (GRID_TRACKS, gridEl, isPlaying,
// currentStep), window.SEQUENCER_SOUND, window.SEQUENCER_GRID,
// window.SEQUENCER_DRUMKIT.
// ============================================================

// Note : pas de `const _CFG` au top-level — en mode <script> classique,
// les `const` partagent le scope global et plusieurs fichiers en
// déclareraient un → SyntaxError. On accède à window.SEQUENCER_CFG
// directement partout dans ce module.
const STEP_DURATION = '16n'; // 1/16e note par pas
let loopId = null; // id du callback scheduleRepeat, pour le clear

// Replanifie le scheduleRepeat. Appelé par togglePlay (au démarrage)
// et par setBpm (changement de BPM en live). Ne touche PAS au Transport.
function rescheduleLoop() {
    if (typeof Tone === 'undefined' || !window.SEQUENCER_CFG.isPlaying) return;
    if (loopId !== null) {
        Tone.Transport.clear(loopId);
        loopId = null;
    }
    loopId = Tone.Transport.scheduleRepeat((time) => {
        onSequencerStep(time);
        Tone.Draw.schedule(() => { /* hook visuel facultatif */ }, time);
    }, STEP_DURATION);
}

// Source unique pour changer le BPM. Met à jour input + affichage +
// Transport + replanifie le loop. Tous les chemins (slider, presets,
// togglePlay) passent par ici.
function setBpm(newBpm) {
    const v = Math.max(40, Math.min(240, Number(newBpm) || 120));
    const bpmInput = document.getElementById('bpm');
    const bpmValue = document.getElementById('bpm-value');
    if (bpmInput) bpmInput.value = String(v);
    if (bpmValue) bpmValue.textContent = String(v);
    if (typeof Tone !== 'undefined' && Tone.Transport && Tone.Transport.bpm) {
        Tone.Transport.bpm.value = v;
    }
    rescheduleLoop();
}

// À chaque pas du séquenceur : déclenche les notes des pas actifs,
// anime le playhead visuel, avance le compteur. try/catch par piste
// pour que le scheduler ne se fige pas si une piste lève.
function onSequencerStep(stepTime) {
    const p = window.SEQUENCER_GRID ? window.SEQUENCER_GRID.pattern : null;
    if (!p) return;
    window.SEQUENCER_CFG.GRID_TRACKS.forEach((track, ti) => {
        if (p[ti] && p[ti][window.SEQUENCER_CFG.currentStep]) {
            try {
                triggerGridNote(track, stepTime);
            } catch (err) {
                console.warn('sequencer: track', track.name, 'trigger failed:', err.message);
            }
        }
    });
    if (window.SEQUENCER_CFG.gridEl) {
        const prev = window.SEQUENCER_CFG.gridEl.querySelectorAll('.step.playing');
        prev.forEach((el) => el.classList.remove('playing'));
        const cells = window.SEQUENCER_CFG.gridEl.querySelectorAll('.step');
        cells.forEach((cell) => {
            if (Number(cell.dataset.step) === window.SEQUENCER_CFG.currentStep) cell.classList.add('playing');
        });
    }
    window.SEQUENCER_CFG.currentStep = (window.SEQUENCER_CFG.currentStep + 1) % (window.SEQUENCER_GRID ? window.SEQUENCER_GRID.STEPS_PER_LOOP : 16);
}

// Joue la note d'une piste de la grille. Hat (E1/F1) passe par
// playHatNote pour respecter l'état de la pédale charleston.
function triggerGridNote(track, stepTime) {
    if (typeof Tone === 'undefined') return;
    if (track.note === 'E1' || track.note === 'F1') {
        const state = (window.SEQUENCER_DRUMKIT && window.SEQUENCER_DRUMKIT.hatPedalState) || 'UP';
        if (window.SEQUENCER_SOUND) {
            window.SEQUENCER_SOUND.playHatNote(state === 'DOWN' ? 'DOWN' : (track.note === 'F1' ? 'UP' : 'DOWN'), stepTime);
        }
        return;
    }
    if (window.SEQUENCER_SOUND) {
        window.SEQUENCER_SOUND.playNoteByConfig(track.note, stepTime);
    }
}

async function togglePlay() {
    if (typeof Tone === 'undefined') return;
    const playBtn = document.getElementById('play-pause');
    if (!window.SEQUENCER_CFG.isPlaying) {
        await Tone.start();
        setBpm(Number(document.getElementById('bpm')?.value) || 120);
        Tone.Transport.start();
        window.SEQUENCER_CFG.isPlaying = true;
        rescheduleLoop();
        if (playBtn) playBtn.textContent = 'Pause';
    } else {
        Tone.Transport.pause();
        window.SEQUENCER_CFG.isPlaying = false;
        if (playBtn) playBtn.textContent = 'Play';
    }
}

function stopSequencer() {
    if (typeof Tone === 'undefined') return;
    Tone.Transport.stop();
    if (loopId !== null) {
        Tone.Transport.clear(loopId);
        loopId = null;
    }
    window.SEQUENCER_CFG.currentStep = 0;
    window.SEQUENCER_CFG.isPlaying = false;
    const playBtn = document.getElementById('play-pause');
    if (playBtn) playBtn.textContent = 'Play';
    if (window.SEQUENCER_CFG.gridEl) {
        window.SEQUENCER_CFG.gridEl.querySelectorAll('.step.playing').forEach((el) => el.classList.remove('playing'));
    }
}

window.SEQUENCER_TRANSPORT = {
    setBpm, rescheduleLoop, onSequencerStep, triggerGridNote,
    togglePlay, stopSequencer,
    STEP_DURATION,
    get loopId() { return loopId; },
    set loopId(v) { loopId = v; },
};

// ============================================================
// js/sequencer-app.js — Bootstrap / orchestrateur du Séquenceur
// - Importe les sous-modules (chargés en <script> AVANT celui-ci dans
//   sequencer.html) et les expose sur window.* si besoin.
// - Au DOMContentLoaded : appelle les init() de chaque module + câble
//   les boutons simples (Play, Stop, Clear, Randomize, BPM, master vol).
//
// ATTENTION : NE PAS redéclarer ici les constantes (GRID_TRACKS,
// DRUM_PADS, gridEl, drumKitEl) ni l'état (isPlaying, currentStep).
// Elles vivent dans sequencer-config.js et sont lues via
// window.SEQUENCER_CFG.* — toute redéclaration top-level ici
// provoquerait un SyntaxError "Identifier has already been declared"
// car tous ces scripts partagent le scope global en mode <script>
// classique.
//
// Sous-modules (chargés en amont) :
//   - js/sequencer-config.js   → window.SEQUENCER_CFG (GRID_TRACKS,
//                                  DRUM_PADS, gridEl, drumKitEl,
//                                  isPlaying, currentStep)
//   - js/sequencer-grid.js     → initGrid, clearGrid, randomizeGrid
//   - js/sequencer-mix.js      → buildTrackMix + Vol/Mute/Solo
//   - js/sequencer-sound.js    → padConfig, synth/player/playNoteByConfig
//   - js/sequencer-drumkit.js  → initDrumKit, triggerPadDown/Up
//   - js/sequencer-presets.js  → loadMusiccaPreset, loadFactoryPreset
//   - js/sequencer-transport.js→ setBpm, togglePlay, stopSequencer
// ============================================================

// ============================================================
// Alias globaux pour les modules enfants (lisibles en mode script
// classique, pas de modules ES6 — séquentiel garanti par l'ordre
// d'inclusion des <script> dans sequencer.html).
// ============================================================
const _G = window.SEQUENCER_GRID || {};
const _M = window.SEQUENCER_MIX || {};
const _S = window.SEQUENCER_SOUND || {};
const _D = window.SEQUENCER_DRUMKIT || {};
const _P = window.SEQUENCER_PRESETS || {};
const _T = window.SEQUENCER_TRANSPORT || {};
const _CFG = window.SEQUENCER_CFG || {};

// ============================================================
// --- Démarrage de l'application ---
window.addEventListener('DOMContentLoaded', () => {
    if (_G.initGrid) _G.initGrid();
    if (_M.restoreAllTrackMixStates) _M.restoreAllTrackMixStates();
    if (_D.initDrumKit) _D.initDrumKit();
    if (_P.initRythmesMenu) _P.initRythmesMenu();
    if (_P.initFactoryPresetsMenu) _P.initFactoryPresetsMenu();

    // --- Restauration des presets sauvegardés ---
    const savedPreset = _P.loadActivePresetName ? _P.loadActivePresetName() : '';
    if (savedPreset && _P.loadMusiccaPreset) _P.loadMusiccaPreset(savedPreset);

    const savedFactory = _P.loadActiveFactoryPresetId ? _P.loadActiveFactoryPresetId() : '';
    if (savedFactory && _P.loadFactoryPreset) _P.loadFactoryPreset(savedFactory);

    // --- Pré-chargement des samples configurés en mode='sample' ---
    if (_S.preloadAllSamples) _S.preloadAllSamples();

    // --- Câblage des boutons simples ---
    if (_CFG.gridEl) {
        _CFG.gridEl.addEventListener('click', (e) => {
            const cell = e.target.closest('.step');
            if (!cell) return;
            // Le toggle est fait par le onclick inline (ajoute .active).
            // On re-sync le pattern juste après.
            if (_G.syncPatternFromDOM) requestAnimationFrame(_G.syncPatternFromDOM);
        });
    }

    const playBtn = document.getElementById('play-pause');
    const stopBtn = document.getElementById('stop');
    if (playBtn && _T.togglePlay) playBtn.addEventListener('click', _T.togglePlay);
    if (stopBtn && _T.stopSequencer) stopBtn.addEventListener('click', _T.stopSequencer);

    const clearBtn = document.getElementById('clear-grid');
    if (clearBtn && _G.clearGrid) clearBtn.addEventListener('click', _G.clearGrid);

    const randomizeBtn = document.getElementById('randomize');
    if (randomizeBtn && _G.randomizeGrid) randomizeBtn.addEventListener('click', _G.randomizeGrid);

    // BPM + volume master
    const bpmInput = document.getElementById('bpm');
    const bpmValue = document.getElementById('bpm-value');
    if (bpmInput) {
        if (bpmValue) bpmValue.textContent = String(bpmInput.value);
        if (_T.setBpm) bpmInput.addEventListener('input', () => _T.setBpm(Number(bpmInput.value)));
    }

    const volInput = document.getElementById('master-volume');
    const volValue = document.getElementById('vol-value');
    if (volInput && typeof Tone !== 'undefined'
        && Tone.Destination && Tone.Destination.volume) {
        const applyMasterVolume = () => {
            const v = Number(volInput.value);
            Tone.Destination.volume.value = Tone.gainToDb(v / 100);
            if (volValue) volValue.textContent = v + '%';
        };
        applyMasterVolume();
        volInput.addEventListener('input', applyMasterVolume);
    }
});

// Expose quelques helpers sur window pour debug / tests.
// IMPORTANT : on lit via window.SEQUENCER_CFG.* plutôt que de stocker
// des références locales — c'est la source de vérité unique.
Object.defineProperty(window, 'SEQUENCER', {
    get() { return window.SEQUENCER_CFG; },
});

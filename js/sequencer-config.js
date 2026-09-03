// ============================================================
// js/sequencer-config.js — Constantes globales du séquenceur
// Chargé EN PREMIER (avant tous les sous-modules) pour que
// GRID_TRACKS / DRUM_PADS / gridEl / drumKitEl / isPlaying /
// currentStep soient disponibles avant l'exécution des autres scripts.
//
// Les sous-modules lisent via `window.SEQUENCER_CFG.*` au lieu de
// `const` top-level, ce qui évite les erreurs TDZ lors du chargement.
// ============================================================

// --- Pistes du séquenceur (matrice 9 × 16) ---
const GRID_TRACKS = [
    { name: 'Kick',       note: 'C1' },
    { name: 'Snare',      note: 'D1' },
    { name: 'Hat Closed', note: 'E1' },
    { name: 'Hat Open',   note: 'F1' },
    { name: 'Tom High',   note: 'G1' },
    { name: 'Tom Mid',    note: 'A1' },
    { name: 'Tom Low',    note: 'B1' },
    { name: 'Crash',      note: 'C2' },
    { name: 'Ride',       note: 'D2' }
];

// --- Pads de la batterie vue du dessus (8) ---
// keyBadge : raccourci clavier affiché sur le pad.
// className : classe CSS de positionnement sur le stage.
// openNote (hat uniquement) : note jouée au relâchement (charleston ouvert).
const DRUM_PADS = [
    { name: 'Kick',     note: 'C1', type: 'drum',   className: 'pad-kick',      keyBadge: 'B / Space' },
    { name: 'Snare',    note: 'D1', type: 'drum',   className: 'pad-snare',     keyBadge: 'S' },
    { name: 'Hat',      note: 'E1', openNote: 'F1', type: 'hat', className: 'cymbal-hat', keyBadge: 'H' },
    { name: 'Tom High', note: 'G1', type: 'drum',   className: 'pad-tom-high',  keyBadge: 'T' },
    { name: 'Tom Mid',  note: 'A1', type: 'drum',   className: 'pad-tom-mid',   keyBadge: 'Y' },
    { name: 'Tom Low',  note: 'B1', type: 'drum',   className: 'pad-tom-low',   keyBadge: 'G' },
    { name: 'Crash',    note: 'C2', type: 'cymbal', className: 'cymbal-crash',  keyBadge: 'C' },
    { name: 'Ride',     note: 'D2', type: 'cymbal', className: 'cymbal-ride',   keyBadge: 'R' }
];

// --- Références DOM (résolues au boot) ---
const gridEl = document.getElementById('step-matrix');
const drumKitEl = document.getElementById('drum-kit-view');

// --- État global du séquenceur ---
let isPlaying = false;
let currentStep = 0;

// Expose tout en window pour que les sous-modules (chargés après)
// puissent y accéder sans TDZ. Les sous-modules utilisent
// `window.SEQUENCER_CFG.GRID_TRACKS` etc.
window.SEQUENCER_CFG = {
    GRID_TRACKS,
    DRUM_PADS,
    gridEl,
    drumKitEl,
    get isPlaying() { return isPlaying; },
    set isPlaying(v) { isPlaying = v; },
    get currentStep() { return currentStep; },
    set currentStep(v) { currentStep = v; },
};

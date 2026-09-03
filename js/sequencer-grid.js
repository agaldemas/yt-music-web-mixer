// ============================================================
// js/sequencer-grid.js — Matrice 9 pistes × 16 pas
// Rendu du DOM (initGrid), toggle des pas (syncPatternFromDOM),
// outils de modification en masse (clearGrid, randomizeGrid,
// applyGridToDOM — partagé avec les modules de presets).
// Dépendances : window.SEQUENCER_CFG (constantes globales).
// ============================================================

const STEPS_PER_LOOP = 16;
const pattern = window.SEQUENCER_CFG.GRID_TRACKS.map(() => new Array(STEPS_PER_LOOP).fill(false));

// Sync pattern[] quand l'utilisateur toggle un .step dans la grille.
// On lit chaque .step-row du #step-matrix (et non .track-row qui n'existe pas).
function syncPatternFromDOM() {
    if (!window.SEQUENCER_CFG.gridEl) return;
    const rows = window.SEQUENCER_CFG.gridEl.querySelectorAll('.step-row');
    rows.forEach((row, ti) => {
        const steps = row.querySelectorAll('.step');
        steps.forEach((cell, si) => {
            if (ti < pattern.length && si < pattern[ti].length) {
                pattern[ti][si] = cell.classList.contains('active');
            }
        });
    });
}

// Helper : retrouve le bouton toggle d'une piste. Il vit dans
// #instrument-names (colonne de gauche), PAS dans #step-matrix (gridEl).
// Défini ici pour rester proche de l'endroit où il est utilisé (initGrid),
// même s'il appartient fonctionnellement au module son.
function findTrackToggle(note) {
    return document.querySelector(
        '#instrument-names .track-sound-toggle[data-note="' + note + '"]'
    );
}

// Initialise la grille de pas (9 × 16) + la colonne de gauche (noms
// + toggles son + mini-panneau mix Volume/Mute/Solo). Chaque ligne a
// la même hauteur (variables CSS partagées : --seq-row-height).
function initGrid() {
    const namesCol = document.getElementById('instrument-names');
    const stepsCol = document.getElementById('step-matrix');
    if (!namesCol || !stepsCol) return;
    const STEPS = 16;
    window.SEQUENCER_CFG.GRID_TRACKS.forEach((track) => {
        // Toggle compact (1 bouton qui switch). Visible seulement si un sample existe.
        // Le toggle vit dans la colonne de gauche (.instrument-col) via nameWrap,
        // PAS dans gridEl (#step-matrix) — d'où le helper findTrackToggle().
        const nameWrap = document.createElement('div');
        nameWrap.className = 'track-name-wrap';

        // Mini-panneau Volume / Mute / Solo EN PREMIER, aligné à gauche.
        // Vient avant le nom et le bouton son pour que les contrôles de mix
        // soient groupés à gauche (plus joli, plus DAW-like), et que ni le
        // nom ni la largeur du sample n'écrasent ou coupent les pastilles.
        const mix = window.SEQUENCER_MIX && window.SEQUENCER_MIX.buildTrackMix
            ? window.SEQUENCER_MIX.buildTrackMix(track)
            : null;
        if (mix) nameWrap.appendChild(mix);

        const name = document.createElement('span');
        name.className = 'track-name';
        name.textContent = track.name;
        nameWrap.appendChild(name);

        // Toggle son en DERNIER : prend l'espace restant à droite, peu
        // importe sa largeur (le nom du sample le détermine).
        if (typeof window.SEQUENCER_SOUND !== 'undefined'
            && window.SEQUENCER_SOUND.hasSampleForNote
            && window.SEQUENCER_SOUND.hasSampleForNote(track.note)
            && window.SEQUENCER_SOUND.buildTrackSoundToggle) {
            const tog = window.SEQUENCER_SOUND.buildTrackSoundToggle(track);
            nameWrap.appendChild(tog);
        }

        namesCol.appendChild(nameWrap);

        // Colonne droite : 1 ligne de 16 steps.
        const stepRow = document.createElement('div');
        stepRow.className = 'step-row';
        stepRow.dataset.note = track.note;
        for (let i = 0; i < STEPS; i++) {
            const step = document.createElement('div');
            step.className = 'step';
            step.dataset.drum = track.note;
            step.dataset.step = i;
            step.onclick = () => step.classList.toggle('active');
            stepRow.appendChild(step);
        }
        stepsCol.appendChild(stepRow);
    });
}

// Applique un pattern 2D (bool[9][16]) au DOM + à pattern[].
// Utilisé par les modules de presets (Musicca, Factory).
function applyGridToDOM(grid) {
    if (!window.SEQUENCER_CFG.gridEl) return;
    const rows = window.SEQUENCER_CFG.gridEl.querySelectorAll('.step-row');
    rows.forEach((row, ti) => {
        const steps = row.querySelectorAll('.step');
        steps.forEach((cell, si) => {
            const on = !!(grid[ti] && grid[ti][si]);
            cell.classList.toggle('active', on);
            if (ti < pattern.length && si < pattern[ti].length) pattern[ti][si] = on;
        });
    });
}

// Efface toute la grille (9 pistes × 16 pas) : retire .active de chaque .step
// puis re-sync pattern[][] via syncPatternFromDOM (toutes les cases → false).
// Fonctionne que le séquenceur soit en lecture ou en pause : on ne touche
// ni au Transport, ni au playhead, ni aux samples — juste à l'état utilisateur.
function clearGrid() {
    if (!window.SEQUENCER_CFG.gridEl) return;
    window.SEQUENCER_CFG.gridEl.querySelectorAll('.step.active').forEach((cell) => cell.classList.remove('active'));
    syncPatternFromDOM();
}

// PRNG seedé mulberry32 — petit, rapide, bonne distribution pour ce besoin.
// Déterministe : avec le MÊME seed on a TOUJOURS la même séquence.
// Référence : https://gist.github.com/tommyettinger/46a3b7e6f9b34a35d2b6e (mulberry32).
function makeRng(seed) {
    let s = seed >>> 0; // force uint32
    return function rand() {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function pickFromSet(rng, set) {
    const arr = Array.from(set);
    return arr[Math.floor(rng() * arr.length)];
}

// Génère un pattern musicalement sensé (pas du bruit blanc uniforme) et
// l'applique à la grille DOM + au tableau pattern[][]. DÉTERMINISTE : la
// seed est FIXE (même clic = même résultat).
//
// Règles musicales (drum kit classique, groove rock/funk léger) :
//   - Kick      : 4 hits / 16 — un par temps (pas 0, 4, 8, 12).
//   - Snare     : 2 hits / 16 — backbeat (pas 4 et 12).
//   - Hat Closed: ~50% des pas pairs (0, 2, 4, 6, 8, 10, 12, 14), choix seeded.
//   - Hat Open  : 1 hit rare sur {6, 10, 14}.
//   - Tom High  : 0 ou 1 hit sur un pas IMPAIR tiré parmi {1, 3, 5, 7, 9, 11, 13, 15}.
//   - Tom Mid   : 0 ou 1 hit sur un pas impair tiré parmi {3, 7, 11, 15}.
//   - Tom Low   : 0 ou 1 hit sur un pas impair tiré parmi {5, 9, 13}.
//   - Crash     : 0 ou 1 hit, sur le pas 0 (downbeat) si actif.
//   - Ride      : pattern 8e (pas pairs sur les 8 premiers, OU les 8 derniers).
function randomizeGrid() {
    if (!window.SEQUENCER_CFG.gridEl) return;
    const SEED = 0xC0FFEE;
    const rng = makeRng(SEED);

    function buildTrackSteps(trackIndex) {
        const out = new Set();
        switch (trackIndex) {
            case 0: [0, 4, 8, 12].forEach((s) => out.add(s)); break;          // Kick
            case 1: [4, 12].forEach((s) => out.add(s)); break;                 // Snare
            case 2:                                                                // Hat Closed
                [0, 2, 4, 6, 8, 10, 12, 14].forEach((s) => { if (rng() < 0.5) out.add(s); });
                break;
            case 3: out.add(pickFromSet(rng, new Set([6, 10, 14]))); break;     // Hat Open
            case 4:                                                                // Tom High
                if (rng() < 0.5) out.add(pickFromSet(rng, new Set([1, 3, 5, 7, 9, 11, 13, 15])));
                break;
            case 5:                                                                // Tom Mid
                if (rng() < 0.5) out.add(pickFromSet(rng, new Set([3, 7, 11, 15])));
                break;
            case 6:                                                                // Tom Low
                if (rng() < 0.4) out.add(pickFromSet(rng, new Set([5, 9, 13])));
                break;
            case 7: if (rng() < 0.5) out.add(0); break;                            // Crash
            case 8:                                                                // Ride
                if (rng() < 0.5) {
                    [0, 2, 4, 6, 8, 10, 12, 14].forEach((s) => out.add(s));
                } else {
                    [1, 3, 5, 7, 9, 11, 13, 15].forEach((s) => out.add(s));
                }
                break;
            default: break;
        }
        return out;
    }

    const newGrid = [];
    window.SEQUENCER_CFG.GRID_TRACKS.forEach((_track, ti) => {
        const steps = buildTrackSteps(ti);
        const row = new Array(STEPS_PER_LOOP).fill(false);
        steps.forEach((s) => { if (s >= 0 && s < STEPS_PER_LOOP) row[s] = true; });
        newGrid.push(row);
    });

    const rows = window.SEQUENCER_CFG.gridEl.querySelectorAll('.step-row');
    rows.forEach((row, ti) => {
        const cells = row.querySelectorAll('.step');
        cells.forEach((cell, si) => {
            const want = !!(newGrid[ti] && newGrid[ti][si]);
            cell.classList.toggle('active', want);
            if (ti < pattern.length && si < pattern[ti].length) pattern[ti][si] = want;
        });
    });

    syncPatternFromDOM();
}

// Expose en window pour pour les autres modules (et les tests).
window.SEQUENCER_GRID = {
    initGrid, syncPatternFromDOM, applyGridToDOM, clearGrid, randomizeGrid,
    findTrackToggle, pattern, STEPS_PER_LOOP,
};

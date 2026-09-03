// ============================================================
// js/factory-presets.js — Presets d'usine « 🎵 Presets »
// 5 styles codés en dur (Rock 4/4, House/Electro, Trap/Hip-hop,
// Funk/Disco, Reggae/Dub). 0 dépendance serveur, statique.
// Inclure AVANT js/sequencer-app.js (charge pattern[][] + DOM).
// ============================================================
//
// Format interne : pattern[trackIndex][stepIndex] = boolean
// Ordre des pistes (GRID_TRACKS, 9 pistes) :
//   0 Kick        3 Hat Open    6 Tom Low
//   1 Snare       4 Tom High    7 Crash
//   2 Hat Closed  5 Tom Mid     8 Ride
// 16 pas par mesure, 16e note.
// ============================================================

// Helper : crée une grille 9×16 vide, active les pas listés.
function _mkGrid(activeByTrack) {
  const grid = [];
  for (let t = 0; t < 9; t++) {
    const row = new Array(16).fill(false);
    const steps = activeByTrack[t] || [];
    steps.forEach((s) => { if (s >= 0 && s < 16) row[s] = true; });
    grid.push(row);
  }
  return grid;
}

// ────────────────────────────────────────────────────────────
// 1. 🥁 Rock 4/4 — 110 BPM
// Kick 4-on-the-floor (0,4,8,12), snare backbeat (4,12),
// hat closed 8e continue, ride sur 0,4,8,12.
// ────────────────────────────────────────────────────────────
const ROCK_4_4 = {
  id: 'rock-4-4',
  name_fr: '🥁 Rock 4/4',
  tempo: 110,
  swing: false,
  pattern: _mkGrid({
    0: [0, 4, 8, 12],       // Kick — 4-on-the-floor
    1: [4, 12],             // Snare — backbeat 2 & 4
    2: [0, 2, 4, 6, 8, 10, 12, 14], // Hat Closed — 8e continue
    3: [14],                // Hat Open — léger accent fin de mesure
    4: [],                  // Tom High
    5: [],                  // Tom Mid
    6: [],                  // Tom Low
    7: [0],                 // Crash — downbeat
    8: [0, 4, 8, 12],       // Ride — appuis temps (mix possible avec Hat)
  }),
};

// ────────────────────────────────────────────────────────────
// 2. 🏠 House / Electro — 124 BPM
// Kick 4-on-the-floor (0,4,8,12), snare/clap sur 4,12,
// hat offbeat (2,6,10,14), open hat sur 6.
// ────────────────────────────────────────────────────────────
const HOUSE_ELECTRO = {
  id: 'house-electro',
  name_fr: '🏠 House / Electro',
  tempo: 124,
  swing: false,
  pattern: _mkGrid({
    0: [0, 4, 8, 12],       // Kick — 4-on-the-floor
    1: [4, 12],             // Snare — backbeat 2 & 4 (clap)
    2: [2, 6, 10, 14],      // Hat Closed — offbeats
    3: [6],                 // Hat Open — accent offbeat 2
    4: [],                  // Tom High
    5: [],                  // Tom Mid
    6: [],                  // Tom Low
    7: [0],                 // Crash — downbeat
    8: [],                  // Ride (silencieux en electro)
  }),
};

// ────────────────────────────────────────────────────────────
// 3. 🎤 Trap / Hip-hop — 140 BPM
// Kick syncopé (0, 3, 7, 11), snare backbeat (4, 12),
// hat triolets approximés (0, 3, 5, 7, 10, 13), 808 sur 6 (Tom Low).
// ────────────────────────────────────────────────────────────
const TRAP_HIPHOP = {
  id: 'trap-hiphop',
  name_fr: '🎤 Trap / Hip-hop',
  tempo: 140,
  swing: false,
  pattern: _mkGrid({
    0: [0, 3, 7, 11],       // Kick — syncopé
    1: [4, 12],             // Snare — backbeat 2 & 4
    2: [0, 3, 5, 7, 10, 13],// Hat Closed — triolets/rolls
    3: [10],                // Hat Open — accent
    4: [],                  // Tom High
    5: [],                  // Tom Mid
    6: [6],                 // Tom Low — 808 sub-bass accent
    7: [0],                 // Crash — downbeat
    8: [],                  // Ride
  }),
};

// ────────────────────────────────────────────────────────────
// 4. 🪩 Funk / Disco — 118 BPM
// Kick (0, 7, 10), snare (4, 12), hat 16e (0,2,4,6,8,10,12,14),
// open hat sur 14, tom high accent groove.
// ────────────────────────────────────────────────────────────
const FUNK_DISCO = {
  id: 'funk-disco',
  name_fr: '🪩 Funk / Disco',
  tempo: 118,
  swing: false,
  pattern: _mkGrid({
    0: [0, 7, 10],          // Kick — syncopé funky
    1: [4, 12],             // Snare — backbeat
    2: [0, 2, 4, 6, 8, 10, 12, 14], // Hat Closed — 16e continue
    3: [14],                // Hat Open — fin de mesure
    4: [7, 11],             // Tom High — ghost groove
    5: [],                  // Tom Mid
    6: [],                  // Tom Low
    7: [0],                 // Crash — downbeat
    8: [],                  // Ride
  }),
};

// ────────────────────────────────────────────────────────────
// 5. 🇯🇲 Reggae / Dub — 72 BPM — OBLIGATOIRE
// ONE-DROP : kick sur 0 et 8 uniquement (3e temps, pas 1 ni 3).
// CROSS-STICK : snare (rimshot) sur 12 (3e temps, après le kick).
// SKANK : charleston fermé sur les offbeats 2, 6, 10, 14,
//         accentué par Tom High sur 3 et 11 (skank guitare).
// ────────────────────────────────────────────────────────────
const REGGAE_DUB = {
  id: 'reggae-dub',
  name_fr: '🇯🇲 Reggae / Dub',
  tempo: 72,
  swing: false,
  pattern: _mkGrid({
    0: [0, 8],              // Kick — ONE-DROP (3e temps)
    1: [12],                // Snare — CROSS-STICK (3e temps)
    2: [2, 6, 10, 14],      // Hat Closed — offbeats (skank)
    3: [],                  // Hat Open
    4: [3, 11],             // Tom High — skank guitare (et 3e 8e)
    5: [],                  // Tom Mid
    6: [],                  // Tom Low — 808 sub (silencieux en dub sec)
    7: [],                  // Crash (silencieux)
    8: [],                  // Ride (silencieux)
  }),
};

// ============================================================
// Export : tableau global consommé par js/sequencer-app.js
// ============================================================
window.FACTORY_PRESETS = [
  ROCK_4_4,
  HOUSE_ELECTRO,
  TRAP_HIPHOP,
  FUNK_DISCO,
  REGGAE_DUB,
];

// Helper : retrouve un preset par id.
function findFactoryPreset(id) {
  return window.FACTORY_PRESETS.find((p) => p.id === id) || null;
}
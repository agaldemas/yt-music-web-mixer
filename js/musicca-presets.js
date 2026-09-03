// ============================================================
// js/musicca-presets.js — Presets « Rythmes » extraits de
// https://www.musicca.com/fr/boite-a-rythmes (2026-09-03)
// Source JS : /scripts/drum-machine/drum-machine.min.js (43k)
// 20 patterns, 7 pistes danoises → 9 pistes GRID_TRACKS
// Statique, 0 dépendance serveur. Inclure AVANT sequencer-app.js.
// ============================================================

// Noms FR = DRUM_MACHINE_TRANSLATION.buttonNames.presets[1..20]
// Rap → Hip-hop (FR)
const MUSICA_PRESETS = [
  { id: 'Pop/rock 1', name_fr: 'Pop rock 1', tempo: 90, swing: false, rhythm: '4/4', sequence: { hihatfod: '0000000000000000', sidetamlys: '0000000000000000', gulvtam: '0000000000000000', ride: '0000000000000000', hihat: '1010101010101010', lilletromme: '0000100000001000', stortromme: '1000000010000000' } },
  { id: 'Pop/rock 2', name_fr: 'Pop rock 2', tempo: 90, swing: false, rhythm: '4/4', sequence: { hihatfod: '0000000000000000', sidetamlys: '0000000000000000', gulvtam: '0000000000000000', ride: '0000000000000000', hihat: '1010101010101010', lilletromme: '0000100000001000', stortromme: '1000000010100000' } },
  { id: 'Pop/rock 3', name_fr: 'Pop rock 3', tempo: 90, swing: false, rhythm: '4/4', sequence: { hihatfod: '0000000000000000', sidetamlys: '0000000000000000', gulvtam: '0000000000000000', ride: '0000000000000000', hihat: '1010101010101010', lilletromme: '0000100000001000', stortromme: '1000001010000000' } },
  { id: 'Pop/rock 4', name_fr: 'Pop rock 4', tempo: 90, swing: false, rhythm: '4/4', sequence: { hihatfod: '0000000000000000', sidetamlys: '0000000000000000', gulvtam: '0000000000000000', ride: '0000000000000000', hihat: '1010101010101010', lilletromme: '0000100000001000', stortromme: '1000001000100000' } },
  { id: 'Pop/rock 5', name_fr: 'Pop rock 5', tempo: 90, swing: false, rhythm: '4/4', sequence: { hihatfod: '0000000000000000', sidetamlys: '0000000000000000', gulvtam: '0000000000000000', ride: '0000000000000000', hihat: '1010101010101010', lilletromme: '0000100000001000', stortromme: '1000000100100000' } },
  { id: 'Pop/rock 6', name_fr: 'Pop rock 6', tempo: 90, swing: false, rhythm: '4/4', sequence: { hihatfod: '0000000000000000', sidetamlys: '0000000000000000', gulvtam: '0000000000000000', ride: '0000000000000000', hihat: '1010101010101010', lilletromme: '0000100000001000', stortromme: '0010000010000000' } },
  { id: 'Pop/rock i 3/4', name_fr: 'Pop rock à 3/4', tempo: 110, swing: false, rhythm: '3/4', sequence: { hihatfod: '000000000000', sidetamlys: '000000000000', gulvtam: '000000000000', ride: '000000000000', hihat: '101010101010', lilletromme: '000000001000', stortromme: '100000100000' } },
  { id: 'Pop/rock i 6/8', name_fr: 'Pop rock à 6/8', tempo: 90, swing: false, rhythm: '6/8', sequence: { hihatfod: '000000000000', sidetamlys: '000000000000', gulvtam: '000000000000', ride: '000000000000', hihat: '101010101010', lilletromme: '000000100000', stortromme: '100000000000' } },
  { id: 'Jazz 1', name_fr: 'Jazz 1', tempo: 110, swing: true, rhythm: '4/4', sequence: { hihatfod: '0000100000001000', sidetamlys: '0000000000000000', gulvtam: '0000000000000000', ride: '1000101010001010', hihat: '0000000000000000', lilletromme: '0000000000000000', stortromme: '0000000000000000' } },
  { id: 'Jazz 2', name_fr: 'Jazz 2', tempo: 110, swing: true, rhythm: '4/4', sequence: { hihatfod: '0000100000001000', sidetamlys: '0000000000000000', gulvtam: '0000000000000000', ride: '1000101010001010', hihat: '0000000000000000', lilletromme: '0000000000001000', stortromme: '1000000000000000' } },
  { id: 'Jazz 3', name_fr: 'Jazz 3', tempo: 110, swing: true, rhythm: '4/4', sequence: { hihatfod: '0000100000001000', sidetamlys: '0000000000000000', gulvtam: '0000000000000000', ride: '1000101010001010', hihat: '0000000000000000', lilletromme: '0000000000100000', stortromme: '0000001000000000' } },
  { id: 'Jazz 4', name_fr: 'Jazz 4', tempo: 110, swing: true, rhythm: '4/4', sequence: { hihatfod: '0000100000001000', sidetamlys: '0000000000000000', gulvtam: '0000000000000000', ride: '1010101010101010', hihat: '0000000000000000', lilletromme: '0020000000002000', stortromme: '1000000010000000' } },
  { id: 'Funk 1', name_fr: 'Funk 1', tempo: 110, swing: false, rhythm: '4/4', sequence: { hihatfod: '0000000000000000', sidetamlys: '0000000000000000', gulvtam: '0000000000000000', ride: '0000000000000000', hihat: '1010101010101010', lilletromme: '0000100101001100', stortromme: '1000000000100001' } },
  { id: 'Funk 2', name_fr: 'Funk 2', tempo: 90, swing: false, rhythm: '4/4', sequence: { hihatfod: '0000000000000000', sidetamlys: '0000000000000000', gulvtam: '0000000000000000', ride: '0000000000000000', hihat: '1111112111111121', lilletromme: '0000100101011000', stortromme: '1010000010100100' } },
  { id: 'Disco 1', name_fr: 'Disco 1', tempo: 90, swing: false, rhythm: '4/4', sequence: { hihatfod: '0000000000000000', sidetamlys: '0000000000000000', gulvtam: '0000000000000000', ride: '0000000000000000', hihat: '1020102010201020', lilletromme: '0000100000001000', stortromme: '1000100010001000' } },
  { id: 'Disco 2', name_fr: 'Disco 2', tempo: 110, swing: false, rhythm: '4/4', sequence: { hihatfod: '0000000000000000', sidetamlys: '0000000000000000', gulvtam: '0000000000000000', ride: '0000000000000000', hihat: '1020101110201011', lilletromme: '0000100000001000', stortromme: '1000100010001000' } },
  { id: 'Rap 1', name_fr: 'Hip-hop 1', tempo: 80, swing: false, rhythm: '4/4', sequence: { hihatfod: '0000000000000000', sidetamlys: '0000000000000000', gulvtam: '0000000000000000', ride: '0000000000000000', hihat: '0110101010101010', lilletromme: '0000100000001000', stortromme: '1010001001000000' } },
  { id: 'Rap 2', name_fr: 'Hip-hop 2', tempo: 90, swing: false, rhythm: '4/4', sequence: { hihatfod: '0000000000000000', sidetamlys: '0000000000000000', gulvtam: '0000000000000000', ride: '0000000000000000', hihat: '1010101010101020', lilletromme: '0000100000001000', stortromme: '1011011001100000' } },
  { id: 'Heavy metal 1', name_fr: 'Heavy metal 1', tempo: 90, swing: false, rhythm: '4/4', sequence: { hihatfod: '0000000000000000', sidetamlys: '0000000000000000', gulvtam: '0000000000000000', ride: '0000000000000000', hihat: '2020202020202020', lilletromme: '0000100000001010', stortromme: '1011001111000001' } },
  { id: 'Heavy metal 2', name_fr: 'Heavy metal 2', tempo: 90, swing: false, rhythm: '4/4', sequence: { hihatfod: '0000000000000000', sidetamlys: '0000000000000000', gulvtam: '0000000000000000', ride: '0000000000000000', hihat: '2020202020202020', lilletromme: '0000100000001000', stortromme: '1110001110010011' } },
];

// Ordre GRID_TRACKS (9 pistes) — doit matcher sequencer-app.js
const MUSICA_GRID_ORDER = ['C1', 'D1', 'E1', 'F1', 'G1', 'A1', 'B1', 'C2', 'D2'];
// Mapping : index GRID → logique. Crash C2 (index 7) toujours vide chez Musicca.
function musicaToGrid(preset) {
  const seq = preset.sequence;
  const STEPS = 16;
  // Pad à 16 (3/4 et 6/8 sont en 12)
  function pad(s) {
    if (!s) return '0'.repeat(STEPS);
    if (s.length >= STEPS) return s.slice(0, STEPS);
    return s + '0'.repeat(STEPS - s.length);
  }
  const pStort = pad(seq.stortromme);
  const pLille = pad(seq.lilletromme);
  const pHihat = pad(seq.hihat);
  const pHiFod = pad(seq.hihatfod);
  const pSide = pad(seq.sidetamlys);
  const pGulv = pad(seq.gulvtam);
  const pRide = pad(seq.ride);

  const rows = [];
  for (let step = 0; step < STEPS; step++) {
    const kick = pStort[step] !== '0';
    const snare = pLille[step] !== '0'; // 1 ou 2 → actif (rimshot inclus)
    const hatClosedRaw = pHihat[step] === '1' || pHihat[step] === '2'; // 2 = ouvert mais on split ci-dessous
    const hatClosed = pHihat[step] === '1' || pHiFod[step] !== '0'; // pédale foot OR
    const hatOpen = pHihat[step] === '2';
    // Variante hihat ouverte alternative : si '2' on active Hat Open, pas Hat Closed
    const hatClosedFinal = pHihat[step] === '1' || (pHiFod[step] !== '0' && pHihat[step] !== '2');
    const tomHigh = pSide[step] === '1';
    const tomMid = pSide[step] === '2';
    const tomLow = pGulv[step] !== '0';
    const crash = false;
    const ride = pRide[step] !== '0';
    // Disco/Heavy : hihat contient '2' qui n'est pas hihat ouvert mais un accent charleston ouvert — on le mappe aussi à Hat Open
    // Pour être fidèle à Musicca : tout '2' sur hihat → Hat Open, tout '1' → Hat Closed
    // Cas Disco "1020..." : 2 = ouvert → ok. Heavy "2020..." : 2 = ouvert aussi.
    rows.push([kick, snare, hatClosedFinal, hatOpen, tomHigh, tomMid, tomLow, crash, ride]);
  }
  // Transpose rows[step][track] → grid[track][step]
  const grid = MUSICA_GRID_ORDER.map(() => new Array(STEPS).fill(false));
  for (let s = 0; s < STEPS; s++) {
    for (let t = 0; t < MUSICA_GRID_ORDER.length; t++) {
      grid[t][s] = rows[s][t];
    }
  }
  return grid;
}

// Helper : retrouve un preset par name_fr ou id
function findMusicaPreset(key) {
  return MUSICA_PRESETS.find((p) => p.name_fr === key || p.id === key) || null;
}

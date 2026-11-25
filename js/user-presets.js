// ============================================================
// js/user-presets.js — Sauvegarde de patterns utilisateur
// Format aligné sur js/musicca-presets.js (MUSICA_PRESETS) pour
// réutiliser musicaToGrid() / loadMusiccaPreset() tels quels.
// Extension rétro-compatible : champ `crash` (les presets Musicca
// n'en ont pas → musicaToGrid les traite avec crash=false).
// Statique, 0 dépendance serveur. Inclure AVANT sequencer-presets.js.
// ============================================================

const USER_PRESETS_KEY = 'ytwm_userPresets';
const USER_STEPS = 16;

// --- Sérialisation : grille 9×16 (booléens) → sequence Musicca ---
// Ordre GRID_TRACKS : 0=Kick, 1=Snare, 2=HatClosed, 3=HatOpen,
// 4=TomHigh, 5=TomMid, 6=TomLow, 7=Crash, 8=Ride.
// Hat Open écrase Hat Closed au même pas (hihat='2' prioritaire).
function gridToMusicaSequence(pattern) {
    const seq = {
        hihatfod: '', sidetamlys: '', gulvtam: '', ride: '',
        hihat: '', lilletromme: '', stortromme: '', crash: '',
    };
    for (let s = 0; s < USER_STEPS; s++) {
        seq.stortromme += pattern[0][s] ? '1' : '0';
        seq.lilletromme += pattern[1][s] ? '1' : '0';
        seq.hihat += pattern[3][s] ? '2' : (pattern[2][s] ? '1' : '0');
        seq.hihatfod += '0'; // pédale non sérialisable seule (déjà OR dans HatClosed)
        seq.sidetamlys += pattern[5][s] ? '2' : (pattern[4][s] ? '1' : '0');
        seq.gulvtam += pattern[6][s] ? '1' : '0';
        seq.crash += pattern[7][s] ? '1' : '0'; // extension (absente chez Musicca)
        seq.ride += pattern[8][s] ? '1' : '0';
    }
    return seq;
}

// --- Slug unique : 'user:<slug>' + suffixe -2/-3 en cas de collision ---
function _slugify(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'preset';
}
function _uniqueId(nameFr, existing) {
    const base = 'user:' + _slugify(nameFr);
    let id = base;
    let n = 2;
    while (existing.some((p) => p.id === id)) { id = base + '-' + n; n++; }
    return id;
}

// --- Persistance localStorage ---
function loadUserPresets() {
    try {
        const raw = localStorage.getItem(USER_PRESETS_KEY);
        if (!raw) return [];
        const list = JSON.parse(raw);
        return Array.isArray(list) ? list : [];
    } catch (e) { return []; } // JSON corrompu → liste vide
}
function saveUserPresets(list) {
    try {
        localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(list));
        return true;
    } catch (e) {
        console.warn('[user-presets] Échec sauvegarde localStorage (quota ?)', e);
        return false;
    }
}
function addUserPreset(preset) {
    const list = loadUserPresets();
    preset.id = _uniqueId(preset.name_fr, list);
    list.push(preset);
    return saveUserPresets(list) ? preset : null;
}
function deleteUserPreset(id) {
    const list = loadUserPresets().filter((p) => p.id !== id);
    return saveUserPresets(list);
}
function findUserPreset(key) {
    return loadUserPresets().find((p) => p.id === key || p.name_fr === key) || null;
}

// --- Construction d'un preset utilisateur au format MUSICA_PRESETS ---
function buildUserPreset(nameFr, pattern, tempo, swing) {
    return {
        id: '', // assigné par addUserPreset
        name_fr: String(nameFr).trim().slice(0, 40),
        tempo: Math.round(tempo) || 120,
        swing: !!swing,
        rhythm: '4/4',
        sequence: gridToMusicaSequence(pattern),
    };
}

window.USER_PRESETS = {
    gridToMusicaSequence, buildUserPreset,
    loadUserPresets, saveUserPresets, addUserPreset, deleteUserPreset, findUserPreset,
};

// ============================================================
// js/sequencer-app.js — Bootstrap du Séquenceur & Boîte à Rythmes
// Matrice 9 pistes × 16 pas + Kit Batterie vue du dessus (8 pads).
// Le moteur audio détaillé (EQ, choke, samples) vit dans les
// micro-tâches suivantes ; ici : rendu, transport, sons de base.
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

// --- État global du séquenceur ---
let isPlaying = false;
let currentStep = 0;

// --- Références DOM (résolues au boot) ---
const gridEl = document.getElementById('step-matrix');
const drumKitEl = document.getElementById('drum-kit-view');

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

// ============================================================
// Initialisation de la grille de pas (8 steps × 16 steps)
// Crée la matrice HTML des pas du séquenceur.
function initGrid() {
    const namesCol = document.getElementById('instrument-names');
    const stepsCol = document.getElementById('step-matrix');
    if (!namesCol || !stepsCol) return;
    const STEPS = 16;
    // Bloc des steps (16 colonnes) = largeur batterie ; titre séparé (pas concerné)
    // grid divisé en 2 colonnes via HTML (instrument-names | step-matrix)
    GRID_TRACKS.forEach((track) => {
        // Toggle compact (1 bouton qui switch). Visible seulement si un sample existe.
        // Le toggle vit dans la colonne de gauche (.instrument-col) via nameWrap,
        // PAS dans gridEl (#step-matrix) — d'où le helper findTrackToggle() plus bas.
        const nameWrap = document.createElement('div');
        nameWrap.className = 'track-name-wrap';
        const name = document.createElement('span');
        name.className = 'track-name';
        name.textContent = track.name;
        nameWrap.appendChild(name);
        namesCol.appendChild(nameWrap);

        if (hasSampleForNote(track.note)) {
            const tog = buildTrackSoundToggle(track);
            nameWrap.appendChild(tog);
        }

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

// Helper : retrouve le bouton toggle d'une piste. Il vit dans
// #instrument-names (colonne de gauche), PAS dans #step-matrix (gridEl).
function findTrackToggle(note) {
    return document.querySelector(
        '#instrument-names .track-sound-toggle[data-note="' + note + '"]'
    );
}

// Construit le bouton toggle Synth/Sample pour une piste.
// Au clic, un DROPDOWN apparaît sous le bouton avec toutes les options
// disponibles pour ce pad :
//   - "♪ Synth"        → Tone.MembraneSynth / MetalSynth
//   - "◉ acoustic / kick"   → sample WAV (kit acoustic)
//   - "◉ acoustic / kick (alt)"  → si une variante existe
//   - "◉ electronic / kick"     → sample WAV (kit electronic)
//   - "◉ electronic / kick (alt)" → si une variante existe
// Le dropdown se ferme au clic en dehors ou sur Échap.
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

    // Dropdown (caché par défaut)
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
    function onDocClick(ev) {
        if (!wrap.contains(ev.target)) closeMenu();
    }
    function onKey(ev) {
        if (ev.key === 'Escape') closeMenu();
    }

    b.addEventListener('click', (e) => {
        e.stopPropagation();
        // Ferme tous les autres menus d'abord
        document.querySelectorAll('.track-sound-menu').forEach((m) => { m.hidden = true; });
        document.querySelectorAll('.track-sound-toggle.menu-open').forEach((tb) => { tb.classList.remove('menu-open'); });
        menu.hidden = !menu.hidden;
        b.classList.toggle('menu-open', !menu.hidden);
        // Reconstruit le menu avec la config actuelle (sinon il reste figé sur le mode initial)
        menu.innerHTML = '';
        populateSoundMenu(menu, track.note, closeMenu);
        if (!menu.hidden) {
            // Positionne le menu sous le bouton (fixed, calculé sur click)
            const r = b.getBoundingClientRect();
            menu.style.position = 'fixed';
            menu.style.top = (r.bottom + 4) + 'px';
            menu.style.left = r.left + 'px';
            menu.style.minWidth = Math.max(r.width, 180) + 'px';
            // Ferme au prochain clic ailleurs ou Échap
            setTimeout(() => {
                document.addEventListener('click', onDocClick, true);
                document.addEventListener('keydown', onKey, true);
            }, 0);
        }
    });

    // Construit les options du menu
    populateSoundMenu(menu, track.note, closeMenu);

    wrap.appendChild(b);
    wrap.appendChild(menu);
    return wrap;
}

// Remplit le <div.track-sound-menu> avec toutes les options disponibles
// pour la note. Chaque option est un bouton : clic = applique le mode
// correspondant, puis ferme le menu.
function populateSoundMenu(menu, note, onPick) {
    const cfg = padConfig[note];
    if (!cfg) return;

    // 1) Option "Synth"
    addMenuItem(menu, '♪ Synth (MembraneSynth / MetalSynth)', cfg.mode === 'synth', () => {
        setPadMode(note, 'synth');
        const tog = findTrackToggle(note);
        if (tog) updateToggleLabel(tog, padConfig[note]);
        onPick();
    });

    // 2) Toutes les variantes de sample disponibles
    const variants = listSamplesForNote(note);
    if (variants.length > 0) {
        // Séparateur visuel
        const sep = document.createElement('div');
        sep.className = 'track-sound-menu-sep';
        menu.appendChild(sep);

        variants.forEach((v) => {
            // Texte court : "acoustic / kick" ou "acoustic / snare-brush (alt)"
            const isAlt = v.isAlternate;
            const isActive = (cfg.mode === 'sample'
                && cfg.kit === v.kit
                && cfg.sampleFile === v.filename);
            const label = (isActive ? '✓ ' : '○ ') + v.kit + ' / ' + v.shortName + (isAlt ? ' (alt)' : '');
            addMenuItem(menu, label, isActive, () => {
                // Bascule en mode 'sample' avec ce kit/filename
                cfg.mode = 'sample';
                cfg.kit = v.kit;
                cfg.sampleFile = v.filename;
                preloadSample(note);
                savePadConfig();
                // Met à jour le bouton + ferme le menu
                const tog = findTrackToggle(note);
                if (tog) updateToggleLabel(tog, cfg);
                onPick();
            });
        });
    }
}

function addMenuItem(menu, label, isActive, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'track-sound-menu-item' + (isActive ? ' active' : '');
    btn.textContent = label;
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
    });
    menu.appendChild(btn);
}

// Liste tous les samples disponibles pour une note, dans l'ordre d'affichage.
// [{ kit, filename, shortName, isAlternate }]
function listSamplesForNote(note) {
    if (typeof DRUM_KITS === 'undefined') return [];
    const out = [];
    KIT_LIST.forEach((kitName) => {
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

// ============================================================
// État mémoire de la pédale charleston : 'UP' ou 'DOWN'
// Clavier / pédale : un clic = DOWN, deuxième clic = UP.
// Mémorise l'état global partagé entre la zone pad HAT et la zone pédale.
// La pédale ferme uniquement le charleston : pas de son direct,
// l'état change et le son s'adapte (étouffé si DOWN, ouvert si UP).
// ============================================================
let hatPedalState = 'UP'; // 'UP' = charleston ouverte par défaut, 'DOWN' = fermée

// Bascule le mode d'un pad (synth ↔ sample). Met aussi à jour le bouton
// toggle dans l'en-tête de piste et pré-charge le buffer si on passe en 'sample'.
function setPadMode(note, mode) {
    const cfg = padConfig[note];
    if (!cfg) return;
    cfg.mode = mode;
    if (mode === 'sample' && !cfg.sampleFile) {
        // Renseigne sampleFile depuis le kit actuel
        const kit = DRUM_KITS[cfg.kit];
        if (kit && kit.samples[note]) cfg.sampleFile = kit.samples[note];
    }
    if (mode === 'sample' && cfg.sampleFile) {
        // Pré-charge le player tout de suite (le chargement du WAV est async).
        preloadSample(note);
    }
    // Met à jour le bouton toggle de l'en-tête de piste
    const tog = findTrackToggle(note);
    if (tog) updateToggleLabel(tog, cfg);
    savePadConfig();
}

// Change le kit et/ou le sampleFile utilisé par un pad (depuis le <select>).
// Si le pad est en mode sample, on bascule le buffer et on pré-charge.
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

// === Persistance du preset Rythmes actif ===
// Sans ça, après reload, le bouton Rythmes ▾ affichait le label par défaut
// alors que la grille gardait le pattern du dernier preset joué → état désynchro.
const STORAGE_PRESET_KEY = 'ytwm_activePreset';
function saveActivePreset(nameFr) {
    try { localStorage.setItem(STORAGE_PRESET_KEY, String(nameFr || '')); } catch (e) { /* ignore */ }
}
function loadActivePresetName() {
    try { return localStorage.getItem(STORAGE_PRESET_KEY) || ''; } catch (e) { return ''; }
}

// Pré-charge TOUS les samples configurés en mode='sample' au boot. Sans ça,
// le 1er step joué après reload tombait sur le synth fallback parce que le
// Tone.Player n'était créé qu'au premier playNoteByConfig().
function preloadAllSamples() {
    if (typeof Tone === 'undefined') return;
    Object.keys(padConfig).forEach((note) => {
        const cfg = padConfig[note];
        if (cfg && cfg.mode === 'sample' && cfg.sampleFile) {
            preloadSample(note);
        }
    });
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

// Son de la cymbale Hat selon l'état mémoire.
// `hatPad` est résolu dynamiquement à chaque appel pour rester valide
// même si DRUM_PADS est réinitialisé.
// Le mode (synth / sample) est lu depuis padConfig[note] → Tone.Player ou Tone.MetalSynth.
// `time` est le timestamp Tone.js du step (fourni par le scheduler Transport).
// Indispensable pour les re-triggers rapides : player.start(time) au lieu de
// player.start() évite l'erreur "Start time must be strictly greater than
// previous start time" quand 2 hits consécutifs frappent la même piste.
function playHatNote(state, time) {
    const pad = DRUM_PADS.find((p) => p.name === 'Hat');
    if (!pad || typeof Tone === 'undefined') return;
    const note = state === 'DOWN' ? pad.note : pad.openNote;
    const cfg = padConfig[note];
    if (!cfg) return;
    if (cfg.mode === 'sample') {
        // En mode sample on joue simplement le WAV (le WAV est "self-contained")
        const player = getPlayerForNote(note);
        if (player && player.loaded) {
            if (typeof time === 'number') player.start(time);
            else player.start();
        }
    } else {
        const synth = getSynthForNote(note);
        if (!synth) return;
        const duration = state === 'DOWN' ? '16n' : '8n'; // court/étouffé si DOWN, long/ouvert si UP
        if (typeof time === 'number') synth.triggerAttackRelease(note, duration, time);
        else synth.triggerAttackRelease(note, duration);
    }
}

// Contrôle clavier des pads (badges affichés sur chaque zone)
// ============================================================
// keyBadge -> touche(s) : "B / Space" => 'b' et ' ' (espace).
const KEY_TO_PAD = new Map();
DRUM_PADS.forEach((pad) => {
    pad.keyBadge.split(' / ').forEach((label) => {
        const key = label === 'Space' ? ' ' : label.toLowerCase();
        KEY_TO_PAD.set(key, pad);
    });
});

document.addEventListener('keydown', (e) => {
    const pad = KEY_TO_PAD.get(e.key.toLowerCase());
    if (!pad || e.repeat) return;
    if (e.key === ' ') e.preventDefault(); // évite le scroll / re-click du bouton
    triggerPadDown(pad);
});
document.addEventListener('keyup', (e) => {
    const pad = KEY_TO_PAD.get(e.key.toLowerCase());
    if (pad) triggerPadUp(pad); // charleston ouvert au relâchement (si pédale UP)
});

// ============================================================
// Batterie vue du dessus
// ============================================================

// Construit la barre de config des pads (mode Synth/Sample + kit).
// Affichée sous le stage, elle liste les pads de DRUM_PADS avec :
//   - nom du pad + raccourci clavier
//   - toggle 2 boutons : "Synth" / "Sample"
//   - sélecteur de kit (acoustic/electronic) — visible seulement si mode='sample'
//   - statut actuel (fichier WAV utilisé)
// Crée la scène (stage) qui positionne les pads
function initDrumKit() {
    if (!drumKitEl) return;
    const stage = document.createElement('div');
    stage.className = 'drum-kit-stage';
    drumKitEl.appendChild(stage);

    DRUM_PADS.forEach((pad) => {
        const el = document.createElement('div');
        el.className = 'drum-pad ' + (pad.type === 'cymbal' ? 'cymbal ' : 'drum ') + pad.className;
        el.dataset.drum = pad.note;
        el.dataset.name = pad.name;

        const name = document.createElement('span');
        name.className = 'pad-name';
        name.textContent = pad.name;

        const kbd = document.createElement('kbd');
        kbd.className = 'key-badge';
        kbd.textContent = pad.keyBadge;

        el.append(name, kbd);

        // Écouteurs : souris / tactile. Le Hat est spécial : c'est une cymbale
        // charleston, son "open" est joué au mouseup/touchend (relâchement du pad)
        // ou via raccourci clavier (touche H). On NE déclenche PAS de son sur
        // mouseleave : si l'utilisateur survole puis déplace le curseur hors du
        // pad sans cliquer, on ne doit rien entendre (comportement normal d'un
        // pad à déclenchement manuel, pas d'un pad à pression continue).
        const isHat = pad.openNote;
        el.addEventListener('mousedown', () => triggerPadDown(pad));
        el.addEventListener('mouseup', () => { if (isHat) triggerPadUp(pad); });
        el.addEventListener('touchstart', (e) => { e.preventDefault(); triggerPadDown(pad); }, { passive: false });
        el.addEventListener('touchend', (e) => { e.preventDefault(); if (isHat) triggerPadUp(pad); }, { passive: false });
        el.addEventListener('touchcancel', () => { if (isHat) triggerPadUp(pad); });

        stage.appendChild(el);
    });

    // --- Pédale charleston mémoire ---
    // ZONE PÉDALE : clic = toggle DOWN/UP, affiche "DOWN"/"UP", joue son adapté.
    const hatPad = DRUM_PADS.find((p) => p.name === 'Hat');
    const pedal = document.createElement('div');
    pedal.className = 'drum-pad hat-pedal pad-hat-pedal';
    pedal.dataset.drum = hatPad.note;
    pedal.dataset.name = 'Hat (pédale)';

    const pName = document.createElement('span');
    pName.className = 'pad-name';
    pName.textContent = 'Hat (pédale)';

    const pKbd = document.createElement('kbd');
    pKbd.className = 'key-badge';
    pKbd.textContent = 'H';

    // Indicateur texte "UP"/"DOWN" sur la pédale
    const label = document.createElement('span');
    label.className = 'hat-pedal-label';
    label.textContent = hatPedalState;
    label.style.position = 'absolute';
    label.style.left = '50%';
    label.style.top = '50%';
    label.style.transform = 'translate(-50%, -50%)';
    label.style.fontSize = '0.5rem';
    label.style.fontWeight = '800';
    label.style.color = '#ffd28f';
    label.style.pointerEvents = 'none';
    pedal.append(pName, pKbd, label);

    // Clic sur la pédale = bascule l'état mémoire UP/DOWN. AUCUN son ici :
    // la pédale ne sert qu'à choisir l'état ouvert/fermé de la prochaine
    // frappe sur la cymbale Hat. Jouer un son à chaque clic de pédale
    // serait un comportement pirate (l'utilisateur ne frappe pas la
    // charleston, il ajuste juste la mémoire de l'instrument).
    pedal.addEventListener('mousedown', (e) => {
        e.preventDefault();
        hatPedalState = hatPedalState === 'UP' ? 'DOWN' : 'UP';
        label.textContent = hatPedalState;
    });

    // Note : la pédale charleston (ci-dessous) déclenche bien la note au
    // mousedown (toggle mémoire + son adapté). Pour le pad Hat lui-même,
    // on NE rajoute PAS de listener 'click' ici : le pad est déjà câblé
    // par la boucle DRUM_PADS.forEach() au-dessus (mousedown → triggerPadDown
    // qui choisit open/closed selon hatPedalState, mouseup → no-op).
    // Un listener 'click' en plus causerait un double déclenchement
    // (mousedown joue 1 son, click joue le même son 50 ms plus tard).

    stage.appendChild(pedal);
}

// Appui sur un pad : joue la note.
// Cas spécial de la charleston (pad avec openNote) : le son joué dépend de
// l'état mémoire de la pédale. Pas de double-trigger au relâchement (un
// seul son par frappe) — le user a explicitement demandé ce comportement
// (un hit = hihat-open OU hihat-closed, jamais les deux).
//   - Pédale UP  (mémoire "ouverte")  → joue la note ouverte (F1 / hihat-open)
//   - Pédale DOWN (mémoire "fermée")  → joue la note fermée (E1 / hihat-closed)
function triggerPadDown(pad) {
    const isHat = pad.openNote;
    if (isHat) {
        // Hat : on choisit la note selon la pédale, pas d'artifice au relâchement.
        const note = hatPedalState === 'UP' ? pad.openNote : pad.note;
        const cfg = padConfig[note];
        if (cfg && cfg.mode === 'sample') {
            playNoteByConfig(note);
        } else {
            // Synth : on délègue à playHatNote avec l'état mémoire pour qu'il
            // ajuste la durée ADSR (8n ouverte / 16n fermée).
            playHatNote(hatPedalState);
        }
    } else {
        playNoteByConfig(pad.note);
    }
    flashPad(pad.className);
}

// Relâchement : ne joue RIEN pour la charleston. Un seul son par frappe
// (cf. commentaire de triggerPadDown). Avant, on rejouait "open" au mouseup
// → double son (closed + open) à chaque clic sur le pad Hat, comportement
// très gênant. Conservé en no-op explicite pour que les appels existants
// (mouseup / touchend / keyup / touchcancel) restent neutres.
function triggerPadUp(pad) {
    // Intentionnellement vide : la charleston ne joue qu'à l'appui.
}

// Mise à jour de l'indicateur texte "UP"/"DOWN" sur la pédale
// (déjà insérée dans initDrumKit, mais appelée ici si besoin)
function updateHatPedalLabel() {
    const pedal = document.querySelector('.pad-hat-pedal');
    if (!pedal) return;
    const label = pedal.querySelector('.hat-pedal-label');
    if (label) label.textContent = hatPedalState;
}

// Relance l'animation CSS d'impact sur le pad.
function flashPad(className) {
    const el = drumKitEl.querySelector('.' + className);
    if (!el) return;
    el.classList.remove('hit');
    void el.offsetWidth; // force le reflow pour relancer l'animation
    el.classList.add('hit');
}

// Notes pilotées par le MetalSynth (cymbales) ; le reste par MembraneSynth.
const CYM_NOTE = new Set(['E1', 'F1', 'C2', 'D2']); // E1/F1 = hats, C2/D2 = crash/ride

// ============================================================
// Configuration audio par note : 2 modes par pad (synth ou sample).
// `mode='synth'`  → Tone.MembraneSynth / Tone.MetalSynth (par défaut).
// `mode='sample'` → Tone.Player qui joue un WAV depuis /assets/sounds/.
// `kit` et `sampleFile` ne sont utilisés qu'en mode 'sample'.
// Cette config est INITIALISÉE par défaut à 'synth' et SURCHARGEABLE
// via l'UI (toggle par pad). Persistance : localStorage (à venir).
// ============================================================
const padConfig = {};
GRID_TRACKS.forEach((t) => {
    padConfig[t.note] = { mode: 'synth', kit: 'acoustic', sampleFile: null };
});
loadPadConfigFromStorage();

// Liste des notes qui ont un sample disponible (kits acoustic + electronic).
// Utile pour empêcher l'utilisateur de basculer en 'sample' sur une note sans WAV.
function hasSampleForNote(note) {
    if (typeof DRUM_KITS === 'undefined') return false;
    return !!(DRUM_KITS.acoustic.samples[note] || DRUM_KITS.electronic.samples[note]);
}

// Récupère l'URL du sample configuré pour la note.
function getSampleUrlForNote(note) {
    const cfg = padConfig[note];
    if (!cfg || cfg.mode !== 'sample' || !cfg.sampleFile) return null;
    const kit = DRUM_KITS[cfg.kit];
    if (!kit) return null;
    return kit.basePath + cfg.sampleFile;
}

// ============================================================
// Synthétiseurs Tone.js — créés paresseusement au premier appel
// pour éviter de mobiliser l'AudioContext avant un geste utilisateur.
// MembraneSynth : fûts (kick, snare, toms) — son percussif tonal.
// MetalSynth : cymbales (hats, crash, ride) — son bruité métallique.
// ============================================================
const SYNTH_CACHE = new Map(); // note → synth Tone.js
function getSynthForNote(note) {
    if (typeof Tone === 'undefined') return null;
    if (SYNTH_CACHE.has(note)) return SYNTH_CACHE.get(note);
    let s;
    if (CYM_NOTE.has(note)) {
        // Cymbales : MetalSynth avec envelope courte
        s = new Tone.MetalSynth({
            harmonicity: 5.1,
            modulationIndex: 32,
            resonance: 4000,
            octaves: 1.5,
            envelope: { attack: 0.001, decay: 0.4, release: 0.2 },
            volume: -10,
        });
    } else {
        // Fûts : MembraneSynth
        s = new Tone.MembraneSynth({
            pitchDecay: 0.05,
            octaves: 4,
            envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 1.4 },
            volume: -6,
        });
    }
    s.toDestination();
    SYNTH_CACHE.set(note, s);
    return s;
}

// ============================================================
// Lecteur de sample Tone.Player — créé paresseusement par note.
// L'URL est résolue à partir de padConfig[note] AU MOMENT DU JEU.
// On rebuild la source quand l'URL change (kit/sampleFile modifié).
// ============================================================
const PLAYER_CACHE = new Map(); // note → { player, currentUrl, loadPromise }

function getPlayerForNote(note) {
    if (typeof Tone === 'undefined') return null;
    const url = getSampleUrlForNote(note);
    if (!url) return null;
    let entry = PLAYER_CACHE.get(note);
    if (!entry) {
        const player = new Tone.Player({ url: url, autostart: false });
        player.toDestination();
        entry = { player: player, currentUrl: url, loadPromise: Promise.resolve() };
        PLAYER_CACHE.set(note, entry);
    } else if (entry.currentUrl !== url) {
        // URL a changé → recharger le buffer (async).
        entry.player.load(url);
        entry.currentUrl = url;
        entry.loadPromise = entry.player.loaded
            ? Promise.resolve()
            : new Promise((resolve) => { entry.player.once('load', resolve); });
    }
    return entry.player;
}

// Pré-charge un sample de manière asynchrone. À appeler dès que l'utilisateur
// bascule un pad en mode 'sample' ou change le kit, pour que le 1er clic
// sur le pad batterie (ou la lecture du séquenceur) ait déjà le buffer prêt.
//
// Tone.js 14 : `player.load(url)` RETOURNE une Promise qui résout au
// chargement (on n'utilise pas `player.once('load')` qui n'existe pas sur
// Tone.Player — c'est un ToneAudioNode mais sans EventEmitter public).
function preloadSample(note) {
    if (typeof Tone === 'undefined') return Promise.resolve();
    const url = getSampleUrlForNote(note);
    if (!url) return Promise.resolve();
    let entry = PLAYER_CACHE.get(note);
    if (!entry) {
        const player = new Tone.Player({ url: url, autostart: false });
        player.toDestination();
        // player.load() retourne une Promise. On la stocke pour pouvoir
        // l'attendre au prochain appel.
        entry = { player: player, currentUrl: url, loadPromise: player.loaded ? Promise.resolve() : null };
        PLAYER_CACHE.set(note, entry);
    } else if (entry.currentUrl !== url) {
        // URL a changé → recharger. load() retourne une nouvelle Promise.
        const p = entry.player.load(url);
        entry.currentUrl = url;
        entry.loadPromise = p;
        return p;
    }
    if (entry.loadPromise) return entry.loadPromise;
    // 1re création ou buffer déjà chargé : on évalue l'état actuel.
    entry.loadPromise = entry.player.loaded
        ? Promise.resolve()
        : entry.player.load(entry.currentUrl);
    return entry.loadPromise;
}

// Joue un pad selon sa config (synth ou sample). Point d'entrée unique.
// Si mode='sample' mais buffer pas encore chargé : FALLBACK sur le synth
// pour ne pas avoir un clic mort. Le sample sera prêt au 2e appel.
// `time` est le timestamp Tone.js du step (fourni par Transport.scheduleRepeat)
// et est passé à player.start / synth.triggerAttackRelease pour permettre
// des re-triggers rapides sans erreur "Start time must be strictly greater
// than previous start time" (sinon 2 hits consécutifs sur la même piste
// lèvent une exception et coupent la lecture du séquenceur).
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
        // Fallback : lance le pré-chargement (idempotent) et joue le synth
        // en attendant. L'utilisateur entend toujours quelque chose.
        preloadSample(note);
        const synth = getSynthForNote(note);
        if (synth) {
            if (typeof time === 'number') synth.triggerAttackRelease(note, '16n', time);
            else synth.triggerAttackRelease(note, '16n');
        }
    } else {
        // mode 'synth'
        const synth = getSynthForNote(note);
        if (synth) {
            if (typeof time === 'number') synth.triggerAttackRelease(note, '16n', time);
            else synth.triggerAttackRelease(note, '16n');
        }
    }
}

// ============================================================
// Transport : Play / Stop, scheduler Tone.Transport, Tone.start()
// (gesture utilisateur requis pour débloquer l'AudioContext).
// ============================================================
const STEPS_PER_LOOP = 16;
const STEP_DURATION = '16n'; // 1/16e note par pas

// État du séquenceur : pattern[trackIndex][stepIndex] = boolean
// Synchronisé avec la classe CSS .active sur chaque .step.
const pattern = GRID_TRACKS.map(() => new Array(STEPS_PER_LOOP).fill(false));
let loopId = null; // id du callback scheduleRepeat, pour le clear

// Replanifie le `scheduleRepeat` du séquenceur. Source unique de la
// création/recréation du loop : appelé par togglePlay (au démarrage) et par
// setBpm (changement de BPM). Sans re-planification quand le BPM change
// pendant la lecture, Tone.js continue de tirer le callback à l'ancien
// intervalle. Le Transport lui-même n'est pas touché, seul le loop est
// recréé, donc le playhead continue sans saut audible.
function rescheduleLoop() {
    if (typeof Tone === 'undefined' || !isPlaying) return;
    if (loopId !== null) {
        Tone.Transport.clear(loopId);
        loopId = null;
    }
    loopId = Tone.Transport.scheduleRepeat((time) => {
        onSequencerStep(time);
        Tone.Draw.schedule(() => { /* hook visuel facultatif */ }, time);
    }, STEP_DURATION);
}

// Source unique pour changer le BPM : on met à jour l'input, l'affichage
// ET le Transport, puis on replanifie le loop s'il est en cours. C'est le seul
// endroit qui touche au BPM, ce qui évite l'embrouille précédente (modifs
// partielles du BPM via 3 chemins différents qui se contredisaient).
function setBpm(newBpm) {
    const v = Math.max(40, Math.min(240, Number(newBpm) || 120));
    const bpmInput = document.getElementById('bpm');
    const bpmValue = document.getElementById('bpm-value');
    if (bpmInput) bpmInput.value = String(v);
    if (bpmValue) bpmValue.textContent = String(v);
    if (typeof Tone !== 'undefined' && Tone.Transport) {
        Tone.Transport.bpm.value = v;
    }
    rescheduleLoop();
}
// À chaque pas du séquenceur, on parcourt les pistes et on déclenche
// les notes des pas actifs. Aussi : on anime le playhead visuel (.playing).
// `stepTime` est le timestamp Tone.js du pas (fourni par scheduleRepeat) —
// passé à playNoteByConfig pour que Tone.Player.schedule() ne lève pas
// "Start time must be strictly greater than previous start time" lors de
// re-triggers rapides (2 hits consécutifs sur la même piste).
function onSequencerStep(stepTime) {
    // Déclenche les notes des pas actifs AVANT d'avancer.
    // try/catch par piste : si un Tone.Player lève (ex. re-trigger trop rapide
    // malgré le fix stepTime), on continue sur les autres pistes et le
    // séquenceur ne se "fige" pas (sinon le playhead semble dériver).
    GRID_TRACKS.forEach((track, ti) => {
        if (pattern[ti][currentStep]) {
            try {
                triggerGridNote(track, stepTime);
            } catch (err) {
                console.warn('sequencer: track', track.name, 'trigger failed:', err.message);
            }
        }
    });
    // Met à jour le playhead visuel sur la grille
    if (gridEl) {
        const prev = gridEl.querySelectorAll('.step.playing');
        prev.forEach((el) => el.classList.remove('playing'));
        const cells = gridEl.querySelectorAll('.step');
        cells.forEach((cell) => {
            if (Number(cell.dataset.step) === currentStep) cell.classList.add('playing');
        });
    }
    // Avance au pas suivant pour le prochain appel
    currentStep = (currentStep + 1) % STEPS_PER_LOOP;
}

// Joue la note d'une piste de la grille (kick, snare, etc.) — court (16e).
// Délègue à playNoteByConfig (mode = padConfig[note].mode). stepTime est
// optionnel : fourni par le scheduler Tone.Transport pour des re-triggers propres.
function triggerGridNote(track, stepTime) {
    if (typeof Tone === 'undefined') return;
    // Hat Open (F1) et Hat Closed (E1) passent par playHatNote pour respecter
    // l'état de la pédale charleston (note + durée adaptées).
    if (track.note === 'E1' || track.note === 'F1') {
        playHatNote(hatPedalState === 'DOWN' ? 'DOWN' : (track.note === 'F1' ? 'UP' : 'DOWN'), stepTime);
        return;
    }
    playNoteByConfig(track.note, stepTime);
}

// Toggle Play/Pause. Premier appel : Tone.start() + démarrage du Transport.
async function togglePlay() {
    if (typeof Tone === 'undefined') return;
    const playBtn = document.getElementById('play-pause');
    if (!isPlaying) {
        // Premier clic : débloque l'AudioContext (gesture utilisateur).
        await Tone.start();
        // Source unique : setBpm() met l'input + Transport + rescheduleLoop()
        // en un seul appel. Si isPlaying est encore false ici, rescheduleLoop
        // ne fait rien — c'est OK, on le rappelle juste après avoir démarré.
        setBpm(Number(document.getElementById('bpm')?.value) || 120);
        Tone.Transport.start();
        isPlaying = true;
        rescheduleLoop();
        if (playBtn) playBtn.textContent = 'Pause';
    } else {
        Tone.Transport.pause();
        isPlaying = false;
        if (playBtn) playBtn.textContent = 'Play';
    }
}

// Stop complet : remet le séquenceur au pas 0, coupe le son, libère le loop.
function stopSequencer() {
    if (typeof Tone === 'undefined') return;
    Tone.Transport.stop();
    if (loopId !== null) {
        Tone.Transport.clear(loopId);
        loopId = null;
    }
    currentStep = 0;
    isPlaying = false;
    const playBtn = document.getElementById('play-pause');
    if (playBtn) playBtn.textContent = 'Play';
    if (gridEl) {
        gridEl.querySelectorAll('.step.playing').forEach((el) => el.classList.remove('playing'));
    }
}

// Sync pattern[] quand l'utilisateur toggle un .step dans la grille.
// On lit chaque .step-row du #step-matrix (et non .track-row qui n'existe pas).
function syncPatternFromDOM() {
    if (!gridEl) return;
    const rows = gridEl.querySelectorAll('.step-row');
    rows.forEach((row, ti) => {
        const steps = row.querySelectorAll('.step');
        steps.forEach((cell, si) => {
            if (ti < pattern.length && si < pattern[ti].length) {
                pattern[ti][si] = cell.classList.contains('active');
            }
        });
    });
}

// ============================================================
// Presets « Rythmes » Musicca — chargement grille + BPM/swing
// ============================================================
function applyGridToDOM(grid) {
    if (!gridEl) return;
    // grid[trackIndex][stepIndex] → DOM
    const rows = gridEl.querySelectorAll('.step-row');
    rows.forEach((row, ti) => {
        const steps = row.querySelectorAll('.step');
        steps.forEach((cell, si) => {
            const on = !!(grid[ti] && grid[ti][si]);
            cell.classList.toggle('active', on);
            // sync pattern[]
            if (ti < pattern.length && si < pattern[ti].length) pattern[ti][si] = on;
        });
    });
}

function loadMusiccaPreset(key) {
    if (typeof MUSICA_PRESETS === 'undefined' || typeof musicaToGrid === 'undefined') return null;
    const preset = findMusicaPreset(key);
    if (!preset) return null;
    const grid = musicaToGrid(preset);
    applyGridToDOM(grid);
    // BPM : on passe par setBpm() (source unique) qui met à jour l'input,
    // l'affichage, le Transport ET replanifie le loop si on est en lecture.
    setBpm(preset.tempo);
    // Swing (Jazz 1-4 → swing=true)
    if (typeof Tone !== 'undefined' && Tone.Transport) {
        try {
            Tone.Transport.swing = preset.swing ? 0.3 : 0;
            Tone.Transport.swingSubdivision = '16n';
        } catch (e) { /* Tone <14 ignore */ }
    }
    // Label bouton Rythmes
    const rythmesBtn = document.getElementById('rythmes-btn');
    if (rythmesBtn) rythmesBtn.textContent = preset.name_fr + ' ▾';
    // Persiste le preset actif pour qu'au reload le label ET la grille restent synchro.
    saveActivePreset(preset.name_fr);
    // Highlight item dans le menu
    document.querySelectorAll('#rythmes-menu .track-sound-menu-item').forEach((el) => {
        el.classList.toggle('active', el.dataset.preset === preset.name_fr);
    });
    return preset;
}

function initRythmesMenu() {
    const btn = document.getElementById('rythmes-btn');
    const menu = document.getElementById('rythmes-menu');
    const wrap = document.getElementById('rythmes-wrap');
    if (!btn || !menu || typeof MUSICA_PRESETS === 'undefined') return;

    // Peuple le menu (✓ = sélectionné, ○ = autres — pattern exclusif)
    function populateRythmesMenu() {
        menu.innerHTML = '';
        MUSICA_PRESETS.forEach((p) => {
            const isActive = btn.textContent.startsWith(p.name_fr);
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'track-sound-menu-item' + (isActive ? ' active' : '');
            item.dataset.preset = p.name_fr;
            item.setAttribute('role', 'option');
            item.textContent = (isActive ? '✓ ' : '○ ') + p.name_fr + '  · ' + p.tempo + ' BPM' + (p.swing ? ' · swing' : '') + ' · ' + p.rhythm;
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                loadMusiccaPreset(p.name_fr);
                closeMenu();
            });
            menu.appendChild(item);
        });
    }

    function closeMenu() {
        menu.hidden = true;
        btn.classList.remove('menu-open');
        btn.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', onDocClick, true);
        document.removeEventListener('keydown', onKey, true);
    }
    function onDocClick(ev) {
        if (!wrap.contains(ev.target)) closeMenu();
    }
    function onKey(ev) {
        if (ev.key === 'Escape') closeMenu();
    }

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Ferme les autres menus track-sound d'abord (exclusif)
        document.querySelectorAll('.track-sound-menu').forEach((m) => { if (m !== menu) m.hidden = true; });
        document.querySelectorAll('.track-sound-toggle.menu-open').forEach((b) => { if (b !== btn) b.classList.remove('menu-open'); });
        const willOpen = menu.hidden;
        if (willOpen) {
            populateRythmesMenu();
            const r = btn.getBoundingClientRect();
            menu.style.position = 'fixed';
            menu.style.top = (r.bottom + 4) + 'px';
            menu.style.left = r.left + 'px';
            menu.style.minWidth = Math.max(r.width, 220) + 'px';
            menu.hidden = false;
            btn.classList.add('menu-open');
            btn.setAttribute('aria-expanded', 'true');
            setTimeout(() => {
                document.addEventListener('click', onDocClick, true);
                document.addEventListener('keydown', onKey, true);
            }, 0);
        } else {
            closeMenu();
        }
    });

    // Peuplement initial (pour accessibilité)
    populateRythmesMenu();
}

// ============================================================
// --- Démarrage de l'application ---
window.addEventListener('DOMContentLoaded', () => {
    initGrid();
    initDrumKit();
    initRythmesMenu();

    // --- Restauration du preset Rythmes sauvegardé ---
    // loadMusiccaPreset() rejoue applyGridToDOM + setBpm + label du bouton
    // → après reload, la grille et le bouton Rythmes sont synchro avec le
    // dernier preset joué, sans cliquer nulle part.
    const savedPreset = loadActivePresetName();
    if (savedPreset) loadMusiccaPreset(savedPreset);

    // --- Pré-chargement des samples configurés ---
    // Si l'utilisateur a sauvegardé des pads en mode='sample' (ex. ◉ acoustic / kick),
    // il faut créer les Tone.Player et lancer leur load() AVANT le 1er Play, sinon
    // le 1er step joué tombe sur le synth fallback (le son n'est pas celui
    // sélectionné). preloadAllSamples est async (charge les WAV) mais on n'a
    // pas besoin d'attendre : le 1er hit attendra via getPlayerForNote si besoin.
    preloadAllSamples();

    // Câble les toggles .step sur la grille vers le pattern[].
    if (gridEl) {
        gridEl.addEventListener('click', (e) => {
            const cell = e.target.closest('.step');
            if (!cell) return;
            // Le toggle est fait par le onclick inline (ajoute .active).
            // On re-sync le pattern juste après.
            requestAnimationFrame(syncPatternFromDOM);
        });
    }

    // Câble les boutons Play/Stop.
    const playBtn = document.getElementById('play-pause');
    const stopBtn = document.getElementById('stop');
    if (playBtn) playBtn.addEventListener('click', togglePlay);
    if (stopBtn) stopBtn.addEventListener('click', stopSequencer);

    // BPM + volume master : appliqués sur Tone.Transport et Tone.Destination.
    // Le BPM passe par setBpm() (source unique) qui met aussi à jour l'input,
    // l'affichage et replanifie le loop si la lecture est en cours.
    const bpmInput = document.getElementById('bpm');
    const bpmValue = document.getElementById('bpm-value');
    const volInput = document.getElementById('master-volume');
    const volValue = document.getElementById('vol-value');
    if (bpmInput) {
        if (bpmValue) bpmValue.textContent = String(bpmInput.value);
        bpmInput.addEventListener('input', () => setBpm(Number(bpmInput.value)));
    }
    if (volInput && typeof Tone !== 'undefined') {
        Tone.Destination.volume.value = Tone.gainToDb(Number(volInput.value) / 100);
        volInput.addEventListener('input', () => {
            const v = Number(volInput.value);
            Tone.Destination.volume.value = Tone.gainToDb(v / 100);
            if (volValue) volValue.textContent = v + '%';
        });
    }
});
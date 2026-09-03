// ============================================================
// js/sequencer-drumkit.js — Batterie vue du dessus
// Rendu des 8 pads + zone pédale charleston, écouteurs souris/tactile,
// raccourcis clavier (B/Space/S/H/T/Y/G/C/R), animation d'impact.
// Dépendances : window.SEQUENCER_CFG, window.SEQUENCER_SOUND.
// ============================================================

// Note : pas de `const _CFG` au top-level — en mode <script> classique,
// les `const` partagent le scope global et plusieurs fichiers en
// déclareraient un → SyntaxError. On accède à window.SEQUENCER_CFG
// directement partout dans ce module.

// État mémoire de la pédale charleston. Le clic sur la pédale ne joue
// aucun son : il change juste la mémoire, qui sera lue au prochain
// appui sur le pad Hat pour choisir open/closed.
let hatPedalState = 'UP';

// keyBadge -> touche(s) : "B / Space" => 'b' et ' ' (espace).
const KEY_TO_PAD = new Map();
window.SEQUENCER_CFG.DRUM_PADS.forEach((pad) => {
    pad.keyBadge.split(' / ').forEach((label) => {
        const key = label === 'Space' ? ' ' : label.toLowerCase();
        KEY_TO_PAD.set(key, pad);
    });
});

document.addEventListener('keydown', (e) => {
    const pad = KEY_TO_PAD.get(e.key.toLowerCase());
    if (!pad || e.repeat) return;
    if (e.key === ' ') e.preventDefault();
    triggerPadDown(pad);
});
document.addEventListener('keyup', (e) => {
    const pad = KEY_TO_PAD.get(e.key.toLowerCase());
    if (pad) triggerPadUp(pad);
});

// Appui sur un pad : joue la note. Charleston = note selon pédale.
//   - Pédale UP  → note ouverte (F1 / hihat-open)
//   - Pédale DOWN → note fermée (E1 / hihat-closed)
// Un seul son par frappe (pas de re-trigger au relâchement).
function triggerPadDown(pad) {
    const isHat = pad.openNote;
    if (isHat) {
        const note = hatPedalState === 'UP' ? pad.openNote : pad.note;
        if (window.SEQUENCER_SOUND) {
            const cfg = window.SEQUENCER_SOUND.padConfig[note];
            if (cfg && cfg.mode === 'sample') {
                window.SEQUENCER_SOUND.playNoteByConfig(note);
            } else {
                window.SEQUENCER_SOUND.playHatNote(hatPedalState);
            }
        }
    } else if (window.SEQUENCER_SOUND) {
        window.SEQUENCER_SOUND.playNoteByConfig(pad.note);
    }
    flashPad(pad.className);
}

// Relâchement : ne joue RIEN pour la charleston (cf. commentaire de
// triggerPadDown). No-op explicite pour que mouseup/touchend/keyup/
// touchcancel restent neutres.
function triggerPadUp(pad) {
    // Intentionnellement vide.
}

function flashPad(className) {
    const el = window.SEQUENCER_CFG.drumKitEl.querySelector('.' + className);
    if (!el) return;
    el.classList.remove('hit');
    void el.offsetWidth; // reflow pour relancer l'animation
    el.classList.add('hit');
}

function updateHatPedalLabel() {
    const pedal = document.querySelector('.pad-hat-pedal');
    if (!pedal) return;
    const label = pedal.querySelector('.hat-pedal-label');
    if (label) label.textContent = hatPedalState;
}

// Construit la scène (stage) et positionne les 8 pads + la pédale Hat.
function initDrumKit() {
    if (!window.SEQUENCER_CFG.drumKitEl) return;
    const stage = document.createElement('div');
    stage.className = 'drum-kit-stage';
    window.SEQUENCER_CFG.drumKitEl.appendChild(stage);

    window.SEQUENCER_CFG.DRUM_PADS.forEach((pad) => {
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

        // Le Hat est particulier : c'est une cymbale charleston. On NE
        // déclenche PAS de son sur mouseleave (un pad à déclenchement
        // manuel ne réagit qu'au clic). Le mouseup/touchend restent
        // câblés pour appeler triggerPadUp (no-op sur tous les pads).
        const isHat = pad.openNote;
        el.addEventListener('mousedown', () => triggerPadDown(pad));
        el.addEventListener('mouseup', () => { if (isHat) triggerPadUp(pad); });
        el.addEventListener('touchstart', (e) => { e.preventDefault(); triggerPadDown(pad); }, { passive: false });
        el.addEventListener('touchend', (e) => { e.preventDefault(); if (isHat) triggerPadUp(pad); }, { passive: false });
        el.addEventListener('touchcancel', () => { if (isHat) triggerPadUp(pad); });

        stage.appendChild(el);
    });

    // Pédale charleston : clic = toggle mémoire UP/DOWN, AUCUN son.
    const hatPad = window.SEQUENCER_CFG.DRUM_PADS.find((p) => p.name === 'Hat');
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

    pedal.addEventListener('mousedown', (e) => {
        e.preventDefault();
        hatPedalState = hatPedalState === 'UP' ? 'DOWN' : 'UP';
        label.textContent = hatPedalState;
    });

    stage.appendChild(pedal);
}

window.SEQUENCER_DRUMKIT = {
    initDrumKit, triggerPadDown, triggerPadUp, flashPad, updateHatPedalLabel,
    get hatPedalState() { return hatPedalState; },
    set hatPedalState(v) { hatPedalState = v; },
};

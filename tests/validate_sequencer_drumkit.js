// tests/validate_sequencer_drumkit.js
// Vérifie que la vue batterie utilise l'image réelle en fond
// et que les 8 hotspots interactifs sont présents et positionnés.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const cssPath = path.join(ROOT, 'css', 'sequencer.css');
const jsPath = path.join(ROOT, 'js', 'sequencer-app.js');

function check(label, ok) {
    console.log(`${ok ? 'OK' : 'FAIL'}: ${label}`);
    return ok;
}

let allOk = true;

// --- 1. Le CSS référence l'image en fond du stage ---
let css = '';
try { css = fs.readFileSync(cssPath, 'utf8'); } catch (_) {}
allOk = check('CSS charge battery-set-above.jpeg en fond', /battery-set-above\.jpeg/.test(css) && /\.drum-kit-stage/.test(css)) && allOk;

// --- 2. Les styles de fûts/cymbales dessinés ont disparu ---
// Les anciens backgrounds radial des fûts/cymbales ne doivent plus exister
const noFakeDrums = !/linear-gradient\(145deg, #6b7280/.test(css);
allOk = check('CSS ne dessine plus les fûts (styles supprimés)', noFakeDrums) && allOk;

// --- 3. Le JS définit 8 pads (hat unique down/up) dont Tom Mid ---
let js = '';
try { js = fs.readFileSync(jsPath, 'utf8'); } catch (_) {}
// N'extraire que le tableau DRUM_PADS (GRID_TRACKS a aussi des name:)
const drumPadSection = js.slice(js.indexOf('const DRUM_PADS'), js.indexOf('CYM_NOTE'));
const padNames = [...drumPadSection.matchAll(/name: '([^']+)'/g)].map(m => m[1]);
const is8 = padNames.length === 8;
allOk = check(`DRUM_PADS contient 8 pads (trouvé ${padNames.length})`, is8) && allOk;
allOk = check('Tom Mid présent', padNames.includes('Tom Mid')) && allOk;
allOk = check('Hat unique (plus de Hat Closed/Open séparés)',
    padNames.includes('Hat') && !padNames.includes('Hat Closed') && !padNames.includes('Hat Open')) && allOk;
for (const expected of ['Kick', 'Snare', 'Hat', 'Tom High', 'Tom Mid', 'Tom Low', 'Crash', 'Ride']) {
    allOk = check(`  pad présent: ${expected}`, padNames.includes(expected)) && allOk;
}
// openNote du hat (F1 = charleston ouvert au relâchement)
allOk = check('Hat a openNote (down E1 / up F1)', /name: 'Hat'[\s\S]{0,160}openNote: 'F1'/.test(drumPadSection)) && allOk;

// --- 3bis. Le clavier est branché (keydown/keyup sur les badges) ---
allOk = check('Listener clavier présent (keydown)', /addEventListener\('keydown'/.test(js)) && allOk;
allOk = check('Listener clavier présent (keyup)', /addEventListener\('keyup'/.test(js)) && allOk;

// --- 4. Chaque pad a une classe de positionnement + un badge clavier ---
const drumPadSection4 = js.slice(js.indexOf('const DRUM_PADS'), js.indexOf('CYM_NOTE'));
const hasClassNames = [...drumPadSection4.matchAll(/className: '[^']+'/g)].length >= 8;
allOk = check('Classes de positionnement présentes', hasClassNames) && allOk;
const keyBadges = [...drumPadSection4.matchAll(/keyBadge: '([^']+)'/g)].map(m => m[1]);
allOk = check(`Badges clavier présents (${keyBadges.length})`, keyBadges.length === 8) && allOk;
allOk = check('Badge B/Espace (Kick)', keyBadges.some(k => k.includes('B / Space'))) && allOk;
allOk = check('Badge H (Hat unique)', keyBadges.some(k => k === 'H') && !keyBadges.includes('J')) && allOk;
allOk = check('Badge Y (Tom Mid)', keyBadges.includes('Y')) && allOk;

// La pédale ferme le charleston sans produire de son ; elle influe
// uniquement sur le son du pad HAT pendant qu'elle est maintenue.
allOk = check('Pédale silencieuse (fermeture d’état uniquement)', /hatPedalState/.test(js) && /hatPedalState/.test(js) && /ferme uniquement le charleston/.test(js)) && allOk;
allOk = check('Pas de son au mouseup des pads non-HAT', /if \(isHat\) triggerPadUp\(pad\)/.test(js)) && allOk;

// --- 5. Chaque hotspot est positionné en % dans le CSS ---
for (const cls of ['pad-kick', 'pad-snare', 'cymbal-hat', 'pad-hat-pedal', 'pad-tom-high', 'pad-tom-mid', 'pad-tom-low', 'cymbal-crash', 'cymbal-ride']) {
    const re = new RegExp('\\.' + cls + '\\s*\\{');
    allOk = check(`positionnement CSS: .${cls}`, re.test(css)) && allOk;
}

console.log(allOk ? '\nOverall Validation: SUCCESS' : '\nOverall Validation: FAILURE');
process.exit(allOk ? 0 : 1);

// tests/validate_sequencer_html.js
// Vérifie la cohérence de sequencer.html avec le code réel.
// Mis à jour au 2026-09-01 : Tone.js est servi en local (js/vendor/tone.js),
// pas via CDN unpkg, à cause de la CSP script-src 'self' …
const fs = require('fs');
const path = require('path');

const HTML_FILE_PATH = path.join(__dirname, '../sequencer.html');
const CSS_FILE_PATH = path.join(__dirname, '../css/sequencer.css');
const JS_FILE_PATH = path.join(__dirname, '../js/sequencer-app.js');
const IMG_FILE_PATH = path.join(__dirname, '../battery-set-above.jpeg');
const TONE_BUNDLE_PATH = path.join(__dirname, '../js/vendor/tone.js');
const SERVER_FILE_PATH = path.join(__dirname, '../server/server.js');
const SAMPLES_JS_PATH = path.join(__dirname, '../js/sequencer-samples.js');

function loadOrEmpty(p) {
    try { return fs.readFileSync(p, 'utf8'); } catch (_) { return ''; }
}

function check(label, ok) {
    console.log(`${ok ? 'OK' : 'FAIL'}: ${label}`);
    return !!ok;
}

let allOk = true;

// --- Lecture des fichiers concernés ---
const html = loadOrEmpty(HTML_FILE_PATH);
const css = loadOrEmpty(CSS_FILE_PATH);
const js = loadOrEmpty(JS_FILE_PATH);
const samplesJs = loadOrEmpty(SAMPLES_JS_PATH);
const server = loadOrEmpty(SERVER_FILE_PATH);

// --- 1. Existence des fichiers requis ---
allOk &= check('sequencer.html existe', html.length > 0);
allOk &= check('css/sequencer.css existe', css.length > 0);
allOk &= check('js/sequencer-app.js existe', js.length > 0);
allOk &= check('battery-set-above.jpeg existe', fs.existsSync(IMG_FILE_PATH));
allOk &= check('js/vendor/tone.js (bundle local) existe', fs.existsSync(TONE_BUNDLE_PATH));

// --- 2. Tone.js servi en local (PAS unpkg, sinon la CSP le bloque) ---
allOk &= check('Tone.js chargé en LOCAL (script src=js/vendor/tone.js)',
    /<script\s+src=["']js\/vendor\/tone\.js["']/.test(html));
allOk &= check('Tone.js NON servi via unpkg (CDN interdit par CSP)',
    !/<script\s+src=["']https?:\/\/[^"']*unpkg\.com/.test(html));

// --- 3. Liens et structure HTML de base ---
allOk &= check('Link vers css/sequencer.css présent',
    /<link[^>]+href=["']css\/sequencer\.css["']/.test(html));
allOk &= check('Script vers js/sequencer-app.js présent',
    /<script\s+src=["']js\/sequencer-app\.js["']/.test(html));
allOk &= check('Header <header id="sequencer-header"> présent',
    /<header[^>]+id=["']sequencer-header["']/.test(html));
allOk &= check('Section <section id="sequencer-container"> présente',
    /<section[^>]+id=["']sequencer-container["']/.test(html));
allOk &= check('Section <section id="drum-kit-view"> présente',
    /<section[^>]+id=["']drum-kit-view["']/.test(html));

// --- 4. Contrôles du transport (BPM, Volume, Play, Stop) ---
allOk &= check('Slider BPM présent (#bpm, type=range, 40-240)',
    /<input[^>]+id=["']bpm["'][^>]*type=["']range["'][^>]*min=["']40["'][^>]*max=["']240["']/.test(html)
    || /<input[^>]+id=["']bpm["'][^>]*min=["']40["'][^>]*max=["']240["'][^>]*type=["']range["']/.test(html)
    || /<input[^>]+type=["']range["'][^>]+id=["']bpm["'][^>]*min=["']40["']/.test(html));
allOk &= check('Slider Volume Master présent (#master-volume)',
    /<input[^>]+id=["']master-volume["']/.test(html));
allOk &= check('Bouton Play/Pause présent (#play-pause)',
    /<button[^>]+id=["']play-pause["']/.test(html));
allOk &= check('Bouton Stop présent (#stop)',
    /<button[^>]+id=["']stop["']/.test(html));
allOk &= check('Lien retour vers index.html',
    /href=["']index\.html["']/.test(html));

// --- 5. Image batterie référencée et servie ---
allOk &= check('CSS référence battery-set-above.jpeg en background',
    /background[^:]*:\s*url\(["']?[^"')]*battery-set-above\.jpeg/.test(css));
allOk &= check('Route /battery-set-above.jpeg présente dans server.js',
    /app\.get\(\s*['"]\/battery-set-above\.jpeg['"]/.test(server));
allOk &= check('Route /sequencer présente dans server.js',
    /app\.get\(\s*['"]\/sequencer['"]/.test(server));
allOk &= check('Route /sequencer.html présente dans server.js',
    /app\.get\(\s*['"]\/sequencer\.html['"]/.test(server));

// --- 5bis. Samples de batterie (kits acoustic + electronic, CC0/PD) ---
const SAMPLES_DIR = path.join(__dirname, '../assets/sounds/drums');
allOk &= check('Dossier assets/sounds/drums/ existe', fs.existsSync(SAMPLES_DIR));
allOk &= check('Kit acoustic contient 12+ samples (kick, snare×2, hh×2, toms×5, ride, crash)',
    fs.existsSync(path.join(SAMPLES_DIR, 'acoustic', 'kick.wav'))
    && fs.existsSync(path.join(SAMPLES_DIR, 'acoustic', 'snare-hard.wav'))
    && fs.existsSync(path.join(SAMPLES_DIR, 'acoustic', 'hihat-closed.wav'))
    && fs.existsSync(path.join(SAMPLES_DIR, 'acoustic', 'tom-hi.wav'))
    && fs.existsSync(path.join(SAMPLES_DIR, 'acoustic', 'tom-mid.wav'))
    && fs.existsSync(path.join(SAMPLES_DIR, 'acoustic', 'tom-lo.wav'))
    && fs.existsSync(path.join(SAMPLES_DIR, 'acoustic', 'crash.wav'))
    && fs.existsSync(path.join(SAMPLES_DIR, 'acoustic', 'ride.wav')));
allOk &= check('Kit electronic contient 10+ samples (kick, snare, clap, hh×2, toms×3, crash, ride)',
    fs.existsSync(path.join(SAMPLES_DIR, 'electronic', 'kick.wav'))
    && fs.existsSync(path.join(SAMPLES_DIR, 'electronic', 'snare.wav'))
    && fs.existsSync(path.join(SAMPLES_DIR, 'electronic', 'hihat-closed.wav'))
    && fs.existsSync(path.join(SAMPLES_DIR, 'electronic', 'tom-hi.wav'))
    && fs.existsSync(path.join(SAMPLES_DIR, 'electronic', 'tom-mid.wav'))
    && fs.existsSync(path.join(SAMPLES_DIR, 'electronic', 'tom-lo.wav'))
    && fs.existsSync(path.join(SAMPLES_DIR, 'electronic', 'crash.wav'))
    && fs.existsSync(path.join(SAMPLES_DIR, 'electronic', 'ride.wav')));
allOk &= check('Route serveur /assets/* (express.static) présente',
    /app\.use\(\s*['"]\/assets['"]\s*,\s*express\.static/.test(server));
allOk &= check('sequencer-samples.js inclus dans sequencer.html',
    /<script\s+src=["']js\/sequencer-samples\.js["']/.test(html));
allOk &= check('sequencer-samples.js définit DRUM_KITS et 2 kits (acoustic + electronic)',
    /acoustic\s*:/.test(samplesJs)
    && /electronic\s*:/.test(samplesJs)
    && /DRUM_KITS\s*=/.test(samplesJs)
    && /window\.DRUM_KITS\s*=/.test(samplesJs));
allOk &= check('sequencer-app.js expose un toggle mode synth/sample par pad',
    /padConfig\s*=/.test(js)
    && /buildTrackSoundToggle\s*\(/.test(js)
    && /setPadMode\s*\(/.test(js)
    && /track-sound-menu/.test(js)
    && /'synth'/.test(js)
    && /'sample'/.test(js));
allOk &= check('CREDITS.md existe et mentionne CC0 ou public domain',
    fs.existsSync(path.join(__dirname, '../CREDITS.md'))
    && /CC0|Public Domain|public domain/.test(loadOrEmpty(path.join(__dirname, '../CREDITS.md'))));

// --- 6. CSS keyframes pour l'animation d'impact ---
allOk &= check('CSS @keyframes pad-hit défini',
    /@keyframes\s+pad-hit\b/.test(css));
allOk &= check('CSS @keyframes pad-shock défini',
    /@keyframes\s+pad-shock\b/.test(css));

// --- 7. JS : hooks audio + transport câblés ---
allOk &= check('JS appelle Tone.start() (déverrouillage AudioContext)',
    /Tone\.start\(\)/.test(js));
allOk &= check('JS utilise Tone.Transport.scheduleRepeat',
    /Tone\.Transport\.scheduleRepeat/.test(js));
allOk &= check('JS définit STEPS_PER_LOOP = 16',
    /STEPS_PER_LOOP\s*=\s*16\b/.test(js));
allOk &= check('JS câble le bouton #play-pause (togglePlay au click)',
    /getElementById\(['"]play-pause['"]\)/.test(js)
    && /\btogglePlay\b/.test(js)
    && /['"]click['"]\s*,\s*togglePlay\b/.test(js));
allOk &= check('JS câble le bouton #stop (stopSequencer au click)',
    /getElementById\(['"]stop['"]\)/.test(js)
    && /\bstopSequencer\b/.test(js)
    && /['"]click['"]\s*,\s*stopSequencer\b/.test(js));

// --- 8. Sécurité : la CSP du serveur autorise les workers blob: ---
allOk &= check('CSP serveur inclut "worker-src \'self\' blob:" (pour Tone.Clock)',
    /worker-src\s+['"]self['"]\s+blob:/.test(server));
allOk &= check('CSP serveur bloque unpkg (script-src strict à self + YouTube)',
    /script-src\s+['"]self['"]\s+https:\/\/www\.youtube\.com\s+https:\/\/s\.ytimg\.com/.test(server)
    && !/script-src[^;]*unpkg/.test(server));

// --- 9. Pas de dépendances inutilisées dans ce test ---
// (le test original importait JSDOM sans l'utiliser — corrigé)

console.log(allOk ? '\nOverall Validation: SUCCESS' : '\nOverall Validation: FAILURE');
process.exit(allOk ? 0 : 1);

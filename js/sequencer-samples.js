// js/sequencer-samples.js
// Manifest des samples de batterie par kit et par note.
// Tous les samples sont servis localement depuis /assets/sounds/drums/<kit>/.
// CC0 / Public Domain — voir CREDITS.md à la racine.
//
// Format :
//   DRUM_KITS.kitName = { friendlyName, samples: { 'C1': 'kick.wav', 'D1': 'snare.wav', ... } }
//   DRUM_KITS.kitName.notes = { 'Kick': 'C1', 'Snare': 'D1', ... }  (mapping pad → note)
//
// Le séquenceur charge ce manifest pour offrir un toggle par pad
// "Synth (Tone.MembraneSynth / MetalSynth) / Sample (Tone.Player WAV)".

const DRUM_KITS = {
    acoustic: {
        friendlyName: 'Acoustique (Gretsch)',
        basePath: 'assets/sounds/drums/acoustic/',
        // Le sample à utiliser par note. Les notes correspondent aux
        // constantes GRID_TRACKS dans sequencer-app.js.
        samples: {
            'C1': 'kick.wav',           // Kick
            'D1': 'snare-hard.wav',     // Snare (rock)
            'E1': 'hihat-closed.wav',   // Hat Closed
            'F1': 'hihat-open.wav',     // Hat Open
            'G1': 'tom-hi.wav',         // Tom High
            'A1': 'tom-mid.wav',        // Tom Mid
            'B1': 'tom-lo.wav',         // Tom Low (floor)
            'C2': 'crash.wav',          // Crash
            'D2': 'ride.wav',           // Ride
        },
        // Sample alternatif disponible par note (utilisé par l'UI pour proposer un choix)
        alternates: {
            'D1': 'snare-brush.wav',    // Snare (jazz, plus doux)
        },
    },
    electronic: {
        friendlyName: 'Électronique (LM-2)',
        basePath: 'assets/sounds/drums/electronic/',
        samples: {
            'C1': 'kick.wav',
            'D1': 'snare.wav',
            'E1': 'hihat-closed.wav',
            'F1': 'hihat-open.wav',
            'G1': 'tom-hi.wav',
            'A1': 'tom-mid.wav',
            'B1': 'tom-lo.wav',
            'C2': 'crash.wav',
            'D2': 'ride.wav',
        },
        alternates: {
            'C2': 'clap.wav',           // Clap disponible en alternative au crash
        },
    },
};

// Liste des kits pour itérer dans l'UI
const KIT_LIST = ['acoustic', 'electronic'];

// Helper : construit l'URL absolu d'un sample à partir de son nom de fichier.
// Le path est relatif à la racine du serveur (servi via app.use('/assets', ...)).
function sampleUrl(kitName, filename) {
    const kit = DRUM_KITS[kitName];
    if (!kit) throw new Error('Kit inconnu: ' + kitName);
    return kit.basePath + filename;
}

// Exposé globalement (script non-module, comme le reste du séquenceur)
if (typeof window !== 'undefined') {
    window.DRUM_KITS = DRUM_KITS;
    window.KIT_LIST = KIT_LIST;
    window.sampleUrl = sampleUrl;
}

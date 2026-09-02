# Plan d'implémentation : Séquenceur & Boîte à Rythmes autonome (`sequencer.html`)

> **Référence :** Issue GitHub [#2](https://github.com/agaldemas/yt-music-web-mixer/issues/2)
> **Objectif :** Créer une page autonome `sequencer.html` offrant un séquenceur pas-à-pas (step sequencer) en haut et une boîte à rythmes interactive avec vue batterie acoustique vue du dessus (pads/cymbales circulaires jouables manuellement) en bas, propulsée par Tone.js, avec support de sons synthétisés Tone.js et d'échantillons personnalisés (fichiers audio locaux/MP3/WAV).

---

## 🎯 Spécifications & Contraintes

1. **Page autonome (`sequencer.html`)** :
   - Fonctionne en autonome (aucun serveur obligatoire, ouvrable directement via `file://` ou servi par le serveur local Express existant).
   - Incluse dans l'allowlist du serveur statique `server/server.js` (`app.get('/sequencer.html', ...)`).
   - Lien de navigation dans le header d'en-tête (entre le mixer `index.html` et le séquenceur `sequencer.html`).

2. **Moteur Audio (Tone.js)** :
   - Chargement de Tone.js via CDN (ex: `https://cdnjs.cloudflare.com/ajax/libs/tone/14.8.49/Tone.js` ou jsDelivr) avec fallback propre.
   - Initialisation / déverrouillage de l'AudioContext Tone.js sur le premier geste utilisateur (respect strict des politiques autoplay).
   - Gestion de master volume global (slider) et tempo BPM réglable (40 - 240 BPM).

3. **Séquenceur pas-à-pas (Haut de page)** :
   - Matrice 16 pas (16 steps = 1 mesure en 4/4 à la double croche ou 4 temps de 4 doubles).
   - 8 pistes par défaut (Kick, Snare, Hi-Hat Closed, Hi-Hat Open, Tom High, Tom Mid, Tom Low, Crash / Ride).
   - Indicateur visuel du pas actif (playhead synchronisé avec le transport Tone.js).
   - Boutons de transport : Play/Stop, Pause, Clear, Randomize / Preset beats (ex: Rock standard, Trap/Hip-hop, House 4-on-the-floor, Funk).
   - Réglages par piste : Volume, Mute, Solo, sélecteur de source (Tone.js Synth/Noise ou Custom Audio File).

4. **Chargement de fichiers audio personnalisés** :
   - Chaque piste / pad peut charger un fichier audio local (`<input type="file" accept="audio/*">`) ou Drag & Drop.
   - Décodage via `Tone.Player` / `Tone.Buffer` ou `AudioContext.decodeAudioData`.
   - Indicateur du nom de fichier chargé et bouton de réinitialisation vers le son de synthèse par défaut.

5. **Boîte à Rythmes / Kit Batterie vue du dessus (Bas de page)** :
   - Vue interactive de la batterie vue du dessus (inspirée de `battery-set-above.jpeg`).
   - Éléments circulaires stylisés et positionnés fidèlement à un kit de batterie :
     * **Grosse caisse (Kick)** au centre fond
     * **Caisse claire (Snare)** à gauche
     * **Toms (High, Mid, Floor tom)**
     * **Cymbales (Hi-Hat, Crash, Ride)** en haut à gauche et à droite
   - Déclenchement manuel par clic / touch et raccourcis clavier mappés (ex: `B`/`Space` = Kick, `S` = Snare, `H` = Hi-Hat, `T`/`Y` = Toms, `C` = Crash, `R` = Ride).
   - Rétroaction visuelle dynamique (illumination / onde de frappe à l'impact).

6. **Architecture de code (Vanilla JS)** :
   - Respect strict des principes KISS, YAGNI, SRP, DRY.
   - Fichiers dédiés :
     * `sequencer.html` : Structure HTML sémantique.
     * `css/sequencer.css` : Styles de la matrice 16 pas et de la batterie vue du dessus.
     * `js/sequencer-audio.js` : Moteur sonore Tone.js (synths, sample players, routing, transport).
     * `js/sequencer-ui.js` : Contrôles de la matrice de pas, presets, drag & drop de samples.
     * `js/drum-kit-view.js` : Composant interactif de la batterie vue du dessus + mapping clavier.
     * `js/sequencer-app.js` : Point d'entrée, orchestration et persistance (localStorage pour motifs & tempo).

---

## 📋 Découpage des Tâches

### Tâche 1 : Structure HTML & Layout général (`sequencer.html`)
- En-tête avec titre, lien retour vers le Mixer (`index.html`), master volume, tempo BPM, bouton Play/Stop.
- Section Séquenceur (haut) : grille 8 pistes × 16 pas, contrôles de piste, presets.
- Section Boîte à rythmes / Batterie (bas) : conteneur de la batterie vue du dessus avec les pads circulaires et cymbales.
- Ajout de l'accès dans `index.html` (bouton d'en-tête "🥁 Séquenceur") et dans `server/server.js` (allowlist de `sequencer.html` et `css/sequencer.css`).

### Tâche 2 : Styles CSS (`css/sequencer.css`)
- Thème sombre aligné sur l'esthétique du Mixer DJ (`css/styles.css`).
- Grille responsive pour la matrice 16 steps avec distinction visuelle par groupes de 4 pas (temps 1, 2, 3, 4).
- Design visuel de la batterie vue du dessus :
  * Fûts ronds (peaux blanches cerclées de métal/couleur).
  * Cymbales circulaires cuivrées/dorées.
  * Effets CSS d'impact/frappe (`active`, glow, translation légère).

### Tâche 3 : Moteur Audio Tone.js (`js/sequencer-audio.js`)
- Gestion du cycle de vie de `Tone.Context` (activation au premier clic).
- Instruments par défaut synthétisés avec Tone.js :
  * Kick : `Tone.MembraneSynth`
  * Snare : `Tone.NoiseSynth` + `Tone.MembraneSynth` combinés
  * Hi-Hats (Closed/Open) : `Tone.MetalSynth` / `Tone.NoiseSynth` avec enveloppes courtes/longues
  * Toms (High/Mid/Low) : `Tone.MembraneSynth` accordés
  * Crash & Ride : `Tone.MetalSynth`
- Module de chargement de samples custom : `Tone.Player` avec chargement depuis `File` / `Blob` (`URL.createObjectURL`).
- Routage audio vers un master bus avec contrôle de volume Tone.Volume et `Tone.Transport` cadencé au BPM.

### Tâche 4 : Matrice du Séquenceur & Presets (`js/sequencer-ui.js`)
- Rendu dynamique de la grille 8 × 16.
- Synchronisation avec `Tone.Transport.scheduleRepeat` pour allumer la colonne courante (playhead).
- Événements de clic sur les pas pour basculer ON/OFF (avec vélocité ou accent).
- Presets rythmiques intégrés (Rock, Funk, House, Trap, Disco).
- Fonctions Clear, Random, et persistance dans `localStorage` (sauvegarde automatique du pattern).

### Tâche 5 : Batterie interactive vue du dessus (`js/drum-kit-view.js`)
- Placement SVG/CSS précis des fûts, cymbales et pédales d'après `battery-set-above.jpeg`.
- Liaison d'événements Pointer/Touch vers le moteur audio (`playPad(instrumentId)`).
- Gestionnaire de raccourcis clavier (touches physiques affichées en petit sur chaque pad pour guider l'utilisateur).
- Animation d'impact et synchronisation bidirectionnelle : quand le séquenceur joue un coup, le pad correspondant sur la batterie clignote également.

### Tâche 6 : Importation de fichiers audio (`local-load` / custom samples)
- Bouton / modal d'import par piste pour charger des fichiers audio (.wav, .mp3, .ogg, .flac).
- Drag & drop de fichier audio directement sur un pad de batterie ou sur l'en-tête d'une piste.
- Réinitialisation facile vers le synthé par défaut.

### Tâche 7 : Tests, validation & documentation
- Tests unitaires et d'intégration automatisés (`tests/test_sequencer.js` dans la suite `npm test`).
- Vérification du bon fonctionnement sans serveur (`file://`) et avec serveur (`npm start`).
- Mise à jour de `tasks-list.md`, `CLAUDE.md`, et documentation utilisateur.

---

## 🔍 Validation attendue
- Lancement de `npm test` : tous les tests existants et nouveaux passent avec succès.
- Vérification navigateur : ouverture de `sequencer.html`, lecture d'un pattern 16 pas, réglage tempo/volume, frappe manuelle sur les fûts et cymbales, chargement d'un MP3 personnalisé dans un pad.

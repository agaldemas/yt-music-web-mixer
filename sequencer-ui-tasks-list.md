# 📋 Séquenceur & Boîte à Rythmes — Tâches d'implémentation

État du projet au 2026-09-01. Référence : Issue GitHub [#2](https://github.com/agaldemas/yt-music-web-mixer/issues/2) et `CLAUDE.md`.

## Légende

- [x] Terminé · [~] Partiellement / en cours · [ ] À faire

---

## 1. 🏗️ Architecture & Infrastructure autonome

- [x] **Page HTML dédiée `sequencer.html`** :
  - [x] Structure sémantique autonome (fonctionne en `file://` mais **uniquement** via le serveur, à cause de la CSP et de la limitation CORS du `<audio crossOrigin>`).
  - [x] **Tone.js servi en local** (`js/vendor/tone.js`, ~350 Ko) — le CDN `unpkg.com` est bloqué par la CSP `script-src 'self' …`.
  - [x] En-tête avec titre, tempo BPM (slider 40–240, valeur affichée), Master Volume (0–100 %, valeur affichée), boutons **Play/Pause + Stop**, et lien retour vers le Mixer (`index.html`).
  - [x] Section supérieure : Matrice du Séquenceur 16 pas.
  - [x] Section inférieure : Vue interactive de la batterie vue du dessus.
- [x] **Intégration au serveur Express local (`server/server.js`)** :
  - [x] Route `GET /sequencer` (et `GET /sequencer.html` pour matcher le lien dans `index.html`).
  - [x] Route `GET /battery-set-above.jpeg` (image de fond de la scène batterie).
  - [x] Directive CSP `worker-src 'self' blob:` ajoutée (Tone.js crée un Worker interne pour son horloge via `blob:` URL ; sans cette directive, le worker tombait sur le fallback `script-src` qui n'autorise pas `blob:`). Voir `SECURITY.md` pour la justification complète.
- [x] **Liaison d'accès dans le Mixer (`index.html`)** :
  - [x] Bouton d'accès rapide « 🥁 Séquenceur » dans l'en-tête de `index.html` (ligne 14 : `<a href="sequencer.html">`).

---

## 2. 🎨 Styles & Design UI (`css/sequencer.css`)

- [x] **Thème sombre & Responsive** :
  - [x] Cohérence graphique avec `css/styles.css` (palette sombre #0f1115 / #15181f, accents néon/or/cuivre).
  - [x] Disposition en 2 blocs principaux (Séquenceur en haut, Batterie vue du dessus en bas).
  - [x] Media queries `≤ 900px` et `≤ 560px` (responsive mobile, pads réagencés).
- [x] **Matrice de pas (Step Sequencer UI)** :
  - [x] Grille 9 pistes × 16 pas avec séparation visuelle des 4 temps (groupes de 4 doubles-croches via `.step:nth-child(4n+1)`).
  - [x] Styles des boutons de pas (état inactif, actif/allumé `.active`, surbrillance du playhead `.playing`).
  - [x] En-têtes de piste : **nom + contrôles Volume/Mute/Solo + bouton de choix du son** (cf. §4.2 — `track-mix` à gauche, `track-name`, `track-sound-toggle` à droite, dans cet ordre). L'import audio utilisateur reste à faire (voir §6).
- [x] **Batterie vue du dessus (Drum Kit Top-View UI)** :
  - [x] Rendu basé sur l'image réelle `battery-set-above.jpeg` en fond de scène (les fûts/cymbales sont DANS l'image, pas en CSS).
  - [x] Composition conforme à l'image : 3 toms (High, Mid + Low/Floor à droite), caisse claire, grosse caisse (pédale), charleston à gauche (2 cymbales + pédale), 2 cymbales (Crash + Ride).
  - [x] Hotspots interactifs (divs transparents `.drum-pad`) positionnés précisément sur chaque instrument via pourcentages et `aspect-ratio: 2550/1664` du stage.
  - [x] Badges `<kbd class="key-badge">` indiquant les touches de raccourci clavier sur chaque hotspot.
  - [x] **Effets CSS de frappe** : `@keyframes pad-hit` (brightness + drop-shadow + scale 1.14→1 en 0.18 s) + `@keyframes pad-shock` (anneau de choc qui s'étend via `::after`).
  - [x] Image `battery-set-above.jpeg` ajoutée à l'allowlist serveur (route `GET /battery-set-above.jpeg`).
  - [x] Mode debug visuel : classe `body.debug-zones` qui révèle le contour de chaque hotspot (utile pour calibrer les positions).

---

## 3. 🔊 Moteur Audio Tone.js (intégré dans `js/sequencer-app.js`)

- [x] **Initialisation & Transport** :
  - [x] Déverrouillage de l'AudioContext via `await Tone.start()` au premier clic sur Play (respect strict des politiques autoplay).
  - [x] `Tone.Transport` cadencé au BPM (slider 40–240, défaut 120) ; `Tone.Destination.volume` contrôlé par le slider Master (0–100 %).
  - [x] `Tone.Transport.scheduleRepeat(…, '16n')` cadence le séquenceur au pas de 1/16e de note.
  - [x] Warning console `ScriptProcessorNode is deprecated` : harmless, fallback interne de Tone.js 14.7.77 ; sans impact sur le son.
- [x] **Génération sonore par synthèse Tone.js (Sons par défaut)** :
  - [x] **Fûts (Kick, Snare, Toms)** : `Tone.MembraneSynth` partagé par note, envelope ADSR courte (attack 0.001, decay 0.4, sustain 0.01, release 1.4).
  - [x] **Cymbales (Hat Closed/Open, Crash, Ride)** : `Tone.MetalSynth` (harmonicity 5.1, modulation 32, resonance 4000 Hz), envelope 0.4 s.
  - [x] **Mémoire de pédale charleston** (`hatPedalState` UP/DOWN) : influe sur la note jouée (E1 fermée vs F1 ouverte) et la durée (16n vs 8n). Toggle au clic sur la zone pédale.
  - [x] Cache de synthétiseurs par note (`SYNTH_CACHE: Map<note, synth>`) pour éviter de recréer les instances.
- [x] **Bibliothèque de samples WAV (`assets/sounds/drums/`, 5.6 Mo, CC0/PD)** :
  - [x] **2 kits inclus** : `acoustic/` (Gretsch via TidalCycles/Dirt-Samples, CC0) et `electronic/` (LM-2 via oramics/sampled, Public Domain).
  - [x] **22 samples** au total : kick, snare×3 (hard/brush/electronic), hihat×2, toms×6 (hi/mid/lo × 2 kits + brush-hi/lo), crash×2, ride×2, clap.
  - [x] **Toggle par pad** : chaque pad peut être en mode `synth` (Membrane/Metal) ou `sample` (Tone.Player WAV), via la barre de configuration sous la scène batterie.
  - [x] **Sélecteur de kit global** : dropdown `Acoustique (Gretsch)` / `Électronique (LM-2)` qui re-route tous les pads en mode `sample` vers le kit choisi.
  - [x] **Manifest** dans `js/sequencer-samples.js` (mapping `DRUM_KITS[kit].samples[note] → filename`).
  - [x] **Cache de players** (`PLAYER_CACHE: Map<note, {player, currentUrl}>`) avec rechargement auto quand l'URL change.
  - [x] `CREDITS.md` à la racine documente les sources et licences.
  - [ ] **Lecteur d'échantillons personnalisés (Custom Samples uploadés par l'utilisateur)** — *non implémenté* (voir §6).

---

## 4. 🎛️ Séquenceur pas-à-pas & Presets (`js/sequencer-app.js`)

- [x] **Gestion de la matrice 16 pas** :
  - [x] Rendu dynamique et interactions (clic pour activer/désactiver un pas → toggle classe `.active`).
  - [x] État interne `pattern[trackIndex][stepIndex] = boolean`, resynchronisé depuis le DOM après chaque clic (`syncPatternFromDOM`).
  - [x] Curseur de lecture (playhead) jaune via `.step.playing` mis à jour à chaque pas du scheduler.
- [x] **Contrôles de lecture** :
  - [x] **Play / Pause** (toggle sur le bouton `#play-pause`, label dynamique).
  - [x] **Stop** : remet le séquenceur au pas 0, libère le `scheduleRepeat`, label retour à "Play".
  - [x] Bouton **🗑 Clear** : retire `.active` de tous les `.step` puis `syncPatternFromDOM()` → `pattern[][]` à `false`. Idempotent, marche en lecture ou en pause. CSS gris neutre distinct du rouge Stop.
  - [x] Bouton **🎲 Randomize** : pattern musicalement sensé (kick 4-on-the-floor, snare backbeat, hat 50% pas pairs, open hat rare, toms 0-1 sur impairs, etc.) — **déterministe** via PRNG mulberry32 seedé `0xC0FFEE` (même clic = même résultat, ~18% de densité vs ~50% pour du bruit blanc).
  - [x] Sélecteur de **presets d'usine** 🎵 (à côté de Rythmes Musicca) : 5 genres codés en dur dans `js/factory-presets.js` — Rock 4/4 (110), House/Electro (124), Trap/Hip-hop (140), Funk/Disco (118), Reggae/Dub (72, one-drop kick 0+8 / snare 12 / hat offbeats 2-6-10-14 / tom high 3+11). Persistance `ytwm_activeFactoryPreset`.
- [x] **Contrôles avancés par piste** (Volume / Mute / Solo par piste) — voir §4.2.

### 4.1 🥁 Presets « Rythmes » inspirés de Musicca (`https://www.musicca.com/fr/boite-a-rythmes` — bouton « Rythmes »)

Source extraite le 2026-09-03 depuis `drum-machine.min.js` (Presets = 20 entrées, format 7 pistes Musicca → mapping 9 pistes locale). Réf. image clip `clip_20260903_101459_1.png`.

#### 4.1.1 Extraction & modélisation des données

- [x] **Créer `js/musicca-presets.js` (module statique, 0 dépendance serveur)** : tableau `MUSICA_PRESETS` de 20 objets `{ id, name_fr, tempo, swing, rhythm, sequence: { hihatfod, sidetamlys, gulvtam, ride, hihat, lilletromme, stortromme } }` — séquences en chaînes `"0"/"1"/"2"` (0=vide, 1=hit normal, 2=variante : hihat ouvert / rimshot / tom grave). Fait le 2026-09-03.
- [x] **Documenter le mapping 7 → 9 pistes** : `stortromme→Kick C1`, `lilletromme→Snare D1` (1 ou 2 → actif), `hihat` → split `1→Hat Closed E1` / `2→Hat Open F1`, `sidetamlys→Tom High G1` (1) / `Tom Mid A1` (2), `gulvtam→Tom Low B1`, `ride→Ride D2`, `hihatfod` (pédale) OR sur E1, `Crash C2` toujours vide. Documenté dans `js/musicca-presets.js` + `references/musicca-presets.md`.
- [x] **Gérer les signatures** : `4/4=16 pas`, `3/4=12`, `6/8=12` (pad à 16 avec `0` pour notre grille fixe 16) ; conserver `rhythm` et `swing` dans le preset. `musicaToGrid()` padde à 16.
- [x] **Conserver le JSON brut `/tmp/musicca_presets.json`** comme référence d'extraction + référence dans skill `web-audio-sequencer-frontend/references/musicca-presets.md`.

#### 4.1.2 Moteur de chargement (mapping + tempo)

- [x] **Fonction `musicaToGrid(preset) → boolean[9][16]`** : convertit les 7 chaînes Musicca en `pattern` local (GRID_TRACKS order). Vérifiée via `vm` : Pop rock 6, Jazz 1/4, Disco 1, 3/4 paddé.
- [x] **Fonction `loadMusiccaPreset(id)`** : écrit `pattern[][]`, met à jour le DOM (`.step.active`), règle `BPM` (`preset.tempo`) + `Tone.Transport.bpm`, et `swing` (`preset.swing` → `Tone.Transport.swing` / `swingSubdivision`). Label bouton mis à jour.
- [x] **Gestion `swing=true` (Jazz 1-4)** : appliquer le swing Musicca via `Tone.Transport.swing = 0.3` ; 110 BPM conservé (pas de division 1.33).
- [x] **Ne pas toucher `server/server.js`** : chargement 100% client (fichier statique servi par l'allowlist existante).

#### 4.1.3 UI « Rythmes » (clone du dropdown Musicca)

- [x] **Ajouter bouton « Rythmes » dans `sequencer.html` header** (à côté de Paramètres/BPM), avec menu déroulant scrollable listant les 20 noms FR (Pop rock 1..6, Pop rock à 3/4, Pop rock à 6/8, Jazz 1..4, Funk 1..2, Disco 1..2, Hip-hop 1..2, Heavy metal 1..2). Inclus avant `sequencer-app.js`.
- [x] **Style `css/sequencer.css`** : dropdown réutilise `track-sound-menu` (bords arrondis + ombre), variantes `.rythmes-wrap`/`.rythmes-menu` (220px min, 320px max-height, scroll), fermeture exclusive.
- [x] **Interaction** : clic sur un item → `loadMusiccaPreset` + highlight `active`, fermeture du menu ; `populateRythmesMenu()` reconstruit au clic (`✓`/`○` exclusif), `menu.hidden` + `position:fixed` sous le bouton.
- [x] **Accessibilité** : `aria-haspopup="listbox"`, `aria-expanded`, `role="listbox"/"option"`, fermeture Échap / clic extérieur.

#### 4.1.4 Tests & validation

- [ ] **Test unitaire `tests/test_musicca_presets.js`** : charge `musicca-presets.js` en Node (jsdom), vérifie 20 presets, longueurs séquences, mapping `hihat 2 → Hat Open`, `sidetamlys 2 → Tom Mid`, `3/4` paddé à 16.
- [ ] **Test d'intégration `tests/validate_sequencer_presets.js`** : vérifie présence du bouton Rythmes, du fichier `js/musicca-presets.js` dans `sequencer.html`, et que `MUSICA_PRESETS.length===20`.
- [ ] **Validation manuelle** : charger `Pop rock 6` et `Jazz 1` depuis le serveur `http://127.0.0.1:5400/sequencer` et comparer visuellement à la capture Musicca (hihat `101010...`, kick/snare, ride).

### 4.2 🎚️ Contrôles par piste : Volume / Mute / Solo (2026-09-03)

Mini-panneau mix par piste injecté dans chaque `.track-name-wrap`, dans l'ordre suivant : `track-mix` (vol/mute/solo) à **gauche**, puis `track-name`, puis `track-sound-toggle` à droite. Le `space-between` du flex place le bouton son au bord droit, le mix colle au bord gauche — alignement propre, pas de chevauchement quelle que soit la largeur du sample affiché dans le bouton.

- [x] **Architecture audio par piste** : `TRACK_GAIN_NODES: Map<note, Tone.Gain>` + `TRACK_MIX_STATE: Map<note, {volume, muted, soloed}>`. `getOrCreateTrackGain(note)` crée le GainNode paresseusement. Tous les sources (synths `getSynthForNote`, samples `getPlayerForNote` / `preloadSample`) sont routées vers `trackGains[note]` au lieu de `Tone.Destination` direct.
- [x] **Logique de mix** : `applyTrackMix(note)` calcule le gain effectif : `eff = volume; if (muted) eff = 0; if (anySolo && !thisSolo) eff = 0`. `applyAllTrackMix()` recalcule toutes les pistes (utilisé quand un solo change car il affecte les autres). Ramp linéaire 20ms (`linearRampToValueAtTime`) anti-clic.
- [x] **UI** : `buildTrackMix(track)` construit dans chaque `.track-name-wrap` un `<div class="track-mix">` contenant un `<input type="range" class="track-volume">` (0-100%), un `<button class="track-mute">` (🔊/🔇), un `<button class="track-solo">` (S). Double-clic sur le slider → reset 100%.
- [x] **Helpers** : `setTrackVolume(note, percent)`, `toggleMute(note)`, `toggleSolo(note)`, `saveTrackMixStates()`, `restoreAllTrackMixStates()`.
- [x] **Persistance `localStorage`** : 3 clés `ytwm_trackVolume` / `ytwm_trackMute` / `ytwm_trackSolo` (Map sérialisée en JSON). Restaurées au boot par `restoreAllTrackMixStates()` appelé dans `DOMContentLoaded` après `initGrid()`.
- [x] **Layout élargi** : `.instrument-col` passe de `width: 320px` à `width: 400px` pour absorber nom + mix (vol 50 + mute 24 + solo 24 + gap 4 = ~110px) + bouton son (jusqu'à ~150px sur les noms de samples longs type "acoustic / hihat-closed") + padding.
- [x] **Test `tests/test_factory_presets.js`** : JSDOM test pour les presets d'usine (cf. §8).

### 4.3 🎵 Presets d'usine (factory presets, 2026-09-03)

- [x] **Nouveau module statique `js/factory-presets.js`** (zéro dépendance serveur) exportant `window.FACTORY_PRESETS` : 5 entrées hand-coded `{id, name_fr, tempo, swing, pattern[9][16]}`.
- [x] **Patterns** (vérifiés bit-à-bit en Node) :
  - **Rock 4/4** (110 BPM, 20 hits) : kick 4-on-the-floor (0,4,8,12), snare backbeat (4,12), hat 8e continue, ride sur 0,4,8,12.
  - **House / Electro** (124 BPM, 12 hits) : kick 4-on-the-floor, snare/clap sur 4,12, hat offbeat (2,6,10,14), open hat sur 6.
  - **Trap / Hip-hop** (140 BPM, 15 hits) : kick syncopé (0, 3, 7, 11), snare 4,12, hat triolets.
  - **Funk / Disco** (118 BPM, 17 hits) : kick (0, 7, 10), snare 4,12, hat 16e, open hat sur 14.
  - **🇯🇲 Reggae / Dub** (72 BPM, 9 hits, **OBLIGATOIRE**) : one-drop kick sur 0 et 8 uniquement, snare cross-stick sur 12, hat closed sur offbeats 2/6/10/14, tom high accent sur 3 et 11 (skank). Vérifié exact en Node.
- [x] **UI** : nouveau bouton `<button id="factory-btn">🎵 Presets ▾</button>` dans `.transport-controls` à côté de `.rythmes-wrap`, avec menu déroulant `.factory-menu` (mêmes styles `track-sound-menu` que Rythmes).
- [x] **Fonctions** : `loadFactoryPreset(id)`, `initFactoryPresetsMenu()`, `saveActiveFactoryPreset(nameFr)`, `loadActiveFactoryPresetId()`. Le preset actif est persisté (`ytwm_activeFactoryPreset`) et réappliqué au boot.
- [x] **Test `tests/test_factory_presets.js`** : 34/34 assertions (5 presets présents, dimensions 9×16, Reggae one-drop exact, 3 loads successifs donnent 3 grilles distinctes).

---

## 5. 🥁 Boîte à Rythmes / Kit Batterie vue du dessus

- [x] **Interactivité de frappe directe** :
  - [x] Déclenchement sonore instantané au clic souris (`mousedown`) sur chaque fût ou cymbale.
  - [x] Support des événements tactiles (`touchstart` / `touchend` / `touchcancel`) — *single-touch* uniquement ; multi-touch simultané sur plusieurs pads n'est pas testé mais les listeners sont attachés par pad, donc techniquement supporté.
  - [x] Zone **pédale charleston** séparée : clic toggle `hatPedalState` UP/DOWN, met à jour le label "UP"/"DOWN" sur la pédale.
  - [x] Zone HAT : joue selon l'état mémoire de la pédale (ouverte si UP, fermée si DOWN).
- [x] **Contrôles au clavier physique** (via `KEY_TO_PAD`) :
  - [x] `B` ou `Espace` : Kick (Grosse caisse)
  - [x] `S` : Snare (Caisse claire)
  - [x] `H` : Hat (Charleston, fermé à l'appui, ouvert au relâchement si pédale UP)
  - [x] `T` : Tom High
  - [x] `Y` : Tom Mid
  - [x] `G` : Tom Low
  - [x] `C` : Crash
  - [x] `R` : Ride
- [x] **Animation & feedback visuel** :
  - [x] Animation d'impact `flashPad(className)` qui ajoute/retire `.hit` sur le pad (reflow forcé via `void el.offsetWidth` pour rejouer l'animation CSS).
  - [x] L'onde de choc `pad-shock` se déclenche automatiquement via `.drum-pad.hit::after`.

---

## 6. 📁 Importation d'échantillons audio personnalisés

- [ ] **Sélection de fichiers locaux** — *non implémenté*. Le pipeline est prêt (`Tone.Player` + cache `PLAYER_CACHE`) : il suffira d'ajouter un `<input type="file">` par pad qui charge le fichier via `URL.createObjectURL()` et pousse dans `padConfig[note].sampleUrl`.
- [ ] **Drag & Drop** — *non implémenté*.
- [ ] **Gestion des sources** (affichage du nom, reset) — *non implémenté*.
- [ ] **Capture depuis le mixer (extraction d'une tranche de MP3)** — *à faire plus tard* (chantier séparé utilisant la route existante `/api/scratch/:id?t=N`).

> Le pipeline samples est en place (toggle Synth/Sample par pad, 2 kits CC0/PD inclus). Manque uniquement l'UI d'import utilisateur et la persistance localStorage du `padConfig`.

---

## 7. 🚀 Bootstrap, Orchestration & Persistance (`js/sequencer-app.js`)

- [x] **Bootstrap & Initialisation** :
  - [x] `initGrid()` : rend la matrice 9×16 dans `#step-matrix`.
  - [x] `initDrumKit()` : crée la scène `.drum-kit-stage`, positionne les 8 pads, ajoute la zone pédale charleston.
  - [x] Câblage des boutons Play/Stop et des sliders BPM/Master Volume sur le `DOMContentLoaded`.
  - [x] Garde `if (typeof Tone === 'undefined') return` sur tous les handlers audio pour ne pas planter si le bundle ne charge pas.
- [ ] **Persistance `localStorage`** — *en cours* : `padConfig` (mode/kit/sampleFile par note) sauvegardé et restauré au chargement.
  - [x] Sauvegarde dans `localStorage` au changement (`setPadMode` / `setPadSample`).
  - [x] Restauration au boot (`loadPadConfigFromStorage`) avant `initGrid` / `initDrumKit`.

### 7.1 Bugfixes layout 2 colonnes + alignement instrument/piste (2026-09-03)

- [x] **Variables CSS partagées `:root` `--seq-row-height: 44px`, `--seq-row-gap: 6px`, `--seq-grid-width: 900px`** : une seule source de vérité (hauteur, gap, largeur) → les 9 lignes de gauche alignées au pixel près avec les 9 lignes de droite.
- [x] **`.step-row` adopte `grid-template-columns: repeat(16, 1fr)`** (plus `calc(900px / 16)`) : 16 colonnes = 100% de `.steps-col` (900px), parfaitement superposées au `.drum-kit-stage` (900px) en dessous.
- [x] **`.step-row .step` vire `aspect-ratio: 1` → `auto`** + `overflow: hidden` : cellule fait 100% du grid cell (~52×44px) au lieu de forcer 52×52 qui débordait → plus de chevauchement des rows.
- [x] **`.drum-kit-stage` calé sur `var(--seq-grid-width)`** : batterie strictement alignée sous le bloc des 16 steps.

### 7.2 Bugfixes dropdowns de choix d'instrument + son du séquenceur (2026-09-03)

- [x] **Cause #1 — `initGrid()` créait `row.className='track-row'` mais ne l'attachait jamais au DOM** (variable orpheline). `syncPatternFromDOM()` et `applyGridToDOM()` faisaient `querySelectorAll('.track-row')` → 0 résultats → `pattern[]` jamais sync → pas de son. **Fix** : suppression du `row` orpheline, requêtes sur `.step-row`.
- [x] **Cause #2 — `gridEl.querySelector('.track-sound-toggle[data-note=…]')` interrogeait `#step-matrix`**, alors que les toggles vivent dans `#instrument-names`. **Fix** : helper `findTrackToggle(note)` qui interroge le bon scope (3 occurrences).
- [x] **`.step.active` → `.step-row .step.active`** : spécificité supérieure à `.step-row .step` qui écrasait l'orange.

### 7.3 Couleurs steps / playhead (2026-09-03)

- [x] **`.step.active` → orange vif `#f97316`** (au lieu du bleu historique `#3b82f6`).
- [x] **`.step.playing` → bordure bleue `#3b82f6`** (au lieu du jaune), `.step.active.playing` → bleu plein.
- [x] **`.step-row` ajoute `overflow: hidden`** sur les cellules.

### 7.4 Fix Tone.js "Start time must be strictly greater…" + BPM live (2026-09-03)

- [x] **Cause** : `player.start()` (sans arg, donc à `Tone.now()`) levait quand 2 hits consécutifs sur la même piste. **Fix** : `onSequencerStep(time)` propage le `time` du `scheduleRepeat` à `playNoteByConfig(note, time)` / `playHatNote(state, time)` → `player.start(time)` planifié sur le timestamp du step (strictement croissant par construction).
- [x] **`try/catch` autour de `triggerGridNote`** dans `onSequencerStep` : si une piste lève, le scheduler continue → le playhead ne se fige plus (« dérive » résolue).

### 7.5 BPM change "n'a aucun effet sans Stop+Play" (2026-09-03)

- [x] **Cause** : 3 chemins mettaient à jour `Tone.Transport.bpm.value` mais aucun ne re-schedule le `scheduleRepeat` existant. **Fix** : source unique `setBpm(newBpm)` (clamp + input + affichage + Transport + `rescheduleLoop()`) ; tous les chemins (slider `input`, `loadMusiccaPreset`, `togglePlay`) passent par `setBpm`. `rescheduleLoop()` est aussi source unique du `scheduleRepeat` (clear + re-create si `isPlaying`).

### 7.6 Premier son au reload ≠ son sauvegardé + désynchro preset Rythmes (2026-09-03)

- [x] **Cause #1 — `preloadSample()` jamais appelé au boot** : `padConfig` restauré (label UI OK), mais `Tone.Player` créé seulement au 1er `playNoteByConfig()` → 1er hit = synth fallback. **Fix** : `preloadAllSamples()` au `DOMContentLoaded` pour chaque `mode='sample'`.
- [x] **Cause #2 — preset Rythmes non persisté** : bouton retombait sur "Rythmes ▾" au reload. **Fix** : clé `localStorage` `ytwm_activePreset` (`saveActivePreset` / `loadActivePresetName`); `loadMusiccaPreset()` appelle `saveActivePreset()` systématiquement; au boot, si un preset est sauvegardé, on le réapplique (grille + BPM + label + highlight menu synchro dès le chargement).

---

## 8. 🧪 Tests, Validation & Documentation

- [x] **Tests automatisés existants** :
  - [x] `tests/validate_sequencer_html.js` : vérifie la présence de `step-matrix`, `drum-kit-view`, `sequencer-header`, des liens `css/sequencer.css` et `js/sequencer-app.js`.
  - [x] `tests/validate_sequencer_drumkit.js` : vérifie la présence de `css/sequencer.css` et `js/sequencer-app.js`.
  - [x] **Note** : ces tests NE sont PAS intégrés à `tests/run-all.js` (donc `npm test` ne les exécute pas). À intégrer dans un prochain pass.
- [x] **Test `tests/test_factory_presets.js`** : charge `js/factory-presets.js` en jsdom, vérifie 5 presets (dimensions 9×16, Reggae one-drop exact, 3 loads successifs donnent 3 grilles distinctes). 34/34 assertions OK.
- [ ] **Tests unitaires du moteur audio** (`tests/test_sequencer.js` avec Tone.js mocké) — *à faire*.
- [ ] **Vérification syntaxique** (`npm run check:syntax` pour `js/sequencer-app.js`) — *non automatisée, vérifiée à la main*.
- [x] **Vérifications fonctionnelles** :
  - [x] Test en `file://` : la page se charge mais **Tone.js nécessite un contexte sécurisé** — selon les navigateurs, `file://` peut bloquer certaines features Web Audio. Recommandé : passer par le serveur `http://127.0.0.1:5400/sequencer`.
  - [x] Test via serveur local Express : `http://127.0.0.1:5400/sequencer` → 200 OK, tous les assets servis, séquenceur fonctionnel.
  - [x] Validation responsive : media queries `≤ 900px` (header centré) et `≤ 560px` (pads redimensionnés).
- [x] **Documentation utilisateur** :
  - [x] Mise à jour du `README.md` et `README.fr.md` mentionnant la boîte à rythmes / séquenceur, les contrôles par piste (Volume/Mute/Solo), les boutons Clear/Randomize, les presets d'usine, le menu Rythmes Musicca.
  - [x] `SECURITY.md` créé (justification CSP, `worker-src 'self' blob:`, etc.).
  - [x] `CLAUDE.md` / `CLAUDE.fr.md` mis à jour (référence à `SECURITY.md`).

---

## 🐛 Bugs résolus pendant le développement

- [x] **Route manquante `/sequencer.html`** (404) → ajoutée à l'allowlist.
- [x] **`drumKitEl is not defined`** dans `initDrumKit()` → déclarations `const gridEl` / `const drumKitEl` ajoutées en tête de module.
- [x] **`getSynthForNote is not defined`** → fonction ajoutée avec cache `SYNTH_CACHE`, `MembraneSynth` pour fûts, `MetalSynth` pour cymbales.
- [x] **`hatPad is not defined`** dans `playHatNote` (variable locale à `initDrumKit`, hors scope) → résolu dynamiquement via `DRUM_PADS.find(p => p.name === 'Hat')`.
- [x] **Tone.js bloqué par CSP** (`script-src 'self' …` rejette `https://unpkg.com`) → bundle téléchargé dans `js/vendor/tone.js`, lien local dans `sequencer.html`.
- [x] **Worker de Tone.js bloqué par CSP** (fallback `script-src` ne couvre pas `worker-src`) → directive `worker-src 'self' blob:` ajoutée.
- [x] **Bouton Play ne déclenchait rien** → transport complet câblé : `Tone.start()`, `Tone.Transport.scheduleRepeat`, callbacks Play/Pause/Stop, scheduler 16 pas, playhead visuel.
- [x] **Curseur de lecture bloqué sur le pas 0** → confusion entre le `step` passé en argument (jamais fourni par `scheduleRepeat`) et l'incrément manuel de `currentStep`. Corrigé : `currentStep = (currentStep + 1) % 16` en fin de callback.
- [x] **Dropdown son figé sur le mode initial** (`populateSoundMenu` construit une fois au boot) → reconstruit au clic (`menu.innerHTML = ''` + `populateSoundMenu`) et bouton mis à jour via `updateToggleLabel` ; affichage exclusif `✓` (sélectionné) / `○` (autres).

---

## 📊 Point d'étape (au 2026-09-03)

**Ce qui marche** :
- Page `/sequencer` servie par le serveur Express, accessible via le bouton "🥁 Séquenceur" depuis le mixer.
- Matrice 9 pistes × 16 pas, clic pour activer/désactiver un pas, curseur orange sur les steps actifs, playhead bleu, layout 2 colonnes aligné au pixel près.
- Lecture/pause/stop fonctionnels, BPM 40–240 (changement live sans Stop+Play), volume master 0–100 %.
- **Contrôles par piste** : Volume (slider 0-100%), Mute (pastille 🔊/🔇), Solo (pastille S) — GainNode par piste dans le pipeline audio, ramp linéaire 20ms anti-clic, persistance `localStorage` (3 clés : volume, mute, solo).
- **🗑 Clear**, **🎲 Randomize** (PRNG mulberry32 déterministe `0xC0FFEE`, pattern musicalement sensé ~18% densité).
- **🎵 Presets d'usine** : 5 genres (Rock 4/4, House/Electro, Trap/Hip-hop, Funk/Disco, Reggae/Dub one-drop) via `js/factory-presets.js`.
- **Rythmes Musicca** : 20 patterns (Pop rock 1-6, Jazz 1-4, Funk, Disco, Hip-hop, Heavy metal) avec swing pour Jazz.
- Batterie vue du dessus : image chargée, 8 hotspots cliquables + 1 zone pédale charleston, raccourcis clavier B/Space/S/T/Y/G/H/C/R, animation d'impact.
- 2 sons synthétisés (MembraneSynth + MetalSynth) + 2 kits de samples CC0/PD (acoustic + electronic) avec pré-chargement au boot pour le 1er son correct.
- Charleston : pédale = mémoire seule (pas de son parasite), 1 clic = 1 son (open ou closed selon pédale, plus de double-déclenchement closed+open).
- Sécurité : CSP complète documentée dans `SECURITY.md`.

**Ce qui reste à faire (prochains milestones)** :
- Import de samples custom (input file + drag & drop) — pipeline prêt, UI à faire.
- Intégration des tests `validate_sequencer*` dans `tests/run-all.js` (déjà créés mais pas exécutés par `npm test`).
- Tests unitaires du moteur audio (Tone.js mocké).

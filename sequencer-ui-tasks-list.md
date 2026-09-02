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
  - [~] En-têtes de piste : **nom de l'instrument uniquement** (les contrôles Volume/Mute/Solo et l'import audio ne sont pas implémentés — voir §6).
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
  - [ ] Bouton **Clear** (effacer toute la grille) — *à faire*.
  - [ ] Bouton **Randomize** musical — *à faire*.
  - [ ] Sélecteur de **presets d'usine** (Rock 4/4, House/Electro, Trap/Hip-hop, Funk/Disco) — *à faire*.
- [ ] **Contrôles avancés par piste** (Volume / Mute / Solo par piste) — *à faire*.

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
- [ ] **Persistance `localStorage`** — *non implémenté* : pattern, BPM et volumes ne sont pas sauvegardés entre rechargements.

---

## 8. 🧪 Tests, Validation & Documentation

- [x] **Tests automatisés existants** :
  - [x] `tests/validate_sequencer_html.js` : vérifie la présence de `step-matrix`, `drum-kit-view`, `sequencer-header`, des liens `css/sequencer.css` et `js/sequencer-app.js`.
  - [x] `tests/validate_sequencer_drumkit.js` : vérifie la présence de `css/sequencer.css` et `js/sequencer-app.js`.
  - [x] **Note** : ces tests NE sont PAS intégrés à `tests/run-all.js` (donc `npm test` ne les exécute pas). À intégrer dans un prochain pass.
- [ ] **Tests unitaires du moteur audio** (`tests/test_sequencer.js` avec Tone.js mocké) — *à faire*.
- [ ] **Vérification syntaxique** (`npm run check:syntax` pour `js/sequencer-app.js`) — *non automatisée, vérifiée à la main*.
- [x] **Vérifications fonctionnelles** :
  - [x] Test en `file://` : la page se charge mais **Tone.js nécessite un contexte sécurisé** — selon les navigateurs, `file://` peut bloquer certaines features Web Audio. Recommandé : passer par le serveur `http://127.0.0.1:5400/sequencer`.
  - [x] Test via serveur local Express : `http://127.0.0.1:5400/sequencer` → 200 OK, tous les assets servis, séquenceur fonctionnel.
  - [x] Validation responsive : media queries `≤ 900px` (header centré) et `≤ 560px` (pads redimensionnés).
- [ ] **Documentation utilisateur** :
  - [ ] Mise à jour du `README.md` et `README.fr.md` mentionnant la boîte à rythmes / séquenceur.
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

---

## 📊 Point d'étape (au 2026-09-01)

**Ce qui marche** :
- Page `/sequencer` servie par le serveur Express, accessible via le bouton "🥁 Séquenceur" depuis le mixer.
- Matrice 9 pistes × 16 pas, clic pour activer/désactiver un pas, curseur jaune qui défile à 1/16e.
- Lecture/pause/stop fonctionnels, BPM 40–240, volume master 0–100 %.
- Batterie vue du dessus : image chargée, 8 hotspots cliquables + 1 zone pédale charleston, raccourcis clavier B/Space/S/T/Y/G/H/C/R, animation d'impact (glow + scale + onde de choc).
- 2 sons synthétisés : `MembraneSynth` (fûts) + `MetalSynth` (cymbales), charleston avec mémoire de pédale (état UP/DOWN partagé clavier/clic).
- Sécurité : CSP complète documentée dans `SECURITY.md` (worker-src blob: justifié, allowlist serveur explicite, pas de `express.static(ROOT)`).

**Ce qui reste à faire (prochains milestones)** :
- Mute/Solo et volume par piste dans la grille.
- Boutons Clear et Randomize.
- Presets d'usine (Rock 4/4, House, Trap, Funk).
- Import de samples custom (input file + drag & drop).
- Persistance `localStorage` du pattern / BPM / volumes.
- Intégration des tests `validate_sequencer*` dans `tests/run-all.js`.
- Mise à jour de `README.md` / `README.fr.md`.

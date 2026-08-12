# 🎚️ YT Music Web Mixer — Migration Piped / Web Audio API

Plan de migration de l'application : remplacer l'API IFrame YouTube (volume-only, pas de DSP) par les **flux audio Piped** (`/streams/{videoId}`) traités via **Web Audio API** pour du **vrai mixage DJ** (crossfade audio réel, EQ 3 bandes, filtre sweep, analyse spectrale, BPM, beatmatch).

Référence : `CLAUDE.md` (cahier des charges — contrainte #1 sur l'impossibilité DSP avec l'IFrame), `tasks-list.md` (état actuel), `js/search.js` (déjà utilise Piped pour la recherche), Piped OpenAPI (`/streams/{videoId}` → `audioStreams` avec URLs directes).

## Légende

- [x] Terminé · [~] Partiellement / en cours · [ ] À faire

---

## Contexte technique

### Pourquoi cette migration est possible maintenant

Le `CLAUDE.md` dit explicitement :
> *On ne peut PAS faire de vrai mixage DSP sur le son YouTube. L'API IFrame YouTube ne donne pas accès au AudioBuffer / MediaElementAudioSourceNode (origine croisée, pas de CORS sur l'iframe).*

**Cette contrainte disparaît avec Piped** : l'endpoint `/streams/{videoId}` renvoie les **URLs directes des flux audio YouTube** (M4A, OPUS, WEBMA), proxifiées via `pipedproxy.*` avec CORS `*`. En chargeant ces URLs dans des éléments `<audio>` puis en les branchant dans **Web Audio API** (`MediaElementAudioSourceNode`), on obtient un accès complet au signal audio — et donc au vrai DSP.

### Architecture audio cible (par voie A/B)

```
Piped /streams/{videoId} → audioStream.url (proxifiée, CORS *)
  │
  ▼
<audio crossOrigin="anonymous" src="...">     ← élément HTML5 audio (streaming, seek, play/pause)
  │
  ▼
MediaElementAudioSourceNode                   ← entrée dans le graphe Web Audio
  │
  ▼
BiquadFilterNode(lowshelf, 200Hz)             ← EQ graves (Low)
  │
  ▼
BiquadFilterNode(peaking, 1000Hz, Q=1)        ← EQ mediums (Mid)
  │
  ▼
BiquadFilterNode(highshelf, 4000Hz)           ← EQ aigus (High)
  │
  ▼
BiquadFilterNode(DJ filter : lowpass↔highpass) ← Filtre sweep (1 knob par voie)
  │
  ▼
GainNode(deckGain)                             ← Crossfade (equal-power, ramping)
  │
  ▼
AnalyserNode                                   ← Spectre / waveform / BPM
  │
  ▼
GainNode(masterGain)                           ← Master volume
  │
  ▼
AudioContext.destination                       ← Sortie (haut-parleurs)
```

### Gain vs approche actuelle

| Fonctionnalité | IFrame YouTube (actuel) | Piped + Web Audio (cible) |
|----------------|--------------------------|---------------------------|
| Crossfade | `setVolume(v)` — volumeonly | `GainNode.gain` — vrai crossfade audio |
| EQ | ❌ Impossible | ✅ 3 bandes (BiquadFilterNode) |
| Filtre DJ | ❌ Impossible | ✅ Sweep LP↔HP (1 knob) |
| Analyse spectrale | ❌ Impossible | ✅ AnalyserNode + canvas |
| BPM / beatmatch | ❌ Impossible | ✅ Détection tempo + sync |
| Pitch / tempo | ❌ Impossible | ✅ `playbackRate` + `preservesPitch` |
| Cue / loop | ❌ Impossible | ✅ `currentTime` + marqueurs |
| Vidéo | ✅ IFrame | ❌ Audio-only (trade-off) |
| Fiabilité | ✅ YouTube officiel | ⚠️ Instances Piped (instables) |

---

## 0. Recherche & validation CORS (CRITIQUE — à faire en premier) [ ]

Avant toute implémentation, il faut vérifier que les flux audio Piped sont utilisables avec Web Audio API. C'est le **risque #1** du projet.

- [ ] Appeler `GET https://pipedapi.kavin.rocks/streams/{videoId}` avec un ID de test (`lfmxnzJAbl8`) et inspecter la réponse :
  - Structure de `audioStreams` : `url`, `format`, `bitrate`, `mimeType`, `videoOnly`
  - Champ `proxyUrl` : URL de base du proxy Piped
  - Vérifier si les URLs dans `audioStreams` sont directes (`*.googlevideo.com`) ou déjà proxifiées (`pipedproxy.*`)
- [ ] **Test CORS** : charger une URL `audioStream.url` dans un `<audio crossOrigin="anonymous">` puis créer un `MediaElementAudioSourceNode`. Vérifier que l'`AnalyserNode` reçoit des données non-nulles (si tout zéro → CORS bloqué, audio "tainted")
- [ ] Si les URLs directes (`googlevideo.com`) **échouent** en CORS :
  - Construire l'URL proxy Piped à partir de `proxyUrl` + l'URL du flux
  - Tester à nouveau avec l'URL proxifiée → CORS `*` attendu
  - Documenter le format exact du proxy (ex : `{proxyUrl}?url={encoded}` ou `{proxyBase}/stream?url=...`)
- [ ] **Test expiration** : vérifier après combien de temps l'URL du flux expire (erreur 403 sur l'élément `<audio>`). Tester le re-fetch depuis Piped.
- [ ] **Test multi-instances** : réutiliser la cascade d'instances Piped de `search.js` (`PIPED_INSTANCES`) pour `/streams/{videoId}` — vérifier que toutes les instances supportent cet endpoint
- [ ] Sélection du format audio : choisir le flux audio-only avec le meilleur bitrate (préférer OPUS ou M4A). Documenter la logique de sélection.
- [ ] Si CORS est **définitivement bloqué** (même via proxy) → l'approche Web Audio API est impossible en web. Voir section 11 (fallback IFrame) ou envisager une approche `AudioBufferSourceNode` (téléchargement complet du buffer via `fetch()` + `decodeAudioData`, mais lourd).

---

## 1. Client Piped Streams — `js/piped-streams.js` [x]

Nouveau module dédié à la récupération et gestion des URLs de flux audio Piped.

- [x] **`fetchStreamInfo(videoId, signal)`** : appelle `GET /streams/{videoId}` sur les instances Piped en cascade (même logique que `callPipedSearch` dans `search.js`). Retourne `{ audioStreams, videoStreams, title, duration, uploader, thumbnailUrl, proxyUrl, instance }`.
- [x] **Sélection du flux audio** : `selectBestAudio(audioStreams)` → choisit le flux audio-only avec le meilleur bitrate (préférer OPUS > M4A > WEBMA). Ignore les flux `videoOnly: true`.
- [x] **Construction de l'URL CORS-safe** : si l'URL du flux est directe (`googlevideo.com`), la proxifier via `proxyUrl` pour activer CORS `*`. Si déjà proxifiée, la garder telle quelle. Logique documentée issue de la phase 0.
- [x] **Cache en mémoire** : `{ videoId → { streamUrl, proxyUrl, fetchedAt, expiresAt } }`. Évite les re-fetchs inutiles pendant la validité de l'URL.
- [x] **Détection d'expiration** : `refreshStream(videoId, signal)` invalide le cache et re-fetch (sera appelé par audio-player.js quand l'élément <audio> émet une erreur 403/network).
- [x] **Réutilisation des instances Piped** : `PIPED_INSTANCES` et `PIPED_INSTANCE_TIMEOUT_MS` déplacés de `search.js` vers `config.js`, partagés.
- [x] **Gestion d'erreurs** : erreurs typées (`kind: 'invalid-id' | 'piped-streams' | 'abort' | 'network'`) classées par `classifyError()` en messages localisés. Vidéo supprimée/privée = instance qui répond sans `audioStreams` → considérée comme échec d'instance, la cascade continue.
- [x] Exposer : `window.PipedStreams = { fetchStreamInfo, refreshStream, selectBestAudio, buildCorsSafeUrl, getCorsSafeUrl, getCachedStream, clearCache, classifyError }`

---

## 2. Moteur audio Web Audio API — `js/audio-engine.js` [x]

Nouveau module : le cœur du mixage DSP. Gère l'`AudioContext` partagé et le graphe audio par voie.

- [x] **AudioContext unique** : créé lazy au premier `init()` / `createDeckChain()` / `resume()`. `new (window.AudioContext || window.webkitAudioContext)()`. Stocké dans `AudioEngine.ctx` (accès via `getContext()`).
- [x] **`createDeckChain(deckId, audioEl)`** : construit le graphe audio pour une voie :
  ```
  source → lowShelf → midPeak → highShelf → djFilter → deckGain → analyser
         (et deckGain → masterGain en parallèle)
  ```
  - `source` : `MediaElementAudioSourceNode` créé depuis l'élément `<audio>` (voir section 3)
  - `lowShelf` : `BiquadFilterNode` type `lowshelf`, frequency `200Hz`, gain `0dB` (neutre)
  - `midPeak` : `BiquadFilterNode` type `peaking`, frequency `1000Hz`, Q `1.0`, gain `0dB`
  - `highShelf` : `BiquadFilterNode` type `highshelf`, frequency `4000Hz`, gain `0dB`
  - `djFilter` : `BiquadFilterNode` — type dynamique selon position du knob (section 6). Démarre en `allpass` (transparent).
  - `deckGain` : `GainNode` gain initial `0.5` (centre, pour ne pas avoir silence au boot).
  - `analyser` : `AnalyserNode` `fftSize=2048`, `smoothingTimeConstant=0.8`
  - deckGain → analyser (terminal deck) ET deckGain → masterGain (continuation vers la sortie)
- [x] **`masterGain`** : `GainNode` unique, partagé entre les 2 voies. Gain initial `1.0`. Contrôle du volume master.
- [x] **`masterAnalyser`** : `AnalyserNode` placé APRÈS le `masterGain` (cf. spec) pour visualiser le master mix final.
- [x] **Référence des nœuds par voie** : `chains = { A: { audioEl, source, lowShelf, midPeak, highShelf, djFilter, deckGain, analyser }, B: { ... } }`
- [x] **`resume()`** : `ctx.resume()` si state === 'suspended'. Async, retourne le state final.
- [x] **`applyCrossfade(p)`** : règle les `deckGain` en equal-power :
  - `chains.A.deckGain = cos(p·π/2)`, `chains.B.deckGain = sin(p·π/2)`
  - Ramping fluide via `gain.setTargetAtTime(value, ctx.currentTime, 0.015)`
  - Clamp `[0..1]` sur p, idempotent
- [x] **`applyMasterVolume(v)`** : `masterGain.gain = v/100`, ramping identique.
- [x] **`setEQ(deck, band, gainDb)`** : `band = 'low'|'mid'|'high'`, clamp `±12 dB`, ramping.
- [x] **`setDjFilter(deck, position)`** : position `[-1..+1]` :
  - `pos = -1` → `lowpass`, freq = 200 Hz
  - `pos = 0` → `lowpass` à 20 kHz (bypass transparent, on évite le changement de type pour ne pas perturber la résonance)
  - `pos = +1` → `highpass`, freq = 5000 Hz
  - Interpolation **log scale** entre les bornes (sensation régulière du knob)
- [x] **`getAnalyser(deck)`** : retourne l'`AnalyserNode` pour la voie (utilisé par le visualizer, section 8).
- [x] **`getMasterAnalyser()`** : AnalyserNode global post-master.
- [x] **`hasDeck(deckId)` / `getDeckAudioElement(deckId)`** : accesseurs pratiques.
- [x] **Teardown / cleanup** : `destroyDeckChain(deckId)` disconnect tous les nœuds de la chaîne (try/catch sur disconnect car throw si déjà déconnecté). Permet de recréer une chaîne après destroy.
- [x] Exposer : `window.AudioEngine = { init, resume, getContext, createDeckChain, destroyDeckChain, applyCrossfade, applyMasterVolume, setEQ, setDjFilter, getAnalyser, getMasterAnalyser, hasDeck, getDeckAudioElement, CONST }`

⚠️ **Contrainte Web Audio API** : un `MediaElementAudioSourceNode` ne peut être créé qu'une seule fois par élément `<audio>`. Quand on change de vidéo, il faut soit réutiliser le même élément (changer `src`) et le même `MediaElementAudioSourceNode`, soit détruire et recréer toute la chaîne. Préférer la réutilisation (changer `audio.src` garde le nœud valide).

---

## 3. Lecteur audio Piped — modification de `js/youtube.js` ou nouveau `js/audio-player.js` [x]

Remplacer (ou compléter) le lecteur IFrame YouTube par un lecteur `<audio>` branché dans Web Audio API.

- [x] Décider : **modifier `youtube.js`** (le transformer en module de lecteur générique) ou **créer `js/audio-player.js`** séparé et garder `youtube.js` comme fallback. **Recommandé : créer `js/audio-player.js`** pour séparer proprement les deux backends.
- [x] **`createAudioPlayer(deckId, { onReady, onStateChange, onError })`** dans `audio-player.js` :
  - Crée un `<audio crossOrigin="anonymous" preload="auto">` dans le DOM (ou réutilise un élément existant dans `index.html`)
  - Appelle `AudioEngine.createDeckChain(deckId)` pour brancher l'élément dans le graphe Web Audio
  - Retourne un wrapper avec la **même interface** que `YTWrapper.createPlayer` :
    - `loadVideoById(id)` → interroge `PipedStreams.fetchStreamInfo(id)` → sélectionne le flux audio → `audio.src = streamUrl` → `audio.load()`
    - `cueVideoById(id)` → comme `loadVideoById` mais sans `play()` (juste charger)
    - `playVideo()` → `AudioEngine.resume()` puis `audio.play()`
    - `pauseVideo()` → `audio.pause()`
    - `seekTo(sec)` → `audio.currentTime = sec`
    - `setVolume(v)` → **no-op** (le volume est géré par le `GainNode` du crossfader, pas par l'élément audio). Gardé pour compatibilité de l'interface. Option : `audio.volume = 1.0` fixe.
    - `mute()` / `unMute()` → gérer via un `GainNode` de mute séparé, ou via `deckGain.gain = 0` (mais alors le crossfade perd le contrôle). Préférer un `GainNode(muteGain)` inséré avant `deckGain`.
    - `getCurrentTime()` → `audio.currentTime`
    - `getDuration()` → `audio.duration` (peut être `NaN` tant que les métadonnées ne sont pas chargées → utiliser `PipedStreams.fetchStreamInfo` pour la durée)
    - `getPlayerState()` → mapper les événements `<audio>` vers les constantes `YTWrapper.STATE` :
      - `emptied`/`loadstart` → `UNSTARTED (-1)`
      - `playing` → `PLAYING (1)`
      - `pause` → `PAUSED (2)`
      - `waiting`/`stalled` → `BUFFERING (3)`
      - `ended` → `ENDED (0)`
      - `canplay` → `CUED (5)`
- [x] **Événements `<audio>`** : `on('timeupdate')` → `onStateChange`, `on('error')` → gestion expiration (appeler `PipedStreams.refreshStream`), `on('canplay')` → `onReady`
- [x] **Gestion de l'expiration** : si `audio.error` = `MEDIA_ERR_NETWORK` ou `MEDIA_ERR_SRC_NOT_SUPPORTED` → re-fetch l'URL du flux via `PipedStreams`, restaurer la position (`currentTime`), reprendre si en lecture
- [x] **`crossOrigin="anonymous"`** obligatoire sur l'élément `<audio>` — sinon le `MediaElementAudioSourceNode` reçoit du silence (audio tainted)
- [x] Tests : `tests/test_audio_player.js` (71 assertions : API publique, mappage STATE, loadVideoById, cueVideoById, playVideo/pauseVideo/seekTo, mute/unMute, setVolume no-op, expiration avec refreshStream, erreur retryable/non-retryable, épuisement après 2 tentatives, propagation onError)

---

## 4. Abstraction lecteur (dual mode Piped / IFrame) [ ]

Permettre à l'app de basculer entre Piped Audio (Web Audio DSP) et YouTube IFrame (fallback volume-only) de façon transparente.

- [ ] Définir une **interface commune** (déjà implicitement définie par `YTWrapper.createPlayer`) :
  ```
  { loadVideoById, cueVideoById, playVideo, pauseVideo, seekTo,
    setVolume, mute, unMute, getCurrentTime, getDuration, getPlayerState }
  ```
- [ ] **Détection de mode** au démarrage dans `app.js` :
  - Mode par défaut : **Piped Audio** (si la phase 0 a validé CORS)
  - Fallback automatique : si `PipedStreams.fetchStreamInfo` échoue sur toutes les instances au premier chargement → basculer en mode IFrame
  - Mode manuel : bouton dans les Paramètres pour forcer un mode (auto / Piped / IFrame)
- [ ] **`config.js`** : ajouter `STORAGE_KEYS.PLAYER_MODE: 'playerMode'` (valeurs : `'auto'`, `'piped'`, `'iframe'`)
- [ ] `app.js` `createDeckPlayer(deck, videoId)` : selon le mode, appeler `AudioPlayer.createAudioPlayer` ou `YTWrapper.createPlayer`
- [ ] Le `mixer.js` doit s'adapter au mode :
  - Mode Piped → `AudioEngine.applyCrossfade` (GainNode)
  - Mode IFrame → `player.setVolume` (comportement actuel)
  - Abstraction : `Mixer.applyVolumes()` détecte le mode et route vers la bonne implémentation

---

## 5. Crossfader Web Audio — modification de `js/mixer.js` [ ]

Remplacer le crossfade `setVolume` par un crossfade `GainNode` avec ramping fluide.

- [ ] `Mixer.applyVolumes()` :
  - Si mode Piped actif → `AudioEngine.applyCrossfade(crossfade / 100)` + `AudioEngine.applyMasterVolume(master)`
  - Si mode IFrame → comportement actuel (`player.setVolume` avec equal-power)
- [ ] **Ramping fluide** : remplacer le crossfade progressif par paliers (`setInterval`) par `GainNode.gain.setTargetAtTime(value, ctx.currentTime, timeConstant)`. Plus précis, plus fluide, natif à Web Audio API. Le `setInterval` par paliers devient obsolète en mode Piped (mais conservé pour le mode IFrame).
- [ ] Affichage des volumes A/B inchangé (basé sur la cible `crossfade`, pas sur la valeur appliquée intermédiaire)
- [ ] Sync B→A en mode Piped : `audio.currentTime` est précis à la milliseconde → sync plus fiable qu'avec l'IFrame. `syncBtoA()` inchangé dans sa logique (seek B au `currentTime` de A).
- [ ] Sync continu en mode Piped : le drift devrait être **beaucoup plus faible** qu'avec l'IFrame (les éléments `<audio>` HTML5 sont synchronisés par l'horloge du navigateur). Le seuil de re-seek peut passer de 0.5s à 0.2s.

---

## 6. EQ 3 bandes + filtre DJ par voie [ ]

### 6.1 EQ 3 bandes (Low / Mid / High)

- [ ] **UI** : 3 faders verticaux ou knobs rotatifs par voie (A et B), placés dans la zone du lecteur ou sous le waveform. Range -12dB à +12dB, 0dB = neutre.
- [ ] **HTML** (`index.html`) : ajouter dans chaque `.deck` un conteneur `.deck-eq` avec 3 contrôles (sliders verticaux `<input type="range" min="-12" max="12" value="0" step="0.5" orient="vertical">`)
- [ ] **CSS** (`styles.css`) : sliders verticaux d'EQ (style console DJ), labels LOW/MID/HIGH, échelle 0dB au centre
- [ ] **Câblage** (`app.js`) : `eq.addEventListener('input', () => AudioEngine.setEQ(deck, band, parseFloat(eq.value)))`
- [ ] `AudioEngine.setEQ(deck, band, gainDb)` : règle `.gain.value` du `BiquadFilterNode` correspondant (déjà créé dans `createDeckChain`)
- [ ] Persistance : sauvegarder les positions d'EQ par voie en `localStorage` (`eqLowA`, `eqMidA`, `eqHighA`, idem B). Restaurer au chargement.

### 6.2 Filtre DJ (sweep LowPass ↔ HighPass)

- [ ] **UI** : 1 knob par voie, position centrale = off (filtre bypass). Tourner à gauche = lowpass (cut les aigus progressivement). Tourner à droite = highpass (cut les graves).
- [ ] **Logique** dans `AudioEngine.setDjFilter(deck, position)` :
  - `position` : `-1` (full lowpass) à `0` (off) à `+1` (full highpass)
  - Si `position < 0` : `djFilter.type = 'lowpass'`, `djFilter.frequency.value` = mapper `position` de `20000Hz` (position 0) vers `200Hz` (position -1)
  - Si `position > 0` : `djFilter.type = 'highpass'`, `djFilter.frequency.value` = mapper `position` de `20Hz` (position 0) vers `5000Hz` (position +1)
  - Si `position === 0` : bypass (mettre `djFilter.type = 'allpass'` ou `frequency = 20000` en lowpass)
- [ ] **Kill switch** : double-clic sur le knob → reset à 0 (filtre off)
- [ ] Persistance : `djFilterA`, `djFilterB` en `localStorage`

---

## 7. Pitch / Tempo control [ ]

Permettre d'ajuster la vitesse de lecture pour le beatmatching.

- [ ] **UI** : 1 slider vertical par voie, range -8% à +8%, centré à 0%. Affichage du BPM ajusté.
- [ ] **Logique** : `audio.playbackRate = 1 + (pitch / 100)` (ex: pitch = +4% → `playbackRate = 1.04`)
- [ ] **Préservation du pitch** : `audio.preservesPitch = true` (ou `audio.mozPreservesPitch = true`, `audio.webkitPreservesPitch = true`) → change la vitesse sans changer la hauteur (pas d'effet "chipmunk"). Requis pour le beatmatch.
- [ ] Affichage BPM : si le BPM original est détecté (section 9), afficher `bpm * playbackRate` (BPM effectif)
- [ ] **Reset** : double-clic → `playbackRate = 1.0` (reset pitch à 0%)
- [ ] Persistance : `pitchA`, `pitchB` en `localStorage`
- [ ] ⚠️ Le pitch ne fonctionne qu'en mode Piped (IFrame YouTube n'expose pas `playbackRate`)

---

## 8. Analyse spectrale & visualisation — `js/visualizer.js` [ ]

Visualiser le signal audio en temps réel via les `AnalyserNode` du moteur audio.

- [ ] **`js/visualizer.js`** : nouveau module de rendering canvas
- [ ] **`createVisualizer(canvas, analyser, options)`** : boucle `requestAnimationFrame` qui :
  - Récupère `analyser.getByteFrequencyData(freqData)` → spectre de fréquences
  - Récupère `analyser.getByteTimeDomainData(waveData)` → waveform (forme d'onde)
  - Dessine sur le canvas
- [ ] **Mode spectre** (bars) : dessiner des barres verticales colorées (dégradé bleu→rose pour A, inverse pour B). Hauteur proportionnelle à l'amplitude par bande de fréquence.
- [ ] **Mode waveform** (ligne) : dessiner la forme d'onde. Utile pour voir les beats (pics = transitoires/basses).
- [ ] **Canvas par voie** : un canvas dans chaque `.deck` (remplaçant ou complétant la zone `.deck-player`). Taille responsive.
- [ ] **Canvas master** : un petit canvas dans la barre de mixage affichant le spectre global (post-masterGain).
- [ ] **Performance** : `requestAnimationFrame` (pas `setInterval`), `fftSize=2048` (bon compromis résolution/perf), limiter le FPS à 30 si besoin.
- [ ] Exposer : `window.Visualizer = { createVisualizer, start, stop }`

---

## 9. Détection BPM & beatmatch [ ]

Estimer le tempo de chaque morceau en temps réel via l'`AnalyserNode`.

- [ ] **`js/bpm-detector.js`** (ou intégré à `audio-engine.js`) : algorithme de détection de beat en temps réel :
  1. Récupérer `analyser.getByteFrequencyData(freqData)` à intervalle régulier (~50ms)
  2. Isoler la bande bass (bins correspondant à 20-150Hz — kick drum)
  3. Calculer l'énergie de cette bande (somme des amplitudes)
  4. Détecter les pics d'énergie (beat = pic dépassant un seuil adaptatif)
  5. Stocker les timestamps des beats dans une fenêtre glissante (~10s)
  6. Calculer les intervalles inter-beat → médiane = intervalle moyen
  7. `bpm = 60000 / intervalleMoyen` (si intervalle en ms)
  8. Filtrer dans la plage plausible 60-200 BPM
- [ ] **Affichage BPM** : un badge/afficheur par voie montrant le BPM détecté (ex: `128 BPM`)
- [ ] **Slider de pitch** (section 7) : afficher le BPM effectif = `bpm * playbackRate`
- [ ] **Bouton SYNC** (nouveau, distinct du sync de position) : ajuster automatiquement le `playbackRate` de B pour matcher le BPM de A :
  - `ratio = bpmA / bpmB`
  - `audioB.playbackRate = clamp(ratio, 0.92, 1.08)` (limiter à ±8%)
  - Si le ratio sort de la plage → afficher "BPM trop éloigné, sync impossible"
- [ ] **Limitations documentées** :
  - La détection est approximative (±2-3 BPM). Les transitions, builds et breaks peuvent fausser la détection.
  - Le beatmatch n'est pas parfait — un écart résiduel de quelques BPM reste possible.
  - Ne pas promettre un sync frame-accurate.
- [ ] Exposer : `window.BPMDetector = { start(deck), getBPM(deck), syncBtoA() }`

---

## 10. Cue points & boucles [ ]

Fonctionnalités DJ de navigation dans le morceau.

- [ ] **Cue point** : bouton "CUE" par voie → sauvegarde le `currentTime` actuel comme point de départ. Re-clic → seek au point sauvegardé.
- [ ] **Bouton PLAY/PAUSE** par voie (en plus du play/pause both) : contrôle individuel
- [ ] **Loop A↔B** : 2 marqueurs (loop-in, loop-out) par voie. Quand les deux sont définis, l'audio boucle entre ces positions :
  - `audio.addEventListener('timeupdate')` → si `currentTime >= loopOut` → `audio.currentTime = loopIn`
- [ ] **Loop de N beats** : bouton "1/2/4/8" → définit un loop de 1/2/4/8 beats à partir de la position actuelle (nécessite le BPM de la section 9)
- [ ] Persistance : `cueA`, `cueB`, `loopInA`, `loopOutA`, etc. en `localStorage`
- [ ] ⚠️ Disponible uniquement en mode Piped (l'IFrame ne permet pas le loop précis)

---

## 11. Migration progressive & fallback IFrame [ ]

L'app doit continuer à fonctionner pendant la migration et basculer en IFrame si Piped échoue.

- [ ] **Mode "auto"** (par défaut) :
  - Au démarrage, tenter `PipedStreams.fetchStreamInfo` sur les vidéos de test
  - Si succès → mode Piped (Web Audio API activé, UI DJ complète)
  - Si échec → fallback IFrame (comportement actuel, UI simplifiée)
- [ ] **Détection runtime** : si une voie est en mode Piped et que le flux audio expire sans pouvoir être rafraîchi (toutes instances Piped down) → basculer cette voie en IFrame automatiquement
- [ ] **UI adaptative** :
  - Mode Piped : afficher EQ, filtre, pitch, waveform, BPM, cue/loop
  - Mode IFrame : masquer ces contrôles (ils ne fonctionnent pas), afficher uniquement crossfade + play/pause + sync (comportement actuel)
  - Un indicateur visuel montre le mode actif par voie (badge "🔊 Piped" / "📺 IFrame")
- [ ] **Paramètres** : ajout d'un sélecteur de mode dans la modal Paramètres (Auto / Piped / IFrame) avec persistance `localStorage`
- [ ] **Migration des fichiers** : `youtube.js` reste intact (fallback), `audio-player.js` et `audio-engine.js` sont les nouveaux modules Piped. `app.js` orchestre les deux.

---

## 12. UI/UX DJ — modification de `index.html` + `css/styles.css` [ ]

Repenser l'interface pour une expérience DJ.

### 12.1 Layout par voie (`.deck`)

Structure cible de chaque voie (en mode Piped) :

```
┌─────────────────────────────┐
│ Badge A  Titre    [▶] [🔇]  │  ← header (existant) + bouton play/pause individuel
├─────────────────────────────┤
│ [Recherche]      [Mode]      │  ← search (existant)
├─────────────────────────────┤
│ ┌─────────────────────────┐ │
│ │     Waveform / Spectre    │ │  ← canvas (remplace la zone vidéo IFrame)
│ │     (AnalyserNode)        │ │
│ └─────────────────────────┘ │
├─────────────────────────────┤
│  LOW    MID    HIGH   FILTER │  ← EQ 3 bandes + filtre DJ (knobs/sliders)
│  │      │      │      │      │
│  │      │      │      │      │
│  ├──────┼──────┼──────┤      │
│  0dB   0dB   0dB    OFF      │
├─────────────────────────────┤
│  BPM: 128    PITCH: +0%      │  ← afficheur BPM + slider pitch
│  [CUE] [⏮] [⏯] [LOOP 1/2/4] │  ← boutons cue/transport/loop
├─────────────────────────────┤
│ [Résultats de recherche]      │  ← results (existant, déplacé en bas)
└─────────────────────────────┘
```

- [ ] Remplacer `.deck-player` (IFrame 16:9) par `.deck-visualizer` (canvas waveform/spectre)
- [ ] Ajouter `.deck-eq` : conteneur avec 4 contrôles verticaux (LOW, MID, HIGH, FILTER)
- [ ] Ajouter `.deck-dj-controls` : BPM display + pitch slider + cue/loop/play buttons
- [ ] Déplacer `.deck-results` en bas de la voie (après les contrôles DJ)
- [ ] En mode IFrame fallback : masquer `.deck-eq`, `.deck-dj-controls`, restaurer `.deck-player`

### 12.2 Barre de mixage (`.mixer-bar`)

- [ ] Crossfader existant conservé (mais branché sur `AudioEngine.applyCrossfade` en mode Piped)
- [ ] Ajouter un mini-canvas master spectrum dans la barre
- [ ] Conserver play both / pause both / sync / master volume

### 12.3 Styling

- [ ] Sliders EQ verticaux : `-webkit-appearance: slider-vertical` ou `writing-mode: bt-lr` (vertical), hauteur ~120px
- [ ] Knobs rotatifs (filtre DJ, pitch) : si on veut des vrais knobs circulaires, utiliser un canvas ou un input range stylé en rotatif. Alternative simple : sliders verticaux pour tout.
- [ ] Thème sombre conservé (`#0f1115`, `#15181f`)
- [ ] Couleurs par voie conservées : A = bleu `#3b82f6`, B = rose `#ec4899`
- [ ] Canvas waveform : fond noir, ligne A en bleu, ligne B en rose
- [ ] Responsive : en mode mobile (< 720px), les contrôles DJ s'empilent

---

## 13. Gestion des erreurs [ ]

- [ ] **Flux audio expiré** (403/network sur `<audio>`) : re-fetch automatique via `PipedStreams.refreshStream`, reprise à la même position. Si re-fetch échoue (instances down) → afficher erreur dans la voie + proposer fallback IFrame
- [ ] **CORS bloqué** (audio tainted, AnalyserNode = silence) : détecter (analyser.getByteFrequencyData = all zeros après 1s de lecture) → afficher "CORS bloqué, passage en mode IFrame" → basculer la voie en IFrame
- [ ] **Piped instances toutes down** au démarrage → fallback IFrame global + message d'info
- [ ] **AudioContext bloqué** (autoplay policy) → afficher "Cliquez sur Play pour activer l'audio" (le premier geste débloque le contexte)
- [ ] **Vidéo supprimée/privée** (Piped 500 avec message) → afficher le message dans la voie
- [ ] **Quota / rate limit Piped** : les instances Piped n'ont pas de quota officiel mais peuvent être rate-limitées. Gérer le 429 comme dans `search.js` (warning non bloquant)
- [ ] **Mode IFrame fallback** : si le mode Piped échoue, l'app doit continuer à fonctionner en mode IFrame (volume-only). La transition doit être invisible pour l'utilisateur (sauf le badge de mode)

---

## 14. Configuration — modification de `js/config.js` [ ]

- [ ] `STORAGE_KEYS` : ajouter :
  - `PLAYER_MODE: 'playerMode'` — auto / piped / iframe
  - `EQ_LOW_A / EQ_MID_A / EQ_HIGH_A` (idem B) — positions d'EQ par voie
  - `DJ_FILTER_A / DJ_FILTER_B` — position du filtre DJ
  - `PITCH_A / PITCH_B` — réglage pitch par voie
  - `CUE_A / CUE_B` — positions de cue
  - `LOOP_IN_A / LOOP_OUT_A` (idem B) — marqueurs de loop
- [ ] `PIPED_INSTANCES` et `PIPED_INSTANCE_TIMEOUT_MS` : déplacer de `search.js` vers `config.js` (partagé entre `search.js` et `piped-streams.js`)
- [ ] Constantes audio :
  - `EQ_RANGE_DB: 12` — plage EQ (±12dB)
  - `EQ_LOW_FREQ: 200` — fréquence crossover graves
  - `EQ_MID_FREQ: 1000` — fréquence medium
  - `EQ_HIGH_FREQ: 4000` — fréquence crossover aigus
  - `EQ_MID_Q: 1.0` — facteur de qualité du peaking filter
  - `PITCH_RANGE: 8` — plage pitch (±8%)
  - `ANALYSER_FFT_SIZE: 2048`
  - `BPM_RANGE: [60, 200]` — plage BPM plausible
  - `DJ_FILTER_FREQ_MIN: 200` — freq lowpass max fermée
  - `DJ_FILTER_FREQ_MAX_HP: 5000` — freq highpass max ouverte

---

## 15. Tests & validation [ ]

### 15.1 Tests CORS & flux

- [ ] Tester `/streams/{videoId}` sur les 5 instances Piped → documenter lesquelles répondent
- [ ] Tester le flux audio en `<audio crossOrigin="anonymous">` → vérifier CORS
- [ ] Tester `MediaElementAudioSourceNode` → vérifier que l'`AnalyserNode` reçoit des données non-nulles
- [ ] Tester l'expiration d'URL → après combien de temps ? Le re-fetch fonctionne-t-il ?

### 15.2 Tests audio

- [ ] Crossfader A↔B en mode Piped → le son passe progressivement de A à B (audible, pas juste volume)
- [ ] EQ Low à -12dB → les graves sont coupés (audible)
- [ ] EQ High à +12dB → les aigus amplifiés (audible)
- [ ] Filtre DJ à gauche → son étouffé (lowpass)
- [ ] Filtre DJ à droite → son thin/highpass
- [ ] Master volume → contrôle global
- [ ] Mute/unmute par voie

### 15.3 Tests DJ

- [ ] Pitch +4% → la musique est 4% plus rapide, pitch préservé (pas d'effet chipmunk)
- [ ] Détection BPM → affiche un BPM plausible pour des morceaux connus (tester avec morceaux à BPM connu)
- [ ] Sync BPM → le playbackRate de B s'ajuste pour matcher A
- [ ] Cue point → sauvegarde + seek au point
- [ ] Loop → boucle entre loop-in et loop-out

### 15.4 Tests fallback

- [ ] Couper toutes les instances Piped (éditer `PIPED_INSTANCES` avec des instances invalides) → l'app bascule en mode IFrame automatiquement
- [ ] Revenir en mode Piped → les contrôles DJ réapparaissent

### 15.5 Tests performance

- [ ] 2 flux audio simultanés + 2 canvas waveform à 60fps → vérifier le CPU/latence
- [ ] Si saccades → réduire `fftSize` à 1024, limiter le FPS à 30, ou dessiner le waveform à une fréquence inférieure au spectre

---

## 16. Documentation [ ]

- [ ] Mettre à jour `CLAUDE.md` :
  - Ajouter une section "Mode Piped / Web Audio API" décrivant la nouvelle architecture
  - **Mettre à jour la contrainte #1** : préciser que l'impossibilité DSP s'applique à l'IFrame YouTube, MAIS que l'approche Piped + Web Audio API contourne cette limite en utilisant les flux audio directs proxifiés
  - Documenter les nouveaux fichiers (`piped-streams.js`, `audio-engine.js`, `audio-player.js`, `visualizer.js`, `bpm-detector.js`)
  - Documenter le dual mode (Piped / IFrame fallback)
- [ ] Mettre à jour `README.md` et `README.fr.md` :
  - Nouvelles fonctionnalités : EQ 3 bandes, filtre DJ, pitch/tempo, BPM, waveform, cue/loop
  - Nouvelle architecture audio (schéma du graphe Web Audio)
  - Prérequis : instances Piped (pour les flux audio), pas de clé API YouTube nécessaire
  - Limitations : CORS (dépend des instances Piped), expiration des URLs, audio-only (pas de vidéo), fiabilité des instances
- [ ] Documenter dans l'UI :
  - Le mode actif par voie (badge Piped / IFrame)
  - Les limites du BPM (approximatif, ±2-3 BPM)
  - La dépendance aux instances Piped (peuvent être lentes/indisponibles)
  - L'audio-only en mode Piped (pas de vidéo)
- [ ] Mettre à jour `tasks-list.md` : marquer les nouvelles tâches comme liées à cette migration

---

## 17. Plan d'implémentation (ordre suggéré)

| Phase | Section | Description | Risque |
|-------|---------|-------------|--------|
| 1 | 0 | Recherche & validation CORS | 🔴 Critique — tout dépend de ça |
| 2 | 1 | Client Piped Streams | 🟡 Modéré |
| 3 | 2 | Moteur audio Web Audio | 🟡 Modéré |
| 4 | 3 | Lecteur audio Piped | 🟡 Modéré |
| 5 | 5 | Crossfader Web Audio | 🟢 Faible (modif mixer.js) |
| 6 | 4 | Abstraction dual mode | 🟢 Faible |
| 7 | 6 | EQ + filtre DJ | 🟡 UI + DSP |
| 8 | 8 | Visualisation (spectre/waveform) | 🟢 Faible |
| 9 | 9 | BPM & beatmatch | 🔴 Complexe (algo) |
| 10 | 7 | Pitch / tempo | 🟢 Faible |
| 11 | 10 | Cue & loop | 🟢 Faible |
| 12 | 11 | Migration progressive & fallback | 🟡 Intégration |
| 13 | 12 | UI/UX DJ | 🟡 CSS + HTML |
| 14 | 13 | Gestion erreurs | 🟡 Robustesse |
| 15 | 14 | Config | 🟢 Faible |
| 16 | 15 | Tests | 🟡 Validation |
| 17 | 16 | Documentation | 🟢 Faible |

---

## Notes

- **Phase 0 = tout ou rien** : si CORS est bloqué même via le proxy Piped, l'approche Web Audio API est impossible en web pur. Dans ce cas, les options sont : (a) garder l'IFrame (volume-only), (b) utiliser un mini-serveur local qui proxy les flux (ajoute une dépendance serveur), ou (c) faire l'app en React Native avec un module audio natif (voir `mobile-app-tasks-list.md`).
- **Audio-only en mode Piped** : on perd la vidéo YouTube. C'est un trade-off accepté pour un mixeur DJ. L'IFrame reste disponible en fallback si la vidéo est souhaitée.
- **`MediaElementAudioSourceNode` = point de non-retour** : une fois qu'un élément `<audio>` est connecté à un `MediaElementAudioSourceNode`, son audio ne sort plus directement vers les haut-parleurs — il DOIT passer par le graphe Web Audio jusqu'à `ctx.destination`. Pas de mode hybride (audio direct + DSP en parallèle) sur le même élément.
- **Persistance des instances Piped** : `search.js` utilise déjà `PIPED_INSTANCES` en cascade. Le nouveau `piped-streams.js` réutilisera la même liste. Les deux modules peuvent partager une instance préférée (celle qui a répondu à la dernière recherche) pour optimiser la résolution du flux.
- **`preservesPitch`** : supporté par Chrome, Firefox, Safari modernes. Préfixes : `mozPreservesPitch`, `webkitPreservesPitch`. Feature detection nécessaire.
- **Double flux audio = double bande passante** : 2 flux audio Piped simultanés. Sur mobile, peut être lourd. Le warning de "lourdeur double lecture" du `CLAUDE.md` reste valable.
- **Les instances Piped publiques ne sont pas fiables** : pour une app de production, il faudrait self-host un backend Piped (Docker). Les instances publiques peuvent tomber, être lentes, ou rate-limiter. L'app gère le fallback mais l'expérience sera meilleure avec une instance dédiée.

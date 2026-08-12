# YT Music Web Mixer — Guide des agents

Application web **sans serveur** (HTML + JS pur, ouverte via `file://` ou un hébergement statique) permettant de charger 2 morceaux YouTube côte à côte (voies **A** et **B**), de les lancer, et de les mixer via un **crossfader** en bas de page.

L'application fonctionne en **dual mode** :
- **Mode Piped (primaire, DSP)** : les flux audio sont récupérés via l'API Piped (`/streams/{videoId}`) et traités via **Web Audio API** — vrai crossfade audio, EQ 3 bandes, filtre DJ, analyse spectrale, BPM, pitch/tempo, cue/loop.
- **Mode IFrame (fallback, volume-only)** : lecteur YouTube IFrame classique — le crossfade se fait par contrôle de volume (`setVolume`), pas de DSP. Utilisé quand Piped est indisponible ou CORS bloqué.

Voir `piped-enhancement-tasks-list.md` pour le plan de migration, et `tasks-list.md` pour l'état actuel du projet.

## Objectif produit

- 2 fenêtres côte à côte : **A** (gauche) et **B** (droite). Chacune contient un lecteur (audio Piped ou IFrame YouTube) + une barre de recherche.
- L'utilisateur recherche un morceau dans chaque voie, le sélectionne, il se charge dans le lecteur correspondant.
- Barre d'outils en bas : un **slider de crossfade A↔B** (0 = full A, 100 = full B, 50 = équilibré), plus contrôles de lecture (play/pause, sync, volume master).
- Le slider ajuste en temps réel le volume relatif de A et B.
- **Mode Piped uniquement** : fonctions DJ avancées — EQ 3 bandes par voie, filtre sweep, pitch/tempo, détection BPM, beatmatch, cue points, loops, visualisation spectre/waveform.

## Contraintes techniques majeures (À LIRE)

### Contraintes communes (IFrame + Piped)

1. **Pas d'accès au flux audio YouTube via l'IFrame.** L'API IFrame YouTube ne donne pas accès au `AudioBuffer` / `MediaElementAudioSourceNode` (origine croisée, pas de CORS sur l'iframe). En **mode IFrame**, on ne peut PAS faire de vrai mixage DSP (EQ, filtres, analyse spectrale, beatmatch). Le "mixage" se fait **uniquement par contrôle du volume** de chaque lecteur (`setVolume`). Ne pas perdre de temps à tenter un branchement Web Audio API sur l'iframe — ça ne marche pas et c'est documenté comme impossible.
   - **Exception — mode Piped** : l'endpoint Piped `/streams/{videoId}` renvoie les URLs directes des flux audio YouTube (M4A, OPUS), proxifiées via `pipedproxy.*` avec CORS `*`. En chargeant ces URLs dans des éléments `<audio crossOrigin="anonymous">` puis en les branchant dans Web Audio API (`MediaElementAudioSourceNode`), on obtient un accès complet au signal audio — et donc au vrai DSP (EQ, filtres, crossfade audio, analyse). Voir section "Mode Piped / Web Audio API" ci-dessous.
2. **Crossfade — mode IFrame = contrôle de volume.** `playerA.setVolume(vA)`, `playerB.setVolume(vB)`. Utiliser une courbe d'amplitude (linéaire simple, voire equal-power `sqrt` si on veut être propre) pour éviter le creux de niveau au milieu.
   - **Mode Piped = GainNode.** Le crossfade se fait via `GainNode.gain.value` sur chaque voie dans le graphe Web Audio API. Equal-power : `gainA = cos(p·π/2)`, `gainB = sin(p·π/2)`. Ramping fluide via `gain.setTargetAtTime()`.
3. **Autoplay / politique navigateur.** Un lecteur doit être **muted** pour démarrer sans geste utilisateur. Chaque voie (A et B) doit avoir son propre **bouton mute/unmute** ("Activer le son") déclenché par clic, car le navigateur traite chaque lecteur indépendamment. Les deux lecteurs ne peuvent pas démarrer en son fort sans interaction. À l'initialisation, démarrer les deux lecteurs en `muted`, puis proposer un unmute explicite par voie.
   - **Mode Piped** : `AudioContext` doit être créé/resumé après un geste utilisateur (politique autoplay). Au premier `play()`, appeler `ctx.resume()`.
4. **Recherche YouTube sans serveur.** L'API YouTube Data v3 exige une clé. Comme il n'y a pas de serveur pour masquer la clé :
   - **Option recommandée** : l'utilisateur fournit sa propre clé API YouTube Data (récupérée sur Google Cloud Console), stockée en `localStorage`. La recherche se fait en `fetch()` direct vers `https://www.googleapis.com/youtube/v3/search`.
   - **Fallback sans clé (Piped)** : la recherche utilise l'API publique Piped (`/search?q=…&filter=videos`), CORS activé, pas de clé Google, pas de quota. Plusieurs instances Piped sont essayées en cascade pour la fiabilité. Un bouton de bascule permet de forcer Piped même si une clé API est configurée (préserve le quota Google).
   - **Fallback sans clé ni Piped** : saisie manuelle d'une URL YouTube ou d'un ID vidéo dans chaque voie (pas de recherche).
   - **Ne jamais** embarquer une clé partagée dans le code source.
5. **Pas de build, pas de bundler.** HTML + JS vanilla. Pas de `npm install`, pas de framework. Une page `index.html` + quelques fichiers JS en modules (`<script type="module">`) ou scripts simples. Doit fonctionner en double-cliquant le fichier.
6. **CORS / `file://`.** Les modules ES peuvent être bloqués en `file://` selon le navigateur. Préférez des scripts classiques (`<script src="js/app.js">`). **Attention : l'appel `fetch()` vers l'API YouTube Data peut aussi être bloqué en `file://` dans certains navigateurs (Chrome notamment).** Pour la recherche, recommandez FORTEMENT de servir via `python3 -m http.server` ou tout serveur statique. L'app doit au minimum s'ouvrir en `file://` pour les lecteurs YouTube, mais la recherche peut nécessiter un serveur local.

### Contraintes spécifiques au mode Piped / Web Audio API

7. **CORS des flux audio = point critique.** Les URLs renvoyées par `/streams/{videoId}` dans `audioStreams` peuvent être directes (`*.googlevideo.com` — CORS généralement bloqué) ou proxifiées (`pipedproxy.*` — CORS `*`). Si l'URL directe échoue en CORS (l'`AnalyserNode` reçoit du silence = audio "tainted"), il faut construire l'URL proxifiée à partir du champ `proxyUrl` de la réponse. **Si même le proxy Piped échoue en CORS, l'approche Web Audio API est impossible en web pur** — dans ce cas, rester en mode IFrame (volume-only) ou envisager un mini-serveur local proxy.
8. **`MediaElementAudioSourceNode` = point de non-retour.** Une fois qu'un élément `<audio>` est connecté à un `MediaElementAudioSourceNode`, son audio ne sort plus directement vers les haut-parleurs — il DOIT passer par le graphe Web Audio jusqu'à `ctx.destination`. Pas de mode hybride (audio direct + DSP en parallèle) sur le même élément. L'élément `<audio>` doit avoir `crossOrigin="anonymous"`.
9. **Un `MediaElementAudioSourceNode` par élément.** Un élément `<audio>` ne peut être connecté qu'une seule fois à un `MediaElementAudioSourceNode`. Quand on change de vidéo, on réutilise le même élément (changer `audio.src`) — le nœud reste valide. Ne pas recréer le nœud.
10. **Expiration des URLs de flux.** Les URLs CDN YouTube (même proxifiées) expirent (quelques heures). Si l'élément `<audio>` émet une erreur (403/network), il faut re-fetcher `/streams/{videoId}` pour obtenir une nouvelle URL, puis restaurer la position (`currentTime`) et reprendre si en lecture.
11. **Audio-only en mode Piped.** Le mode Piped utilise les flux `audioStreams` (pas `videoStreams`). On perd la vidéo YouTube. C'est un trade-off accepté pour un mixeur DJ. L'IFrame reste disponible en fallback si la vidéo est souhaitée.
12. **Fiabilité des instances Piped.** Les instances publiques Piped peuvent être lentes, indisponibles, ou rate-limitées. L'app essaie plusieurs instances en cascade (voir `PIPED_INSTANCES` dans `config.js`). Pour une app de production fiable, il faudrait self-host un backend Piped (Docker, Java). L'app gère le fallback IFrame automatiquement si toutes les instances Piped échouent.
13. **`preservesPitch` pour le tempo.** `audio.playbackRate` change la vitesse ET la hauteur (effet "chipmunk"). Pour préserver le pitch lors du beatmatch, utiliser `audio.preservesPitch = true` (préfixes : `mozPreservesPitch`, `webkitPreservesPitch`). Feature detection nécessaire.
14. **Dual mode transparent.** L'app doit basculer entre Piped et IFrame de façon transparente. Un indicateur visuel (badge par voie) montre le mode actif. Les contrôles DJ (EQ, pitch, BPM, cue/loop) ne s'affichent qu'en mode Piped. En mode IFrame, l'UI revient au crossfade volume-only.

## Architecture de fichiers

```
yt-music-web-mixer/
├── CLAUDE.md                    # ce fichier
├── tasks-list.md                # état du projet (app web actuelle)
├── piped-enhancement-tasks-list.md  # plan de migration Piped / Web Audio
├── mobile-app-tasks-list.md     # plan app mobile React Native (WebView)
├── index.html                   # structure : header, zone A | B, barre de mixage
├── css/
│   └── styles.css               # layout grille 2 colonnes + barre fixe + UI DJ
└── js/
    ├── config.js                # constantes, clé API, instances Piped, config audio
    ├── youtube.js               # wrapper YouTube IFrame API (mode fallback)
    ├── audio-player.js          # lecteur <audio> Piped + Web Audio API (mode DSP) [nouveau]
    ├── audio-engine.js          # graphe Web Audio : source → EQ → filtre → gain → analyser [nouveau]
    ├── audio-player.js          # lecteur <audio> Piped + Web Audio API (mode DSP) [nouveau]
    ├── piped-streams.js         # fetch /streams/{videoId}, sélection flux, cache, expiration [nouveau]
    ├── visualizer.js            # canvas spectre/waveform via AnalyserNode [nouveau]
    ├── bpm-detector.js           # détection BPM temps réel (bande bass → pics → intervalles) [nouveau]
    ├── search.js                 # recherche YouTube Data API + Piped (sans clé) + affichage résultats
    ├── mixer.js                  # logique crossfade (GainNode en Piped, setVolume en IFrame)
    └── app.js                    # bootstrap, câblage, détection mode, état global
```

### `youtube.js` — Wrapper IFrame Player (mode fallback)
- Charge l'API IFrame YouTube de façon asynchrone (script tag vers `https://www.youtube.com/iframe_api`).
- Expose `createPlayer(elementId, { onReady, onStateChange, onError })` retournant un objet joueur.
- **Méthodes utilisées** : `loadVideoById(id)` (ou `cueVideoById(id)` + `playVideo()`), `playVideo()`, `pauseVideo()`, `seekTo(sec)`, `setVolume(0-100)`, `mute()`, `unMute()`, `getCurrentTime()`, `getDuration()`, `getPlayerState()`.
  - `loadVideoById` est préféré (charge ET joue automatiquement) ; `cueVideoById` ne fait que charger sans jouer.
- **Constantes d'état du lecteur** (via `getPlayerState()`) :
  - `-1` = UNSTARTED, `0` = ENDED, `1` = PLAYING, `2` = PAUSED, `3` = BUFFERING, `5` = CUED.
- **Paramètres `playerVars` recommandés** à la création : `{ rel: 0, playsinline: 1, origin: window.location.origin }` pour éviter les vidéo suggérées en fin de lecture, forcer le lecture inline, et fixer l'origine.
- **Gestion des erreurs YouTube IFrame** : écouter le callback `onError` (code 100 = vidéo supprimée/privée, 101 = intégration refusée, 150 = contenu restreint). Afficher un message clair dans la voie concernée.
- Garder une **file de chargement** : l'API n'est pas prête immédiatement, met en cache les appels avant `onYouTubeIframeAPIReady`.
- Ce module est le **fallback** quand Piped est indisponible. Il expose la même interface que `audio-player.js` pour permettre le dual mode.

### `audio-player.js` — Lecteur audio Piped (mode DSP) [nouveau]
- Crée un `<audio crossOrigin="anonymous" preload="auto">` et le branche dans le graphe Web Audio via `AudioEngine.createDeckChain(deckId)`.
- **Même interface que `youtube.js`** : `loadVideoById`, `cueVideoById`, `playVideo`, `pauseVideo`, `seekTo`, `setVolume` (no-op — le volume est géré par les `GainNode`), `mute`/`unMute` (via un `GainNode` de mute), `getCurrentTime`, `getDuration`, `getPlayerState`.
- `loadVideoById(id)` → interroge `PipedStreams.fetchStreamInfo(id)` → sélectionne le flux audio → `audio.src = streamUrl` → `audio.load()`.
- **Mapping d'états** `<audio>` → constantes `YTWrapper.STATE` : `playing`→PLAYING, `pause`→PAUSED, `waiting`→BUFFERING, `ended`→ENDED, `canplay`→CUED, `loadstart`→UNSTARTED.
- **Gestion d'expiration** : si `audio.error` → re-fetch via `PipedStreams.refreshStream`, restaurer la position, reprendre si en lecture.
- `playVideo()` doit appeler `AudioEngine.resume()` (débloquer `AudioContext` après geste utilisateur).

### `audio-engine.js` — Moteur Web Audio API [nouveau]
- `AudioContext` unique, créé au premier geste utilisateur.
- **Graphe par voie** (A et B) :
  ```
  MediaElementAudioSourceNode → BiquadFilter(lowshelf, 200Hz)
    → BiquadFilter(peaking, 1000Hz, Q=1) → BiquadFilter(highshelf, 4000Hz)
    → BiquadFilter(DJ filter: lowpass↔highpass) → GainNode(deckGain)
    → AnalyserNode(fftSize=2048) → GainNode(masterGain) → ctx.destination
  ```
- `applyCrossfade(p)` : règle les `deckGain` en equal-power (`cos`/`sin`). Ramping fluide via `setTargetAtTime`.
- `setEQ(deck, band, gainDb)` : règle le gain d'un `BiquadFilterNode` (low/mid/high). Range ±12dB.
- `setDjFilter(deck, position)` : position `-1..0..+1` → lowpass (gauche), bypass (centre), highpass (droite).
- `getAnalyser(deck)` : retourne l'`AnalyserNode` pour le visualizer.
- **Réutilisation du `MediaElementAudioSourceNode`** : un élément ne peut être connecté qu'une fois. Changer `audio.src` garde le nœud valide.

### `piped-streams.js` — Client flux Piped [nouveau]
- `fetchStreamInfo(videoId, signal)` : appelle `GET /streams/{videoId}` sur les instances Piped en cascade (même logique que `search.js`).
- `selectBestAudio(audioStreams)` : choisit le flux audio-only avec le meilleur bitrate (OPUS > M4A > WEBMA).
- **Construction d'URL CORS-safe** : si l'URL est directe (`googlevideo.com`), la proxifier via `proxyUrl` pour activer CORS `*`.
- **Cache en mémoire** : `{ videoId → { streamUrl, fetchedAt, expiresAt } }`.
- **Détection d'expiration** : re-fetch automatique sur erreur `<audio>`.

### `visualizer.js` — Visualisation [nouveau]
- `createVisualizer(canvas, analyser, options)` : boucle `requestAnimationFrame` qui dessine le spectre (`getByteFrequencyData`) ou la waveform (`getByteTimeDomainData`).
- Un canvas par voie (dans `.deck`) + un canvas master dans la barre de mixage.
- Performance : `fftSize=2048`, limiter à 30 FPS si besoin.

### `bpm-detector.js` — Détection BPM [nouveau]
- Récupère `analyser.getByteFrequencyData()` à intervalle régulier (~50ms).
- Isole la bande bass (20-150Hz), détecte les pics d'énergie (beats).
- Calcule les intervalles inter-beat → médiane → `bpm = 60000 / intervalleMoyen`.
- Filtre dans la plage 60-200 BPM. Approximatif (±2-3 BPM).
- `syncBtoA()` : ajuste `audioB.playbackRate` pour matcher le BPM de A (limité à ±8%).

### `search.js` — Recherche
- Si clé API présente : `GET https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&q=<query>&key=<key>` (`videoCategoryId=10` = Musique). Afficher vignette + titre + durée éventuelle.
- **Recherche sans clé via Piped** : `GET /search?q=…&filter=videos` sur les instances Piped en cascade. CORS activé, pas de clé Google. Bouton de bascule pour forcer Piped même avec une clé (préserve le quota Google).
- **Gestion d'erreurs obligatoire pour la recherche** :
  - **403 / 429** (quota dépassé) → message "Quota API dépassé, réessayer plus tard" + proposer le fallback URL manuelle ou Piped.
  - **400** (clé invalide) → message "Clé API invalide, vérifier dans les paramètres".
  - **Échec réseau / CORS** → message "Impossible de contacter l'API YouTube. Utiliser le mode sans clé (saisie d'URL) ou Piped."
  - **Pas de résultats** → message adapté, pas un tableau vide.
- **États d'UI du panneau de recherche** : `idle` (champ vide), `loading` (spinner), `results` (grille de résultats), `error` (message d'erreur selon le cas), `no-results`.
- Sélection d'un résultat → renvoie le `videoId` au lecteur de la voie concernée (A ou B).
- Fallback sans clé : champ acceptant URL (`youtu.be/...`, `watch?v=...`, `/shorts/...`, `/embed/...`) ou ID brut → extraire le `videoId`.

### `mixer.js` — Crossfader
- État : `crossfade` (0–100), `masterVolume` (0–100), `isPlayingA/B`.
- **Mode Piped** : crossfade via `AudioEngine.applyCrossfade(crossfade / 100)` + `AudioEngine.applyMasterVolume(master)`. Ramping fluide via `GainNode.gain.setTargetAtTime()` (remplace le crossfade progressif par paliers `setInterval`).
- **Mode IFrame** : `playerA.setVolume(vA * master/100)` (idem B), equal-power `cos`/`sin`. Crossfade progressif par paliers conservé (`setInterval`).
- Calcul equal-power (commun) : `vA = Math.cos(p*Math.PI/2)*100`, `vB = Math.sin(p*Math.PI/2)*100`.
- Boutons : `play/pause` par voie + `play both` / `pause both`, `sync B on A`, `resync`.
- **Sync B → A — contrat détaillé** :
  - **Sync ponctuel** (au clic) : seek B au `currentTime` de A et lance B si A joue. C'est le comportement de base.
  - **Sync continu (optionnel, à activer par l'utilisateur)** : lancer une `setInterval(~1s)` qui compare `currentTime` des deux lecteurs. Si l'écart dépasse 0.5s (mode IFrame) ou 0.2s (mode Piped, plus précis), re-seeker le retardataire. Désactiver avec un bouton `resync off`.
  - **Important** : le sync continu n'est jamais parfait — le temps de seek + buffering crée une micro-coupure audible. À documenter dans l'UI.
  - **Drift (mode IFrame)** : les deux lecteurs YouTube ne sont pas synchronisés à la trame. Même avec sync continu, un écart résiduel de 200-500ms est normal.
  - **Drift (mode Piped)** : les éléments `<audio>` HTML5 sont plus précis. Le drift résiduel est plus faible (50-200ms typique). Le seuil de re-seek peut passer à 0.2s.
- Slider accessible au clavier, valeurs affichées.

### `app.js` — Bootstrap
- Initialise 2 lecteurs (A, B), 2 modules de recherche, le mixer.
- **Détection de mode** au démarrage : tente `PipedStreams.fetchStreamInfo` sur les vidéos de test. Si succès → mode Piped (Web Audio API, UI DJ). Si échec → fallback IFrame (volume-only, UI simplifiée). Mode manuel via Paramètres (auto / piped / iframe).
- Gère l'état global (joueur prêt, clé API, videoIds courants, mode actif par voie).
- **Stratégie de persistance en `localStorage`** :
  - `youtubeApiKey` : clé API YouTube Data.
  - `lastVideoIdA`, `lastVideoIdB` : derniers videoIds chargés.
  - `lastSearchQueryA`, `lastSearchQueryB` : dernières requêtes de recherche.
  - `lastSeekA`, `lastSeekB` : `currentTime` au moment de l'arrêt (pour reprise à la même position).
  - `playerMode` : mode de lecteur (auto / piped / iframe).
  - **Mode Piped DJ** : `eqLowA/MidA/HighA` (idem B), `djFilterA/B`, `pitchA/B`, `cueA/B`, `loopInA/OutA` (idem B).
  - Au reload : si `lastSeekA` existe, faire `seekTo(sec)` après `loadVideoById` pour reprendre à la position précédente (pas seulement recharger au début).
  - **Limite** : si le navigateur purge `localStorage` ou si l'utilisateur est en navigation privée, pas de persistance. C'est normal.
- **Gestion des erreurs globales** :
  - Si l'API YouTube ne charge pas (timeout après 10s), afficher un message "Impossible de charger YouTube. Vérifier votre connexion ou les bloqueurs de pub."
  - Si un lecteur est en erreur, afficher un message dans sa voie, pas dans toute l'application.
  - Si la clé API est invalide, le signaler dans l'interface de configuration, pas seulement dans la console.
  - **Mode Piped** : si CORS bloqué (AnalyserNode = silence après 1s de lecture) → basculer la voie en IFrame. Si toutes les instances Piped sont down → fallback IFrame global.

## Plan d'implémentation (ordre suggéré)

### Phase 1 — App web IFrame (terminée, voir `tasks-list.md`)

1. **Squelette HTML/CSS** : grille 2 colonnes responsive + barre fixe en bas. Lecture visuelle correcte avant toute logique.
2. **Chargement IFrame API + 2 lecteurs** : afficher 2 vidéos de test (IDs codés en dur), vérifier `playVideo`/`setVolume` depuis la console.
3. **Crossfader** : slider lié aux volumes des 2 lecteurs. C'est le cœur fonctionnel — à valider tôt.
4. **Recherche** : champ + résultats dans chaque voie (avec clé API utilisateur saisie via UI).
5. **Contrôles avancés** : sync, play/pause both, master volume, persistance.
6. **Polissage** : responsive, raccourcis clavier, état visuel des voies.

### Phase 2 — Migration Piped / Web Audio API (voir `piped-enhancement-tasks-list.md`)

1. **Validation CORS** (critique) : vérifier que les flux audio Piped sont utilisables avec Web Audio API.
2. **Client Piped Streams** : `piped-streams.js` — fetch `/streams/{videoId}`, sélection flux, cache, expiration.
3. **Moteur audio** : `audio-engine.js` — AudioContext, graphe par voie (source → EQ → filtre → gain → analyser).
4. **Lecteur audio Piped** : `audio-player.js` — `<audio>` + `MediaElementAudioSourceNode`, même interface que `youtube.js`.
5. **Crossfader Web Audio** : remplacer `setVolume` par `GainNode` (ramping fluide).
6. **Abstraction dual mode** : bascule transparente Piped ↔ IFrame, fallback automatique.
7. **EQ + filtre DJ** : `BiquadFilterNode` 3 bandes + sweep LP↔HP.
8. **Visualisation** : canvas spectre/waveform via `AnalyserNode`.
9. **BPM & beatmatch** : détection tempo temps réel, slider pitch, sync BPM.
10. **Cue & loop** : marqueurs, boucles, loop de N beats.
11. **UI/UX DJ** : layout, knobs/faders, waveforms, badges de mode.

## Conventions de code

- JS vanilla, **pas de dépendances externes** (pas de React, pas de jQuery).
- Noms en `camelCase`, constantes en `UPPER_SNAKE`.
- Un seul état global dans `app.js` (objet `state`), les modules reçoivent leurs dépendances en paramètre (pas d'import circulaire).
- Commentaires courts en français, noms de variables en anglais.
- Pas de console.log en production finale (sauf erreurs critiques).
- **Web Audio API** : utiliser un seul `AudioContext` partagé. Ne jamais créer un `AudioContext` par voie. Les nœuds (`BiquadFilterNode`, `GainNode`, `AnalyserNode`) sont créés par voie mais connectés au même `masterGain → destination`.
- **Instances Piped** : la liste `PIPED_INSTANCES` et le timeout `PIPED_INSTANCE_TIMEOUT_MS` sont partagés entre `search.js` et `piped-streams.js` (définis dans `config.js`).

## À ne pas faire

- ❌ Brancher l'iframe YouTube dans Web Audio API (impossible, cross-origin, pas de CORS sur l'iframe).
- ❌ En mode IFrame, tenter un mixage DSP (EQ, filtres, analyse) — impossible par construction.
- ❌ Créer plus d'un `MediaElementAudioSourceNode` pour le même élément `<audio>` (en mode Piped). Réutiliser le même élément en changeant `src`.
- ❌ Oublier `crossOrigin="anonymous"` sur l'élément `<audio>` en mode Piped — sinon l'audio est "tainted" et l'`AnalyserNode` reçoit du silence.
- ❌ Embarquer une clé API dans le code source.
- ❌ Introduire un bundler / framework / serveur Node.
- ❌ Stocker des données utilisateur ailleurs que `localStorage`.
- ❌ Appeler l'API YouTube Data sans que l'utilisateur ait fourni sa clé (sauf recherche via Piped qui ne nécessite pas de clé).
- ❌ Promettre un sync parfait — en mode IFrame (drift 200-500ms) comme en mode Piped (drift 50-200ms). Le sync continu n'est jamais frame-accurate.
- ❌ Promettre un BPM précis à l'unité près — la détection est approximative (±2-3 BPM).

## Limites connues à documenter dans l'UI

- **Mode IFrame** : le "mixage" est un **crossfade de volumes**, pas un mixage DSP. Pas d'EQ, pas de tempo sync automatique.
- **Mode Piped** : le mixage est un **vrai crossfade audio** via `GainNode`, avec EQ, filtres, analyse spectrale et BPM. Mais **audio-only** (pas de vidéo) et dépendant des instances Piped (fiabilité variable).
- **CORS (mode Piped)** : si les instances Piped ne renvoient pas de CORS `*` sur les flux audio, le mode DSP est impossible. L'app bascule en IFrame.
- **⚠️ ATTENTION — Lourdeur de la double lecture :** La lecture simultanée de 2 vidéos (IFrame) ou 2 flux audio (Piped) peut être très lourde (CPU, RAM, réseau). Recommandations à afficher :
  - Fermer les autres onglets lourds.
  - Réduire la qualité vidéo (paramètre YouTube, non contrôlable par l'app) — en mode IFrame uniquement.
  - Sur machine modeste, préférer une seule voie à la fois.
  - Si la lecture saccade, baisser le volume de l'interface système.
- La clé API YouTube Data est soumise à **quotas Google** (10 000 unités/jour par défaut, une recherche = 100 unités). Au-delà, la recherche est bloquée jusqu'au lendemain. La recherche via Piped n'est pas soumise à ce quota.
- **Instances Piped publiques** : peuvent être lentes, indisponibles, ou rate-limitées. L'app essaie plusieurs instances en cascade, mais si toutes échouent, la recherche et/ou la lecture Piped est bloquée. Fallback IFrame ou saisie URL/ID manuelle.
- **Le sync continu n'est jamais parfait :** un écart résiduel de 200-500ms (IFrame) ou 50-200ms (Piped) est normal. Pas de sync frame-accurate possible sur YouTube.
- **Le BPM détecté est approximatif** (±2-3 BPM). Les transitions, builds et breaks peuvent fausser la détection. Le beatmatch n'est pas parfait.
- **La persistance est limitée :** en navigation privée ou après vidage du cache, les données sauvegardées (`localStorage`) sont perdues.
- **`localStorage` en WebView mobile** : peut être purgé par le système (iOS notamment). Ne pas garantir la persistance en navigation mobile.

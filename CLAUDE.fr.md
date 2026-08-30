# YT Music Web Mixer — Guide des agents

Mixeur DJ web double platine (HTML/vanilla JS + backend Express) fonctionnant en dual-mode :
- **Mode backend local (Primaire, DSP)** : Flux audio extrait via `yt-dlp` en local (`/api/streams/:id`), relayé en same-origin (`/api/audio/:id`), traité via la Web Audio API (crossfade, EQ 3 bandes, filtre DJ, visualiseur spectre/forme d'onde, BPM, pitch/tempo, cue/loop).
- **Mode Piped (Fallback, DSP)** : Flux issus de l'API Piped (`/streams/:id`) via Web Audio API si les en-têtes CORS le permettent.
- **Mode IFrame (Fallback, Volume seul)** : Lecteur YouTube IFrame classique ; crossfade par `setVolume()`. Aucun mixage DSP possible.

## 📋 Principes de codage (KISS, YAGNI, DRY, SRP, ISP)

- **KISS** : Privilégier les solutions simples et fonctionnelles aux architectures complexes.
- **YAGNI** : N'implémenter que les fonctionnalités expressément demandées ou prouvées nécessaires.
- **DRY** : Factoriser la logique commune sans abstraction prématurée.
- **SRP** : Une seule responsabilité par module (lecteur, graphe audio, mixeur, recherche).
- **ISP** : Interfaces minimales et partagées (`audio-player.js` et `youtube.js` partagent la même API).

## 🎯 Objectif produit

- Deux platines côte à côte : **A** (gauche) et **B** (droite), chacune avec lecteur et barre de recherche.
- Barre d'outils inférieure : **crossfader A↔B** (0=A, 50=équilibré, 100=B), transport (lecture/pause, sync, volume master).
- **Mode DSP (Local/Piped)** : EQ 3 bandes, filtre balayage (sweep), pitch/tempo, détection BPM, beatmatch, points cue, boucles, visualiseur.

## 🔴 Contraintes techniques

### Contraintes communes (IFrame + DSP)
1. **Aucun accès au flux audio YouTube via IFrame** : L'API IFrame ne fournit ni `AudioBuffer` ni `MediaElementAudioSourceNode` (cross-origin, sans CORS). La Web Audio API ne peut pas s'y connecter. Le mode IFrame utilise uniquement le contrôle de volume.
2. **Calcul du crossfade** : Courbe equal-power : `vA = cos(p·π/2)*100`, `vB = sin(p·π/2)*100` (avec `p = crossfade/100`).
   - IFrame : `player.setVolume(v)`.
   - DSP : `GainNode.gain.setTargetAtTime()` sur les gains de platine.
3. **Politique d'autoplay** : Les lecteurs doivent démarrer muets (`muted`). Proposer un bouton explicite "Activer le son" (démuté) par platine. En mode DSP, débloquer l'`AudioContext` via `ctx.resume()` au premier geste utilisateur.
4. **Recherche sans clé serveur codée en dur** :
   - Option 1 : Clé API YouTube Data v3 fournie par l'utilisateur, stockée dans `localStorage`.
   - Option 2 (Sans clé) : API de recherche Piped (`/search?q=…&filter=videos`) en cascade.
   - Option 3 : Saisie manuelle d'URL ou d'identifiant vidéo.
   - Ne jamais coder de clé API en dur dans le code source.
5. **Aucun build/bundler côté frontend** : Simple HTML + scripts JS vanilla dans `js/`.
6. **Hébergement** : `file://` gère uniquement le mode IFrame minimal. Le backend Express (`http://127.0.0.1:5400`) est recommandé pour le mode DSP.

### Contraintes du mode DSP (Web Audio API)
7. **CORS et relais audio** : Le relais same-origin `/api/audio/:id` évite le marquage "tainted" du canvas/analyseur audio. Le fallback Piped utilise les URLs de flux proxifiées si disponibles.
8. **MediaElementAudioSourceNode** : Connecter un élément `<audio>` redirige tout le son vers le graphe Web Audio jusqu'à `ctx.destination`. L'élément doit porter `crossOrigin="anonymous"`.
9. **Réutilisation des nœuds** : Un élément `<audio>` ne peut être relié à `createMediaElementSource` qu'une seule fois. Lors d'un changement de piste, mettre à jour `audio.src` sur l'élément existant sans recréer le nœud.
10. **Expiration des URLs de flux** : Le backend local réextrait automatiquement l'URL CDN en cas d'erreur 403/410. En mode Piped, appeler `PipedStreams.refreshStream(videoId)` sur erreur et restaurer `currentTime`.
11. **Audio uniquement en mode DSP** : Le DSP utilise les `audioStreams` (aucun affichage vidéo).
12. **Préservation du pitch** : Définir `audio.preservesPitch = true` (avec préfixes `mozPreservesPitch`, `webkitPreservesPitch`) lors de la modification du `playbackRate`.
13. **Transparence dual-mode** : Bascule automatique entre DSP et IFrame. Badge de mode affiché par platine. Masquage des contrôles DSP en mode IFrame.

## 📁 Architecture des fichiers

```
yt-music-web-mixer/
├── index.html                   # Structure : header, platines A & B, barre de mixage basse
├── package.json                 # Dépendances Node (express) & scripts
├── start.sh / start.bat         # Script de lancement (serveur Express sur le port 5400)
├── css/styles.css               # Grille 2 colonnes, barre de mixage fixe, contrôles DJ
├── server/server.js             # Backend Express : fichiers statiques + extraction yt-dlp + relais audio
└── js/
    ├── app.js                   # Bootstrap, détection de mode, état global, persistance
    ├── config.js                # Constantes, endpoints API, instances Piped, valeurs audio par défaut
    ├── youtube.js               # Wrapper de l'API YouTube IFrame (mode fallback)
    ├── audio-player.js          # Lecteur HTML5 <audio> + intégration Web Audio (mode DSP)
    ├── audio-engine.js          # Graphe Web Audio : EQ, filtre, gain, analyseur
    ├── piped-streams.js         # Client de flux : priorité backend local + cascade Piped fallback
    ├── visualizer.js            # Visualiseur canvas spectre et forme d'onde via AnalyserNode
    ├── bpm-detector.js          # Détection BPM temps réel (pics d'énergie dans les basses)
    ├── search.js                # Recherche YouTube Data API + Piped & rendu des résultats
    ├── mixer.js                 # Logique du crossfader, contrôles de transport, moteur de synchronisation
    └── local-load.js            # Importation de fichiers et index de la bibliothèque locale
```

### Spécifications des modules

- **`server/server.js`** : Backend local Node/Express sur le port 5400 (`127.0.0.1`). Routes :
  - `GET /api/session` : Initialisation de session / échange de jeton.
  - `GET /api/health`, `/api/ready` : Vérification de la disponibilité de yt-dlp.
  - `GET /api/streams/:id` : Exécute `yt-dlp -f ba -J`, retourne un JSON compatible Piped pointant vers `/api/audio/:id`.
  - `GET /api/audio/:id` : Relais de streaming same-origin avec support HTTP Range.
  - `GET /api/meta/:id`, `GET /api/download/:id` : Métadonnées et cache de téléchargement borné.
- **`audio-engine.js`** : `AudioContext` unique et partagé.
  - Graphe par platine : `MediaElementAudioSourceNode -> BiquadFilter(lowshelf 200Hz) -> BiquadFilter(peaking 1kHz) -> BiquadFilter(highshelf 4kHz) -> BiquadFilter(filtre DJ LP/HP) -> GainNode(deckGain) -> AnalyserNode(2048) -> GainNode(masterGain) -> destination`.
  - Méthodes : `applyCrossfade(p)`, `setEQ(deck, band, gainDb)`, `setDjFilter(deck, pos)`, `getAnalyser(deck)`.
- **`audio-player.js`** : Encapsule `<audio>` avec la même interface que `youtube.js` (`loadVideoById`, `playVideo`, `pauseVideo`, `seekTo`, `setVolume`, `mute`, `unMute`, `getCurrentTime`, `getDuration`, `getPlayerState`).
- **`youtube.js`** : Charge l'API YouTube IFrame de façon asynchrone (`createPlayer`). Gère la file d'attente et les erreurs (100, 101, 150).
- **`piped-streams.js`** : Teste d'abord le backend local `/api/streams/:id` sous HTTP(S), puis bascule vers la cascade `PIPED_INSTANCES`. Sélectionne le meilleur flux audio (OPUS > M4A > WEBMA). Gère le cache mémoire et l'expiration.
- **`bpm-detector.js`** : Analyse la bande 20-150Hz, détecte les intervalles de beat, calcule le BPM médian (plage 60-200, précision ±2-3 BPM). `syncBtoA()` ajuste le `playbackRate` dans une limite de ±8%.
- **`mixer.js`** : Gestion du crossfader et de la synchronisation :
  - **Sync instantané** : Cale la platine en retard sur le `currentTime` de la platine meneuse.
  - **Sync continu (optionnel)** : Vérification par intervalle de 1s. Recalage si dérive > 0.5s (IFrame) ou > 0.2s (DSP). Dérive résiduelle normale : 200-500ms (IFrame), 50-200ms (DSP).
- **`search.js`** : États d'interface (`idle`, `loading`, `results`, `error`, `no-results`). Analyse les résultats de recherche ou URLs directes (`youtu.be`, `watch?v=`, `/shorts/`, `/embed/`, ID brut).
- **`app.js`** : Orchestration, détection automatique au démarrage et persistance `localStorage` (`youtubeApiKey`, `lastVideoIdA/B`, `lastSeekA/B`, `playerMode`, réglages EQ/filtre/pitch/cue/loop).

## 📜 Conventions de code

- JavaScript vanilla pur, aucune dépendance ni framework côté frontend.
- Backend local : Node/Express (`server/server.js`), port 5400 (`process.env.PORT`).
- Nommage : `camelCase` pour variables/fonctions, `UPPER_SNAKE` pour constantes.
- État : État global unique dans `app.js` ; injection des dépendances en paramètres dans les modules.
- Un seul `AudioContext` partagé pour toutes les platines (ne jamais en créer un par platine).
- Commentaires courts en français, code et identifiants en anglais. Aucun `console.log` en production.

## ❌ Pratiques interdites

- ❌ Connecter une iframe YouTube à la Web Audio API (impossible en raison de CORS).
- ❌ Tenter un traitement DSP (EQ, filtres, analyse) en mode IFrame.
- ❌ Créer plusieurs `MediaElementAudioSourceNode` pour le même élément `<audio>`.
- ❌ Oublier `crossOrigin="anonymous"` sur l'élément `<audio>` en mode DSP.
- ❌ Coder en dur des clés API dans les sources.
- ❌ Ajouter des bundlers/frameworks frontend (React, Vue, Vite, Webpack).
- ❌ Étendre le périmètre du backend au-delà de l'extraction, du relais et du cache audio borné.
- ❌ Stocker des données utilisateur ailleurs que dans `localStorage`.
- ❌ Promettre une synchronisation frame-accurate ou une détection de BPM exacte à l'unité.

## ⚠️ Limites d'interface connues

- **Mode IFrame** : Crossfade de volume uniquement. Pas d'EQ, de visualiseur ou de sync tempo.
- **Mode DSP** : Mixage audio complet, mais audio pur (sans rendu vidéo).
- **Charge de la double lecture** : La lecture simultanée sollicite CPU et réseau ; avertir l'utilisateur sur machines modestes.
- **Quota API YouTube** : Limite YouTube Data API v3 à 10 000 unités/jour (recherche = 100 unités). La recherche Piped contourne ce quota.
- **Micro-coupures de synchronisation** : Le calage continu entraîne de légères interruptions audibles dues au buffering.

## 🔒 Invariants de sécurité du backend local

- Écoute strictement limitée au loopback (`127.0.0.1`) ; ne jamais exposer sur `0.0.0.0`.
- Utiliser une liste blanche statique explicite ; ne jamais faire `express.static(ROOT)`.
- Aucun CORS `*` sur `/api` ; conserver le jeton `X-Local-Token` en mémoire uniquement.
- `createApp()` doit rester importable sans démarrer le serveur ; `startServer()` gère le démarrage.
- Cookies de navigateur opt-in, cache borné, pistes DJ limitées à 30 min, tranches de scratch à 10 min.

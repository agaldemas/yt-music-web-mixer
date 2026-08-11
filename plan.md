# Plan — Phase 3 : Chargement IFrame API + 2 lecteurs

Objectif : charger l'API IFrame YouTube, créer 2 lecteurs (A, B) démarrant en muted, avec gestion d'erreurs et vidéos de test, sans logique de mixage (phase 4) ni recherche (phase 5).

## 1. `js/config.js` — ajouts

Ajouter des constantes pour la phase 3 :
- `TEST_VIDEO_A` / `TEST_VIDEO_B` : IDs YouTube de test (chargés au démarrage via `cueVideoById`, sans lecture auto).
- `API_LOAD_TIMEOUT_MS = 10000` : timeout de chargement de l'API.
- `PLAYER_VARS` : `{ rel: 0, playsinline: 1, origin: window.location.origin, controls: 1, modestbranding: 1 }`.

## 2. `js/youtube.js` — wrapper IFrame API

Responsable du chargement de l'API et de la création des lecteurs.

- **Chargement asynchrone** : injecter `<script src="https://www.youtube.com/iframe_api">`.
- **File d'attente** : l'API n'est pas prête immédiatement. Maintenir un tableau `_pendingCalls` et un flag `_apiReady`. Exposer `onYouTubeIframeAPIReady` (callback global attendu par l'API).
- **Timeout 10s** : si l'API ne charge pas, appeler un callback d'erreur global → message dans l'UI (en-tête ou banner).
- **`createPlayer(elementId, { videoId, onReady, onStateChange, onError })`** :
  - Si l'API est prête → crée immédiatement un `YT.Player`.
  - Sinon → met en file, créera le joueur quand l'API sera prête.
  - `playerVars` depuis `config`.
  - Retourne un objet wrapper `{ loadVideoById, cueVideoById, playVideo, pauseVideo, seekTo, setVolume, mute, unMute, getCurrentTime, getDuration, getPlayerState, _ready }`.
  - Les méthodes internes vérifient que le joueur et l'API sont prêts (sinon no-op ou file d'attente).
- **Gestion `onError`** : codes 100/101/150 → message d'erreur clair (la levée d'erreur est gérée par `app.js` via le callback `onError`).

## 3. `js/app.js` — bootstrap (phase 3 uniquement)

- État global minimal `state = { players: { A: null, B: null }, ready: { A: false, B: false }, muted: { A: true, B: true } }`.
- Au chargement DOM :
  - Créer lecteur A (`#player-A`) avec vidéo de test A, callbacks `onReady` (marque `ready.A`, applique mute + volume initial via `setVolume`), `onStateChange` (log minimal pour debug phase 3), `onError` (affiche erreur dans la voie).
  - Idem lecteur B (`#player-B`).
  - Câbler les boutons **mute/unmute** par voie : `mute()`/`unMute()` + toggle `aria-pressed` + texte du bouton (🔇/🔊).
- Fonction `showDeckError(deck, message)` / `clearDeckError(deck)` : affiche/efface `.deck-error[data-deck=...]`.
- Fonction `showGlobalError(message)` : banner en-tête si l'API ne charge pas.
- **Pas de crossfade, pas de recherche, pas de persistance** dans cette phase (TODOs phase 4-6).

## 4. `index.html` — ajustements mineurs

- Ajouter un `<div id="api-error-banner">` caché sous l'en-tête pour l'erreur globale de chargement.
- Le placeholder `.player-placeholder` est masqué quand la vidéo est chargée (gestion JS).

## 5. `css/styles.css` — ajustements mineurs

- Style du banner d'erreur global (rouge, sous l'en-tête).
- S'assurer que les conteneurs `#player-A`/`#player-B` reçoivent bien une taille (la iframe YT remplit le parent).

## Hors périmètre (explicitement repoussé)

- ❌ Crossfade / calcul de volumes (phase 4)
- ❌ Recherche YouTube Data API + fallback URL (phase 5)
- ❌ Sync, play/pause both, persistance `localStorage` (phase 6)

## Critères de validation

- Au reload : 2 lecteurs visibles, chacun avec sa vidéo de test chargée (cue, pas de lecture auto).
- Les 2 lecteurs sont muted par défaut.
- Bouton « Activer le son » par voie : clic → unmute + changement d'icône.
- `playVideo` / `setVolume` testables depuis la console (`state.players.A.playVideo()`).
- Erreur YouTube (ID invalide) → message dans la voie concernée, pas dans toute l'app.
- Si l'API IFrame ne charge pas (timeout 10s) → banner d'erreur global.

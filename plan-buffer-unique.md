# Plan : Téléchargement complet unique du flux → buffer partagé (lecture + scratch)

## Problème
Le tee actuel complexifie le code et reste lent. L'utilisateur veut :
- **Une seule requête** qui télécharge le flux complet dans un buffer, une bonne fois pour toutes, dès le chargement du morceau.
- Le **même buffer** (copié) sert pour le scratch — plus de 2e fetch/XHR.
- **Plus de streaming progressif** : on attend le download complet, puis on joue.
- Chemin **unifié pour les fichiers locaux** (MP3/WAV/etc. importés) — même buffer, même scratch.

## Architecture cible

```
loadVideoById(id) / loadLocalFile(file)
        │
        ▼
  fetch(url) ──> ArrayBuffer unique  (1 seule requête, download complet)
        │
        ├──> new Blob([buf], {type: mime}) → audio.src = blobURL  (lecture <audio>)
        │                                      [plus de streaming]
        └──> buf.slice(0) → AudioEngine.loadDeckBufferFromBlob  (scratch, decodeAudioData)
```

- **Source unique de vérité** : l'ArrayBuffer téléchargé une fois.
- **Pas de streaming `audio.src = url`** en mode DSP — on branche toujours un Blob.
- Le scratch récupère le buffer déjà décodé (via `AE.getDeckBuffer` / `AE.getDeckBufferLoadPromise`), jamais de 2e requête.
- **Fichiers locaux** : `loadLocalFile(file)` lit le `File` directement en ArrayBuffer (pas de fetch réseau) — même pipeline.

## Changements par fichier

### 1. `js/audio-player.js` — cœur de la refonte

**Remplacer `setAudioSource(url)` par `loadDeckArrayBuffer(url, opts)`** qui :
- Fait `fetch(url)` + `res.body.getReader()` pour la progression.
- Récupère le `content-type` pour le MIME du Blob.
- Concatène les chunks → ArrayBuffer unique.
- Callback `onProgress(fraction)` pour l'UI (badge deck « ↓ X% »).
- À la fin : `new Blob([buf], {type}) → audio.src = blobURL; audio.load()` + `AE.loadDeckBufferFromBlob(deckId, buf.slice(0))`.
- Retourne une Promise<ArrayBuffer> (réutilisée, dédupliquée via `state.loadPromise`).

**`loadVideoById(id)`** : après `PipedStreams.fetchStreamInfo(id)`, appelle `loadDeckArrayBuffer(url)`. Puis `restoreRate` listener inchangé.

**`cueVideoById(id)`** : pareil, sans `pendingPlay`.

**`handleMediaError()`** : sur refresh, appelle `loadDeckArrayBuffer(newUrl)` + restaure `currentTime`.

**Nouveau `loadLocalFile(file)`** : accepte un `File` (ou blob URL). Lit `file.arrayBuffer()` (pas de réseau), même pipeline Blob+scratch. Corrige le bug actuel : `local.js` appelle `loadLocalFile` qui n'existe pas encore dans audio-player.js → crash silencieux.

**`state`** : ajouter `loadPromise: null` (dédup — si l'utilisateur clique play pendant le download, on attend la même promesse au lieu de relancer).

**Fallback** : si `fetch` échoue (CORS/réseau), retomber sur `audio.src = url` (streaming direct) + scratch via l'ancien XHR. Pas de régression.

**Révoquer l'ancien blob URL** au changement de source (déjà fait, à conserver).

### 2. `js/audio-engine.js` — déjà prêt (Phase 1)

`loadDeckBufferFromBlob`, `getDeckBufferLoadPromise`, `clearDeckBuffer` (avec `scratchLoadPromise`) sont déjà en place. **Aucun changement nécessaire.**

### 3. `js/scratch.js` — déjà prêt (Phase 1)

Le bloc de réutilisation tee dans `ensureBuffer` (récupère `AE.getDeckBuffer` ou attend `AE.getDeckBufferLoadPromise`) est déjà en place. **Aucun changement nécessaire.**

### 4. `js/local.js` — corriger le binding

Actuellement `local.js` appelle `AudioPlayer.createAudioPlayer(deckId).loadLocalFile(url)` mais `loadLocalFile` n'existe pas → crash. Corriger :
- Passer le `File` (pas juste une URL) à `loadLocalFile`.
- `createAudioPlayer` ne doit pas être rappelé à chaque clic (le player existe déjà dans `state.players[deck]`). Utiliser `state.players[deck].loadLocalFile(file)` ou exposer un helper.
- Le `File` lu via `.arrayBuffer()` → même pipeline que YouTube.

### 5. `js/app.js` — badges de progression (optionnel)

Brancher `onProgress` de `loadDeckArrayBuffer` sur le `DeckTransport` ou un badge deck existant pour afficher « ↓ X% » pendant le download. Si pas de hook simple, rester sur les logs console (déjà en place).

## Trade-off à confirmer

**Pas de lecture progressive** : le morceau ne démarre qu'après le download complet. Pour un fichier audio compressé de 3-5 Mo, c'est 1-3s sur une bonne connexion, plus si le CDN YouTube throttle. C'est le prix d'un seul téléchargement partagé. Le scratch exige de toute façon le buffer entier.

## Files modifiés

| Fichier | Changement |
|---|---|
| `js/audio-player.js` | Refonte `setAudioSource` → `loadDeckArrayBuffer`, ajout `loadLocalFile`, dédup `loadPromise`, fallback streaming |
| `js/local.js` | Corriger binding `loadLocalFile` (passer `File`, pas recréer le player) |
| `js/audio-engine.js` | Aucun (déjà prêt) |
| `js/scratch.js` | Aucun (déjà prêt) |
| `js/app.js` | Optionnel : badge progression download |

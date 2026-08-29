# Rapport de couverture des tests

Dernière exécution : 27 août 2026

> **Résumé court :** 3 fichiers JS en échec (1 structurel, 2 réseau Piped anti-bot).
> 13 pages HTML `test-*.html` couvrent les fonctions scratch, MES et métadonnées locales.
> 10 fichiers Node supplémentaires (non intégrés au `run-all.js`) ajoutent des tests spécialisés.

---

## 1. Suite Node.js — `tests/run-all.js` (5 fichiers)

| Fichier | Module testé | Assertions | Statut | Note |
|---|---|---|---|---|
| `test_audio_engine.js` | `js/audio-engine.js` | 93/94 pass | **❌ 1 échec** | Connexion `djFilter → deckGain` non vérifiée (structurel mineur) |
| `test_piped_streams.js` | `js/piped-streams.js` + `js/config.js` | — | **❌** | Anti-bot Piped HTTP 500 |
| `test_audio_player.js` | `js/audio-player.js` | — | **❌** | Mock DNS (`mock.cdn` non résolu) |
| `test_multi.js` | `js/piped-streams.js` | — | ⚠ non-bloquant | Anti-bot |
| `test_audio_track.js` | `js/piped-streams.js` | — | ⚠ non-bloquant | Anti-bot |

### 1.1 `test_audio_engine.js` — 93/94 ✓, 1 ✗

**Fonctions testées** (`js/audio-engine.js`) :

| API | Assertions | Statut |
|---|---|---|
| `AudioEngine.init()` | init lazy, idempotent | ✓ |
| `AudioEngine.getContext()` | null avant init, non-null après | ✓ |
| `AudioEngine.createDeckChain(deckId, audioEl)` | retourne chaîne, 9 noeuds, validation input, doublon | ✓ |
| Topologie du graphe | source→sourceMuteGain→scratchGain→lowShelf→midPeak→highShelf→djFilter→deckGain | **✗ 1** (djFilter→deckGain non vérifié) |
| `AudioEngine.applyCrossfade(p)` | equal-power, clamp [0,1], setTargetAtTime | ✓ |
| `AudioEngine.applyMasterVolume(v)` | gain 0..1 | ✓ |
| `AudioEngine.setEQ(deckId, band, gainDb)` | low/mid/high, clamp ±12dB, band inconnue | ✓ |
| `AudioEngine.setDjFilter(deckId, position)` | lowpass/bypass/highpass, clamp [-1,+1], log scale | ✓ |
| `AudioEngine.getAnalyser(deckId)` | retourne AnalyserNode | ✓ |
| `AudioEngine.getMasterAnalyser()` | retourne masterAnalyser | ✓ |
| `AudioEngine.destroyDeckChain(deckId)` | destroy, hasDeck, recréation | ✓ |
| `AudioEngine.resume()` | contexte suspendu → running | ✓ |
| `AudioEngine.CONST` | constantes | ✓ |

### 1.2 `test_piped_streams.js` — bloqué (anti-bot)

**Fonctions testées** (`js/piped-streams.js`) :

| API | Statut |
|---|---|
| `PipedStreams.fetchStreamInfo(videoId)` | ❌ (anti-bot) |
| `PipedStreams.refreshStream(videoId)` | ❌ (anti-bot) |
| `PipedStreams.selectBestAudio(entry)` | ❌ (anti-bot) |
| `PipedStreams.buildCorsSafeUrl()` | ❌ (anti-bot) |
| `PipedStreams.getCorsSafeUrl(entry, stream)` | ❌ (anti-bot) |
| `PipedStreams.getCachedStream(videoId)` | cache hit déjà testé structurellement (sans appel réseau) |
| `PipedStreams.clearCache(videoId)` | testé via multi |
| `PipedStreams.classifyError(err)` | ✓ (pas de réseau) |
| `PipedStreams.formatFrenchDate()` | testé |
| `PipedStreams.FORMATS` | constantes |

### 1.3 `test_audio_player.js` — 1 échec d'infra (mock DNS)

**Fonctions testées** (`js/audio-player.js`) :

| API | Assertions | Statut |
|---|---|---|
| `AudioPlayer.createAudioPlayer(deckId, opts)` | 12 méthodes exposées | ✓ |
| `AudioPlayer.STATE` | UNSTARTED..CUED | ✓ |
| `AudioPlayer._audioEventToState(event)` | 10 mappings | ✓ |
| `player.loadVideoById(videoId)` | fetchStreamInfo + set src | **✗ 1** (mock DNS) |
| `player.cueVideoById(videoId)` | src chargé sans erreur | ✓ |
| `player.playVideo()` | resume() + audio.play() | ✓ |
| `player.pauseVideo()` | audio.pause() | ✓ |
| `player.seekTo(sec)` | set currentTime | ✓ |
| `player.mute()` / `unMute()` | toggle volume | ✓ |
| `player.setVolume(v)` | no-op (GainNode) | ✓ |
| `player.getCurrentTime()` | retourne time | ✓ |
| `player.getDuration()` | retourne duration, NaN→0 | ✓ |
| `player.getPlayerState()` | retourne state | ✓ |
| Gestion expiration | refreshStream + reprise | ✓ |
| Erreur non-retryable | MEDIA_ERR_ABORTED ignoré | ✓ |
| Échec après 2 refresh | onError + message épuisement | ✓ |
| `player.loadLocalFile(file)` | testé via intégration | — |

### 1.4 `test_multi.js` — bloqué (anti-bot)

**Fonctions testées** (`js/piped-streams.js`) :

| Test | Statut |
|---|---|
| 3 videoIds différents (`lfmxnzJAbl8`, `dQw4w9WgXcQ`, `9bZkp7q19f0`) | ❌ anti-bot (1er OK via fallback vidéo) |
| Isolation cache (a1===a2, a1!==b1) | ❌ |
| `PipedStreams.clearCache()` | ❌ |

### 1.5 `test_audio_track.js` — bloqué (anti-bot)

**Test** : télécharge 512 Ko du flux MP4, cherche marqueurs `mp4a`/`Opus` pour valider piste audio.

| Test | Statut |
|---|---|
| `PipedStreams.fetchStreamInfo(videoId)` | ❌ anti-bot |
| Validation piste audio dans container | ❌ |

---

## 2. Tests Node supplémentaires (10 fichiers, non intégrés à `run-all.js`)

| Fichier | Module testé | Fonctions testées | Statut (dernier run connu) |
|---|---|---|---|
| `test_mixer.js` | `js/mixer.js` | `YTMixer.init()`, `applyVolumes()`, `setStepOptions()`, `setAutoXf()`/`isAutoXf()`, `setMode()`/`getMode()`/`isPipedMode()`, `syncBtoA()`, `toggleContinuousSync()`, `CONST` | ✓ (401 lignes, mock DOM) |
| `test_scratch_release.js` | `js/audio-engine.js` + `js/scratch.js` + `js/audio-player.js` + `js/deck-controls.js` | `engageScratch()`, `disengageScratch()`, `setScratchRate()`, `getScratchPosition()`, `createDeckChain()`, `loadDeckBufferFromBlob()`, `isScratchEngaged()` | Nécessite MP3 local |
| `test_scratch_detective.js` | `js/audio-engine.js` | `engageScratch()`, `disengageScratch()`, `setScratchRate()`, `getScratchPosition()`, `loadDeckBufferFromBlob()`, `createDeckChain()` | Nécessite MP3 local |
| `test-muxed.js` | yt-dlp + HTTP | Test flux MP4 muxé replayable | Hors ligne |
| `test-youtubei.js` | `youtubei.js` (Innertube) | Extraction + replay URL audio | Hors ligne |
| `test-assembly.js` | yt-dlp + HTTP | Stratégies de chunks 64K (A/B/C) | Hors ligne |
| `test-chunk-relay.js` | yt-dlp + HTTP | Re-extract-on-403 + reprise | Hors ligne |
| `cdp-runner.js` | — | Infrastructure CDP (Chrome headless) | Outil |

---

## 3. Pages HTML de test navigateur — 13 fichiers

Ces tests s'exécutent dans un navigateur avec un vrai `AudioContext` et un vrai élément `<audio>`. Ils servent les fonctions scratch et extraction de métadonnées.

### 3.1 `test-local-metadata.html` — Métadonnées ID3

**Fonctions JS testées** (`js/local-load.js`):

| Fonction | Rôle |
|---|---|
| `extractAudioMetadata(buf, mime, fileName)` | Parse ID3v2, extrait TIT2 (titre) et TPE1 (artiste) |
| `extractCoverImage(buf, mime)` | Parse frame APIC, extrait image de couverture |
| `loadLocal(deckId)` | FileReader → ArrayBuffer → affichage métadonnées |
| UI now-playing | `np-thumb`, `np-title`, `np-meta` display |

**UI testée** : sélection fichier, lecture/affichage titre + meta + vignette.

### 3.2 `test-mes-recreate.html` — MediaElementSource recreate

**Fonctions Web Audio testées** :

| Fonction | Rôle |
|---|---|
| `AudioContext.createMediaElementSource(audio)` | Création MES |
| `mes.disconnect()` | Déconnexion |
| `ctx.createMediaElementSource(audio)` | **Recreate** sur même élément (sujet au bug Chrome) |
| `analyser.getByteTimeDomainData()` | Mesure RMS après reconnect |

### 3.3 `test-scratch-listeners-spy.html` — Espion scratch

**Fonctions AudioEngine testées** (via `js/audio-engine.js`):

| Fonction |
|---|
| `AudioEngine.createDeckChain(deckId, audioEl)` |
| `AudioEngine.loadDeckBufferFromBlob(deckId, arrayBuffer)` |
| `AudioEngine.engageScratch(deckId)` |
| `AudioEngine.setScratchRate(deckId, rate)` |
| `AudioEngine.getScratchPosition(deckId)` |
| `AudioEngine.disengageScratch(deckId, posSec, wasPlaying)` |
| `AudioEngine.getContext()` |

### 3.4 `test-scratch-detective.html` — Détective snap-back

**Fonctions testées** : idem 3.3 + patching de `audio.currentTime` setter + `audio.pause()`, `audio.play()`, `audio.load()`. Espionne qui écrit quoi.

### 3.5 `test-scratch-real-fix.html` — Fix réel

**Fonctions testées** :

| Fonction |
|---|
| `AudioEngine.resume()` |
| `AudioEngine.createDeckChain(deckId, audioEl)` |
| `AudioEngine.loadDeckBufferFromBlob(deckId, arrayBuffer)` |
| `AudioEngine.getAnalyser(deckId)` |
| `AudioEngine.engageScratch(deckId)` |
| `AudioEngine.isScratchEngaged(deckId)` |
| `AudioEngine.disengageScratch(deckId, posSec, wasPlaying)` |
| `AudioEngine.hasDeck(deckId)` |

### 3.6 `test-scratch-isolated.html` — Isolation MES

**Test** : disconnect MES (sourceMuteGain) vs disconnect source (MediaElementSource) — impact sur le snap-back.

### 3.7 `test-scratch-deep.html` — Comparaison approfondie

**Test** : capture RMS détaillée (40 samples = ~800ms) entre référence et stratégie V3. Comparaison sample par sample.

### 3.8 `test-scratch-strategies.html` — 4 stratégies de fix

**Stratégies testées** :

| Strat | Algorithme |
|---|---|
| STRAT 1 (V3) | pause + currentTime + wait seeked |
| STRAT 2 | pause + load() + currentTime + wait seeked |
| STRAT 3 | Pas de pause, seek pendant scratch |
| STRAT 4 | Disconnect MES complet + reconnect |

### 3.9 `test-scratch-final.html` — STRAT 5 & 6

| Strat | Algorithme |
|---|---|
| STRAT 5 | Pause dès l'engage, MES déconnecté + audio paused |
| STRAT 6 | MES source.disconnect() pendant toute la durée |

### 3.10 `test-scratch-compare.html` — Comparaison RMS

**Test** : capture RMS quantitative (mean, max, first 20 samples) entre référence et post-scratch. Somme |delta| > 0.5 → snap-back.

### 3.11 `test-scratch-release.html` — 4 scénarios de release

**Fonctions testées** : `engageScratch()`, `disengageScratch()` (via `setupDeck` + `engageScratch`/`disengageScratch` mock).

**Scénarios** :

| Test | Scénario |
|---|---|
| 1 | Pause avant scratch (10s → 11.5s) |
| 2 | Lecture avant scratch (20s → 22s) |
| 3 | Scratch arrière (30s → 28s) |
| 4 | 3 scratches enchaînés |

### 3.12 `test-scratch-autotest.html` — Auto-test

**Test** : scénario 1 (wasPlaying=false), mesure RMS avant/après disengage. Capture via MediaStreamDestination.

### 3.13 `test-scratch-debug.html` — Debug interactif

**Test** : interface avec boutons (load, engage, seek, disengage, play, pause) + polling RMS continu. Manuel.

---

## 4. Matrice fonctions ↔ tests

| Module JS | Fonction | Test Node | Test HTML | Couverture |
|---|---|---|---|---|
| `audio-engine.js` | `init()` | `test_audio_engine.js` | — | ✓ |
| | `resume()` | `test_audio_engine.js` | `test-scratch-real-fix.html` | ✓ |
| | `getContext()` | `test_audio_engine.js` | `test-scratch-listeners-spy.html` | ✓ |
| | `createDeckChain()` | `test_audio_engine.js` | 10 fichiers HTML | ✓✓ |
| | `destroyDeckChain()` | `test_audio_engine.js` | — | ✓ |
| | `applyCrossfade()` | `test_audio_engine.js` | — | ✓ |
| | `applyMasterVolume()` | `test_audio_engine.js` | — | ✓ |
| | `setEQ()` | `test_audio_engine.js` | — | ✓ |
| | `setDjFilter()` | `test_audio_engine.js` | — | ✓ |
| | `getAnalyser()` | `test_audio_engine.js` | `test-scratch-real-fix.html` | ✓ |
| | `getMasterAnalyser()` | `test_audio_engine.js` | — | ✓ |
| | `hasDeck()` | `test_audio_engine.js` | — | ✓ |
| | `getDeckAudioElement()` | `test_audio_engine.js` | — | ✓ |
| | `engageScratch()` | `test_scratch_release.js` | 8 fichiers HTML | ✓✓ |
| | `disengageScratch()` | `test_scratch_release.js` | 8 fichiers HTML | ✓✓ |
| | `setScratchRate()` | `test_scratch_release.js` | 3 fichiers HTML | ✓ |
| | `getScratchPosition()` | `test_scratch_release.js` | 3 fichiers HTML | ✓ |
| | `isScratchEngaged()` | — | `test-scratch-real-fix.html` | ± |
| | `loadDeckBufferFromBlob()` | — | 4 fichiers HTML | ± |
| | `clearDeckBuffer()` | — | — | — |
| | `setDeckTrim()` | — | — | — |
| | `setPitch()` | — | — | — |
| | `getPitch()` | — | — | — |
| | `resetPitch()` | — | — | — |
| | `setDeckBufferLoadPromise()` | — | — | — |
| | `getDeckBufferLoadPromise()` | — | — | — |
| | `decodeDeckBuffer()` | — | — | — |
| | `seekScratch()` | — | — | — |
| | `getDeckBuffer()` | — | — | — |
| | `duckDown()` | — | — | — |
| | `duckUp()` | — | — | — |
| `piped-streams.js` | `fetchStreamInfo()` | `test_piped_streams.js` | — | ❌ anti-bot |
| | `refreshStream()` | `test_piped_streams.js` | — | ❌ anti-bot |
| | `selectBestAudio()` | `test_piped_streams.js` | — | ❌ anti-bot |
| | `getCorsSafeUrl()` | `test_piped_streams.js` | — | ❌ anti-bot |
| | `getCachedStream()` | `test_piped_streams.js` | — | ❌ anti-bot |
| | `clearCache()` | `test_multi.js` | — | ❌ anti-bot |
| | `classifyError()` | `test_piped_streams.js` | — | ✓ (pas de réseau) |
| `audio-player.js` | `createAudioPlayer()` | `test_audio_player.js` | — | ± infra DNS |
| | `loadVideoById()` | `test_audio_player.js` | — | ± infra DNS |
| | `cueVideoById()` | `test_audio_player.js` | — | ± |
| | `playVideo()` | `test_audio_player.js` | — | ✓ |
| | `pauseVideo()` | `test_audio_player.js` | — | ✓ |
| | `seekTo()` | `test_audio_player.js` | — | ✓ |
| | `mute()`/`unMute()` | `test_audio_player.js` | — | ✓ |
| | `setVolume()` | `test_audio_player.js` | — | ✓ |
| | `getCurrentTime()` | `test_audio_player.js` | — | ✓ |
| | `getDuration()` | `test_audio_player.js` | — | ✓ |
| | `getPlayerState()` | `test_audio_player.js` | — | ✓ |
| | `loadLocalFile()` | — | `test-local-metadata.html` | ± |
| `mixer.js` | `init()` | `test_mixer.js` | — | ✓ |
| | `applyVolumes()` | `test_mixer.js` | — | ✓ |
| | `setMode()`/`getMode()` | `test_mixer.js` | — | ✓ |
| | `isPipedMode()` | `test_mixer.js` | — | ✓ |
| | `syncBtoA()` | `test_mixer.js` | — | ✓ |
| | `toggleContinuousSync()` | `test_mixer.js` | — | ✓ |
| | `setAutoXf()`/`isAutoXf()` | `test_mixer.js` | — | ✓ |
| | `setStepOptions()` | `test_mixer.js` | — | ✓ |
| `local-load.js` | `extractAudioMetadata()` | — | `test-local-metadata.html` | ± |
| | `extractCoverImage()` | — | `test-local-metadata.html` | ± |
| `scratch.js` | `window.Scratch` (IIFE) | — | `test-scratch-real-fix.html` | ± |
| `deck-controls.js` | `window.DeckTransport` | — | — | — |
| `search.js` | — | — | — | — |
| `bpm-detector.js` | — | — | — | — |
| `visualizer.js` | — | — | — | — |
| `youtube.js` | — | — | — | — |
| `app.js` | — | — | — | — |

---

## 5. Lacunes identifiées

### Fonctions non testées (ni Node, ni HTML)

- **`audio-engine.js`** : `setDeckTrim()`, `setPitch()`/`getPitch()`/`resetPitch()`, `clearDeckBuffer()`, `getDeckBuffer()`, `decodeDeckBuffer()`, `duckDown()`/`duckUp()`, `seekScratch()`, `setDeckBufferLoadPromise()`/`getDeckBufferLoadPromise()`
- **`scratch.js`** : `window.Scratch.engage()`, `disengage()`, `enable()`, `disable()`, `wirePointerEvents()`, `ensurePlatterDOM()`, `ensureBuffer()`, `precache()`, `setRate()`, `seek()`, `invalidateBuffer()`, `flashStatus()`, `isBufferReady()`
- **`deck-controls.js`** : `window.DeckTransport.bind()` (toute l'UI transport)
- **`search.js`** : entier (search YouTube API + Piped + URL parsing)
- **`bpm-detector.js`** : entier
- **`visualizer.js`** : entier
- **`youtube.js`** : entier (IFrame API wrapper)
- **`app.js`** : entier (bootstrap, mode detection, localStorage persistence, error handling)
- **`local-save.js`** : entier
- **`server/server.js`** : entier (Express backend)

### Tests cassés/environnement

1. **Anti-bot Piped** : `test_piped_streams.js`, `test_multi.js`, `test_audio_track.js` — tous bloqués par HTTP 500 Piped. Solution : backend local `yt-dlp` + serveur Express.
2. **Mock DNS** : `test_audio_player.js` — `mock.cdn` non résolu en Node. Solution : configurer `global.fetch` mock ou ajouter `127.0.0.1 mock.cdn` dans hosts.
3. **Connexion `djFilter → deckGain`** : `test_audio_engine.js` test 5 — 1 assertion échouée. Vérifier si la connexion est bien faite (ou si le test est erroné).
4. **Tests HTML** : nécessitent un navigateur (Safari/Chrome) et un serveur HTTP. Le `cdp-runner.js` peut automatiser sur Chrome avec `--remote-debugging-port=9222`.

---

## 6. Pages HTML `test-*.html` — Fonctions testées par page

| Page HTML | Fonctions AudioEngine | Autres fonctions |
|---|---|---|
| `test-local-metadata.html` | — | `extractAudioMetadata()`, `extractCoverImage()`, `loadLocal()` |
| `test-mes-recreate.html` | `createMediaElementSource` (Web Audio API) | — |
| `test-scratch-listeners-spy.html` | `createDeckChain`, `loadDeckBufferFromBlob`, `engageScratch`, `setScratchRate`, `getScratchPosition`, `disengageScratch`, `getContext` | — |
| `test-scratch-detective.html` | `createDeckChain`, `loadDeckBufferFromBlob`, `engageScratch`, `setScratchRate`, `getScratchPosition`, `disengageScratch` | patching setter `currentTime`, `audio.pause()`, `audio.play()`, `audio.load()` |
| `test-scratch-real-fix.html` | `resume`, `createDeckChain`, `loadDeckBufferFromBlob`, `getAnalyser`, `engageScratch`, `isScratchEngaged`, `disengageScratch`, `hasDeck` | `captureRMS()` |
| `test-scratch-isolated.html` | `createMediaElementSource`, `source.disconnect()`, `sourceMuteGain.disconnect()` | — |
| `test-scratch-deep.html` | `createBufferSource`, MES disengage + seek | — |
| `test-scratch-strategies.html` | 4 stratégies de disengage (V3, load(), no-pause, disconnect MES) | — |
| `test-scratch-final.html` | STRAT 5 (pause dès engage), STRAT 6 (MES source.disconnect) | — |
| `test-scratch-compare.html` | RMS comparison reference vs post-scratch | — |
| `test-scratch-release.html` | 4 scénarios : pause, lecture, arrière, enchaînés | `setupDeck()`, `engageScratch()`, `disengageScratch()` |
| `test-scratch-autotest.html` | wasPlaying=false, reference @20s | — |
| `test-scratch-debug.html` | interactif manuel : load, engage, seek, disengage, play, pause | polling RMS continu |
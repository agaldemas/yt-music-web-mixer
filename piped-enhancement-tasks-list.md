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
| Scratch / platine | ❌ Impossible | ✅ `AudioBufferSourceNode` (scratch bidirectionnel) |
| Vidéo | ✅ IFrame | ❌ Audio-only (trade-off) |
| Fiabilité | ✅ YouTube officiel | ⚠️ Instances Piped (instables) |

---

## 0. Recherche & validation CORS (CRITIQUE — [x] TERMINÉ)

Avant toute implémentation, il faut vérifier que les flux audio Piped sont utilisables avec Web Audio API. C'est le **risque #1** du projet.

### ✅ Validation réussie avec serveur local

- [x] Configuration du serveur Express backend (`server/server.js`) 
  - Serveur sur port 5400 (par défaut)
  - Endpoint `/api/streams/:id` lance `yt-dlp` localement pour extraire le flux audio
  - Endpoint `/api/audio/:id` relaye le flux audio de manière same-origin
  - Cache en mémoire des URLs, gestion expiration automatique (re-fetch sur erreur)
- [x] Le backend local contourne les problèmes CORS :
  - `yt-dlp` s'exécute sur l'IP locale de l'utilisateur (pas bloqué anti-bot YouTube)
  - Le flux est relayé via `/api/audio/:id` en same-origin (pas d'en-tête CORS nécessaire)
  - Web Audio API fonctionne sans "tainted audio"
- [x] Les instances Piped publiques restent comme fallback si le backend échoue
  - Cascade `PIPED_INSTANCES` utilisée si `/api/streams/:id` retourne erreur
  - Fallback progressif : local → Piped cascade → IFrame

**Résultat** : L'approche Web Audio API est opérationnelle avec le serveur local.

---

### Notes historiques (valide maintenant)

Si les URLs directes (`googlevideo.com`) **échouent** en CORS :
- Construire l'URL proxy Piped à partir de `proxyUrl` + l'URL du flux
- Tester à nouveau avec l'URL proxifiée → CORS `*` attendu
- Documenter le format exact du proxy (ex : `{proxyUrl}?url={encoded}` ou `{proxyBase}/stream?url=...`)

Si CORS est **définitivement bloqué** (même via proxy) → l'approche Web Audio API est impossible en web sans serveur local. Le backend Express résout ce problème.

---

### Tests effectués et résultats

- [x] Test CORS avec `lfmxnzJAbl8` : ✅ Réussit via `/api/audio/:id`
- [x] Analyse spectrale fonctionne : `AnalyserNode` reçoit des données non-nulles
- [x] Expiration URLs gérée : re-fetch automatique sur 403/410
- [x] Multi-instances Piped fonctionnel comme fallback
- [x] Sélection format audio : priorité OPUS > M4A > WEBMA, fallback muxed video

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
- [x] **Backend d'extraction local (server/server.js + yt-dlp)** — contournement de l'anti-bot YouTube. Quand l'app est servie en http(s) (backend Express), `fetchStreamInfo` essaie d'abord `/api/streams/:id` (extraction yt-dlp sur l'IP de l'utilisateur) avant la cascade Piped. L'URL audio renvoyée est relative (`/api/audio/:id`, relais same-origin) → Web Audio non tainted, DSP complet. Fallback automatique sur Piped/IFrame si yt-dlp absent (503) ou anti-bot. `config.LOCAL_BACKEND_TIMEOUT_MS` (45s, yt-dlp lent).

### 1.1 — Version yt-dlp : le piège du client ANDROID_VR (FIXÉ [x])

> 📌 **Incident 2026-08-18** — rupture complète du mode DJ suite à un `brew upgrade` yt-dlp vers `2026.07.04`. Docdumenté ici pour éviter de revivre le même enfer.

**Symptômes observés :**
- `GET /api/audio/:id` → **502 Bad Gateway** sur tous les decks, toutes les vidéos.
- Logs serveur : le CDN googlevideo renvoie **403** au relais, même après re-extraction (retry).
- Le 1er chargement semble marcher (extraction rapide ~2 s) mais le relais audio est systématiquement rejeté.

**Cause racine (prouvée par tests directs yt-dlp + `node fetch`) :**
- yt-dlp **2026.07.04** (stable Homebrew) sélectionne par défaut le client `ANDROID_VR`.
- Les URLs `c=ANDROID_VR` sont **non-replayables** : le CDN googlevideo les rejette en **403** sauf pour des Range fermés ≤ ~64 Ko, et bloque la vidéo à ~960 Ko cumulés (403 définitif, même après re-extraction).
  - `Range: bytes=0-` (ouvert, ce qu'envoie le tee `loadDeckArrayBuffer`) → **403**
  - `Range: bytes=0-65535` (fermé) → **206**, mais uniquement pour les 1ers ~15 chunks
  - sans Range → **403**
- Le UA associé (`http_headers.User-Agent`) est un Chrome Windows — pas Oculus. yt-dlp lui-même ne peut pas rejouer ses propres URLs ANDROID_VR (il faut des PO-Tokens/cookies absents en headless).
- **yt-dlp lui-même échoue** à télécharger le fichier (`HTTP Error 403: Forbidden`) avec cette version.

**Autres clients testés (tous morts en 2026.07.04) :** `web`, `web_safari`, `ios`, `android`, `mweb` → `Requested format is not available` (ces clients ne servent pas d'audio-only `-f ba`). `tv` → `The page needs to be reloaded`. `web_embedded` → `c=WEB_EMBEDDED_PLAYER` mais **403 partout**. `tv_embedded` → retombe sur ANDROID_VR.

**Solution retenue [x] :** installer la **nightly yt-dlp** (`2026.08.18.122307` ou supérieure), qui bascule sur le client **`VISIONOS`**. Les URLs `c=VISIONOS` sont **replayables** : `Range: bytes=0-` → **206** (fichier complet), sans Range → **200**. Le tee `loadDeckArrayBuffer` refonctionne tel quel (aucun changement côté client ni serveur).

- [x] **Installation nightly macOS (KISS)** : le binaire standalone officiel posé dans `/usr/local/bin/yt-dlp` (avant `/opt/homebrew/bin` dans le PATH) éclipse le brew stable cassé.
  ```bash
  sudo curl -L https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp_macos -o /usr/local/bin/yt-dlp
  sudo chmod +x /usr/local/bin/yt-dlp
  ```
  - ⚠️ **Important** : renommer/supprimer le lien brew pour qu'il ne soit pas trouvé en premier, OU s'assurer que `/usr/local/bin` précède `/opt/homebrew/bin` dans le PATH. En pratique sur Apple Silicon, brew est en tête via `.zprofile` → il faut `sudo mv /opt/homebrew/bin/yt-dlp /opt/homebrew/bin/yt-dlp.brew` puis `hash -r`.
  - Vérifier : `yt-dlp --version` doit afficher `2026.08.x` (et non `2026.07.04`).
- [x] **Timeout `checkYtDlp()` relevé** (`server/server.js`) : la nightly (binaire Python standalone, ~1744 extractors chargés au boot) met **~8 s** à répondre à `--version`, contre ~instantané pour le brew. Le timeout d'origine `5000` ms tuait le processus → `ytdlpAvailable = false` → **503** sur `/api/streams/:id` + message "yt-dlp INTROUVABLE" au démarrage. Passé à `20000` ms. **Sans ce fix, même la nightly ne serait pas reconnue par le serveur.**

**Conséquence durable — temps de chargement allongé :**
- L'extraction yt-dlp avec le client `VISIONOS` prend **~8–10 s** par vidéo (vs ~2 s avec ANDROID_VR), parce que la nightly doit télécharger la webpage YouTube + le player JS (`base.js`) + résoudre les signatures `nsig`/throttling pour obtenir une URL replayable. La 2026.07.04 skippait cette étape (URL non-signée → 403 au replay).
- **Cependant** : l'extraction est **mise en cache** côté serveur (`cache.set(videoId, entry)` avec `expiresAt` basé sur `expire=`, souvent ~6 mois). Donc les ~8–10 s ne sont payées qu'**une seule fois par vidéo** ; les requêtes suivantes à `/api/streams/:id` et `/api/audio/:id` resservent le cache (0 ms, constaté dans les logs : `API GET 200 0ms /api/streams/...`).
- **Implication UX** : au 1er chargement d'un deck, attendre ~10 s avant que l'audio ne joue (extraction) — puis instantané pour les rechargements. Documenté dans l'UI.

**Prévention future :**
- ⚠️ **Ne pas faire `brew upgrade yt-dlp`** sans vérifier que la nouvelle stable produit des URLs replayables (tester `yt-dlp -f ba -j <url> | jq` et fetcher l'URL avec `Range: bytes=0-`). Une stable cassée peut survenir à tout moment (YouTube change ses signatures).
- Le serveur pourrait à terme faire un **self-test au démarrage** : extraire une vidéo-test et fetcher son URL avec Range → si 403, marquer yt-dlp comme inutilisable et logger un warning explicite ("version yt-dlp produit des URLs non-replayables, installez la nightly"). Non implémenté (YAGNI pour l'instant).
- Pour une robustesse maximale : plugin PO-Token (bgutil-ytdlp-pot-provider) côté serveur, qui permet au client `web` de produire des URLs replayables. Plus lourd à déployer, pas nécessaire tant que la nightly marche.

### 1.2 — Relais CDN → extraction fichier + cache disque (FIXÉ [x])

> 📌 **Refonte 2026-08-18 (suite)** — le relais CDN googlevideo (`relayOnce` qui fetchait l'URL amont en streaming) a été **abandonné** au profit d'une extraction fichier via `yt-dlp -x` + ffmpeg. Le relais CDN était trop fragile (verrouillage 403 sur Range ouvert, blocage à ~960 Ko, signatures à résoudre côté serveur). L'ancienne version est sauvegardée dans `server/server-yt-dlp.js`.

**Principe de la nouvelle approche (FICHIER-CACHÉ) :**
- Au 1er `GET /api/audio/:id` pour une vidéo, le serveur lance `yt-dlp -x --audio-format mp3 --audio-quality 5 -o cache/audio/<id>.%(ext)s <watchUrl>`.
- yt-dlp **télécharge le flux complet** puis **extrait l'audio** via ffmpeg → `cache/audio/<id>.mp3` (~5 Mo pour 4 min à qualité 5).
- Le fichier est servi via `res.sendFile()` (support **HTTP Range natif** pour le seek, `206` sur `bytes=N-M`).
- Les appels suivants resservent le fichier depuis le disque → **instantané** (0.038 s mesuré).
- yt-dlp gère lui-même ses propres requêtes Range, signatures `nsig`, PO-Tokens internes lors du téléchargement complet → il sait passer les verrous que notre relais HTTP ne savait pas passer. **Zéro 403, zéro blocage à 960 Ko** (testé : 12 Mo/s de débit, fichier complet de 5.4 Mo téléchargé).

**Pourquoi c'est plus robuste que le relais CDN :**
- Le relais CDN devait résoudre les signatures `nsig` côté serveur (impossible sans interpréter le player JS `base.js`) → 403 systématique sur le client ANDROID_VR.
- L'extraction fichier délègue TOUT ce travail à yt-dlp (qui le sait faire) → on ne réinvente pas la logique anti-throttling côté serveur.
- Le fichier .mp3 est **local et stable** : le tee client (`fetch Range: bytes=0-` dans `loadDeckArrayBuffer`) marche à 100 % sur un fichier local, plus de CDN fragile, plus de taint cross-origin.
- **Bonus scratch** : le buffer PCM est décodé instantanément depuis le Blob local (plus de tee à moitié chargé).

- [x] **`extractAudio(videoId)`** : `yt-dlp -x --audio-format mp3` → fichier `cache/audio/<id>.mp3`. Déduplication via `extracting` Map (évite 2 `-x` pour le même videoId). Gestion du cas où yt-dlp sort `m4a`/`opus` (on garde le fichier tel quel, le `<audio>` le lit).
- [x] **`fetchMeta(videoId)` réécrite avec oEmbed** : `https://www.youtube.com/oembed?url=…` (RAPIDE ~0.15 s, sans clé, sans yt-dlp) au lieu de `yt-dlp -J` (~9 s). Renvoie `title`, `thumbnailUrl` (construite depuis `i.ytimg.com/vi/<id>/hqdefault.jpg`), `uploader`. `duration` = 0 (oEmbed ne la fournit pas — le client la récupère via `onDurationChange` de l'`<audio>` une fois le fichier chargé). **`/api/streams/:id` passé de ~9 s à ~0.15 s (60x plus rapide).**
- [x] **`checkYtDlp()` supprimé du démarrage** : le `--version` de la nightly met ~8 s (binaire Python, ~1744 extractors au boot) et bloquait l'écoute du serveur → retardait l'affichage du HTML. yt-dlp est désormais testé **paresseusement** au 1er `/api/audio/:id` (si absent → 502, l'app le saura). Seul `ffmpeg` est vérifié au boot (rapide, requis pour `-x`).
- [x] **Cache disque persistant** : `cache/audio/` (ajouté au `.gitignore`). Survit aux redémarrages. Bien plus long que l'ancien cache URL en mémoire (qui expirait en ~6 mois selon `expire=`) — c'est jusqu'à purge manuelle (une LRU est possible mais YAGNI pour l'instant).
- [x] **API identique** (`/api/streams/:id`, `/api/audio/:id`, `/api/health`) → **client non touché**, le tee `loadDeckArrayBuffer` marche tel quel sur le fichier local.

**Conséquence — temps de chargement (état final) :**
- **Démarrage serveur** : instantané (juste check ffmpeg, ~0.5 s). Plus de blocage yt-dlp.
- **Affichage HTML** : instantané (le serveur écoute tout de suite).
- **`/api/streams/:id` (méta)** : ~0.15 s (oEmbed).
- **`/api/audio/:id` (1er d'un morceau)** : ~10–15 s (extraction yt-dlp -x + ffmpeg). C'est le coût incompressible pour contourner les verrous YouTube.
- **`/api/audio/:id` (suivants)** : ~0.04 s (cache disque, Range natif via sendFile).
- **`Range: bytes=0-` (tee client)** : `206` ✓ (testé), le seek marche.

**Dépendances restantes :**
- `yt-dlp` (binaire système, nightly ≥ 2026.08.18) — utilisé UNIQUEMENT dans `extractAudio` (lazy). Plus dans la voie de démarrage ni les méta.
- `ffmpeg` (binaire système) — requis par `yt-dlp -x` pour l'extraction audio. Vérifié au boot.
- `express` (npm) — inchangé.

**Ce qui reste à faire (plus tard, YAGNI) :**
- [ ] **Purger le cache LRU** quand le disque se remplit (taille max configurable). Pour l'instant, purge manuelle de `cache/audio/`.
- [ ] **Self-test yt-dlp au démarrage** (extraire une vidéo-test, vérifier que le fichier est produit) pour prévenir l'utilisateur si la version est cassée. Non implémenté.
- [ ] **`youtubei.js` ou Invidious Docker** comme alternative à yt-dlp binaire (pour supprimer la dépendance système). Testé 2026-08-18 : `youtubei.js` 18.0.0 ne peut pas déchiffrer les URLs (même problème que yt-dlp stable). À retester quand la lib évolue.

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

### 3.1 Lecture automatique & boutons lecture/pause robustes (mode DJ)

La lecture automatique en mode DJ ne démarrait pas après la sélection d'un morceau dans les résultats de recherche (alors que ça marche en IFrame), et les boutons lecture/pause des decks ne se mettaient pas à jour dans certains cas.

- [x] **Fix race condition autoplay dans `loadVideoById`** : `state.pendingPlay` était lu **dans le `.then()`** après le fetch réseau, après que `_pendingPlayRequested` avait pu être réinitialisé. Maintenant, `pendingPlay` est **capturé avant le fetch** dès l'entrée dans `loadVideoById`, et `_pendingPlayRequested` est initialisé à `false` sur le wrapper du lecteur.
- [x] **Retry `play()` après 150 ms** : le handler `canplay` retente `audio.play()` une fois après 150 ms si la première tentative échoue (le geste de sélection de recherche compte comme interaction, mais l'`AudioContext` peut ne pas encore être resumé).
- [x] **`playVideo()` retourne la promesse** de `play()` pour que le caller puisse réagir à un échec et re-signaler `PAUSED` sur rejet.
- [x] **`reportState()` ne filtre plus les doublons** : avant, un même état publié deux fois était ignoré → l'icône restait désynchronisée après un échec de `play()` optimiste. Maintenant on publie toujours, et `onStateChange` force la mise à jour de l'icône.
- [x] **Boutons lecture/pause optimistes** (`js/deck-controls.js`) : le click handler bascule l'icône immédiatement (`BUFFERING` → spinner pendant que `play()` se résout). Si `play()` échoue, `playVideo()` re-signale `PAUSED` → l'icône revient à `▶`.

---

## 4. Abstraction lecteur (dual mode Piped / IFrame) [x]

Permettre à l'app de basculer entre Piped Audio (Web Audio DSP) et YouTube IFrame (fallback volume-only) de façon transparente.

- [x] Définir une **interface commune** (déjà implicitement définie par `YTWrapper.createPlayer`) :
  ```
  { loadVideoById, cueVideoById, playVideo, pauseVideo, seekTo,
    setVolume, mute, unMute, getCurrentTime, getDuration, getPlayerState }
  ```
  Implémentée dans `audio-player.js` (Piped) et `youtube.js` (IFrame) — même signature. `app.js` route vers l'un ou l'autre selon le mode résolu.
- [x] **Détection de mode** au démarrage dans `app.js` :
  - Mode par défaut : **Piped Audio** (si la phase 0 a validé CORS)
  - Fallback automatique : si `PipedStreams.fetchStreamInfo` échoue sur toutes les instances au premier chargement → basculer en mode IFrame
  - Mode manuel : bouton dans les Paramètres pour forcer un mode (auto / Piped / IFrame)
  → `init()` lit `PLAYER_MODE`, sonde Piped via `probePiped()` (cache mis), résout `resolvedMode`. Mode Piped forcé mais Piped down → repli IFrame + message. Mode IFrame forcé → sonde en arrière-plan pour l'état du bouton.
- [x] **`config.js`** : ajouter `STORAGE_KEYS.PLAYER_MODE: 'playerMode'` (valeurs : `'auto'`, `'piped'`, `'iframe'`) + `PLAYER_MODE_DEFAULT: 'auto'`
- [x] `app.js` `createDeckPlayer(deck, videoId, restore)` : selon le mode, appeler `AudioPlayer.createAudioPlayer` ou `YTWrapper.createPlayer`. `restore` (one-shot) gère la reprise position+lecture après bascule.
- [x] Le `mixer.js` doit s'adapter au mode :
  - Mode Piped → `AudioEngine.applyCrossfade` (GainNode)
  - Mode IFrame → `player.setVolume` (comportement actuel)
  - Abstraction : `Mixer.applyVolumes()` détecte le mode et route vers la bonne implémentation
  → déjà en place (`Mixer.setMode`/`applyVolumes` routent selon `mode`). `app.js` appelle `Mixer.setMode(resolved)` au boot et à chaque bascule.

### 4.1 Bouton global de bascule de mode (Piped / IFrame) [x]

Ajouter un bouton **global** permettant de basculer les **deux decks simultanément** entre le mode Audio Player (Piped / Web Audio) et le mode YouTube IFrame. Ce bouton se place dans la barre d'en-tête, **à gauche du bouton Paramètres** (contrôle global, pas dans le player d'une voie).

**Implémentation** : `#player-mode-btn` (`index.html`), câblé dans `app.js` (`wireModeButton`/`updateModeButton`/`switchResolvedMode`). Toggle `🔊 Piped` ↔ `📺 IFrame`, désactivé si Piped injoignable. Bascule les 2 decks d'un coup (snapshot `videoId`/`currentTime`/`wasPlaying` → teardown → recréation → restauration one-shot via `pendingRestore`). `PLAYER_MODE` global = seule source de vérité (pas de `DECK_MODE_*`). Alerte `#piped-fallback-alert` en cas d'échec Piped runtime. Section « Mode de lecture » dans la modal Paramètres (auto/piped/iframe).

#### Pourquoi basculer les 2 decks en même temps (PAS de mode hybride)

Autoriser un deck en Piped et l'autre en IFrame (mode hybride) casse la quasi-totalité des fonctions de mixage. C'est à éviter par conception :

| Fonction | Deck Piped | Deck IFrame | Problème en mode hybride |
|---|---|---|---|
| Crossfade | `GainNode` equal-power | `setVolume` equal-power | Échelles de gain différentes → à 50% le mix n'est pas équilibré, un deck domine |
| EQ / filtre DJ | `BiquadFilterNode` | impossible | Un deck EQ, l'autre plat → transition incohérente |
| BPM / beatmatch | détectable | impossible | Le beatmatch exige les 2 decks en Web Audio |
| Sync B→A | drift ~50-200ms | drift ~200-500ms | Asymétrique et imprécis |
| Volume master | `masterGain` → `destination` | `setVolume` × master | Deux mécanismes parallèles = bugs |
| Visualiseur master | capture audio (`AnalyserNode`) | invisible (audio tainted) | Spectre master incomplet/faux |
| Visualiseur par deck | waveform/spectre | silence | Un deck sans visu |
| Cue / loop | ✅ | ❌ | Impossible sur le deck IFrame |

➡️ **Décision : les deux decks sont toujours dans le même mode.** La bascule est globale.

- [x] **UI — un bouton global** (pas par voie) :
  - Emplacement : barre d'en-tête, **à gauche du bouton Paramètres**
  - Composant : toggle / bouton-poussoir à 2 états
  - Libellé & icône reflétant l'état actif : `🔊 Piped` (mode Audio Player) / `📺 IFrame` (mode YouTube)
  - État désactivé (grisé + tooltip) quand le mode est contraint par le système (ex. toutes les instances Piped down → verrouillé en IFrame)
- [x] **Comportement — bascule des 2 decks d'un coup** :
  - Au clic : re-créer les players A **et B** dans le mode cible, ensemble
  - Préserver les vidéos courantes : recharger le même `videoId` sur chaque deck après la bascule
  - Préserver les positions : `seekTo(currentTime)` après `loadVideoById` sur chaque deck, puis reprendre si la voie était en lecture
  - Recalculer le crossfade (`Mixer.applyVolumes()`) car le routing change globalement (GainNode ↔ `setVolume`)
  - En mode Piped : réinitialiser/masquer les contrôles DJ si retour IFrame ; restaurer les valeurs DJ sauvegardées si passage à Piped
  → Le hook est en place (`body.mode-piped`/`body.mode-iframe` via `applyModeBodyClass`). L'UI DJ elle-même (EQ/pitch/cue) arrive avec les tâches 6+ ; `styles.css` masque déjà `.deck-dj`.
- [x] **Indicateur de mode global (lecture seule dans les decks)** :
  - Le bouton global de l'en-tête de l'application affiche le mode courant : `🔊 Piped` / `📺 IFrame`
  - Aucun bouton, toggle ou badge de mode ne doit être ajouté dans les decks
  - En fonctionnement normal, le mode est identique pour les deux decks
- [x] **Interaction avec le mode global** (`PLAYER_MODE`) :
  - Le bouton bascule `PLAYER_MODE` entre `'piped'` et `'iframe'` (concret), surchargeant `'auto'`
  - Le mode `'auto'` reste accessible uniquement via la modal Paramètres (résolution Piped/IFrame au démarrage)
  - Pas de persistance par voie : `PLAYER_MODE` global est la seule source de vérité. Les clés `DECK_MODE_A/B` sont inutiles et **ne pas ajouter**
- [x] **Fallback automatique par voie (résilience runtime)** — à garder, mais gérer explicitement :
  - Si le flux Piped d'un deck expire sans rafraîchissement possible (instances down / CORS), ne pas laisser durablement les decks dans un mode hybride
  - Afficher une **alerte globale** : « Lecture Piped indisponible. Pour préserver le mixage, basculer les deux decks en IFrame ? [Basculer les deux] »
  - Si l'utilisateur confirme, déclencher la bascule globale vers IFrame et recréer les deux players
  - Si le fallback automatique par voie est techniquement nécessaire avant la confirmation, désactiver temporairement les fonctions DJ avancées et signaler clairement que le mixage est dégradé jusqu'à la remise en cohérence des deux decks
  → `onError` Piped → `showPipedFallbackAlert()` (`#piped-fallback-alert`). Bouton « Basculer les deux » → `switchResolvedMode('iframe')`. Aucun mode hybride laissé en place.
- [x] **Cas particuliers & limites à documenter dans l'UI** :
  - La bascule mid-playback provoque un rechargement des 2 decks → micro-coupure inévitable (re-buffering)
  - Si on bascule IFrame → Piped alors que les instances Piped sont down, la bascule échoue et reste en IFrame : afficher un message clair (pas de bascule silencieuse)
  - En mode Piped : perte de la vidéo YouTube (audio-only). Le bouton sert aussi à retrouver la vidéo en repassant en IFrame
  - Les réglages DJ (EQ, pitch, cue/loop) sont propres au mode Piped ; au retour en IFrame ils sont masqués (pas applicables). Leurs valeurs restent sauvegardées pour le retour éventuel en Piped
  → Message clair via `showGlobalError()` en cas d'échec. Section « Mode de lecture » de la modal Paramètres documente les 3 modes + trade-offs (audio-only vs vidéo).

---

## 5. Crossfader Web Audio — modification de `js/mixer.js` [x]

Le crossfade a été implémenté avec `GainNode` en mode Piped, conservant le comportement existant en mode IFrame.

- [x] **`Mixer.applyVolumes()`** :
  - Si mode Piped actif → `AudioEngine.applyCrossfade(crossfade / 100)` + `AudioEngine.applyMasterVolume(master)`
  - Si mode IFrame → comportement existant (`player.setVolume` avec equal-power)
- [x] **Ramping fluide** : utilisation de `GainNode.gain.setTargetAtTime(value, ctx.currentTime, timeConstant)` pour un crossfade ultra-fluide
- [x] Affichage des volumes A/B inchangé (basé sur la cible `crossfade`, pas sur la valeur appliquée intermédiaire)
- [x] Sync B→A en mode Piped : `audio.currentTime` est précis à la milliseconde → sync plus fiable qu'avec l'IFrame. `syncBtoA()` inchangé dans sa logique (seek B au `currentTime` de A).
- [x] Sync continu en mode Piped : le drift devrait être **beaucoup plus faible** qu'avec l'IFrame (les éléments `<audio>` HTML5 sont synchronisés par l'horloge du navigateur). Le seuil de re-seek peut passer de 0.5s à 0.2s.

---

## 6. EQ 3 bandes + filtre DJ par voie [x]

### 6.1 EQ 3 bandes (Low / Mid / High)

- [x] **UI** : 3 faders verticaux par voie (A et B), placés dans un bloc `.deck-dj` sous la barre de transport. Range -12dB à +12dB, 0dB = neutre. Visibles uniquement en mode Piped (`body.mode-piped .deck-dj`).
- [x] **HTML** (`index.html`) : conteneur `.deck-dj` avec `.dj-eq` (3 `.dj-band[data-band=low|mid|high]`) + `.dj-filter`, chacun un `<input type="range" min="-12" max="12" value="0" step="0.5" orient="vertical">`.
- [x] **CSS** (`styles.css`) : faders verticaux (`writing-mode: vertical-lr; direction: rtl`), teinte A bleue / B rose, labels LOW/MID/HIGH.
- [x] **Câblage** (`app.js` `wireDeckDj`) : `fader.addEventListener('input', () => applyEq(deck, band, v))` → `AudioEngine.setEQ(deck, band, value)`. Double-clic = reset 0.
- [x] `AudioEngine.setEQ(deck, band, gainDb)` : `node.gain.setTargetAtTime(clamped, ctx.currentTime, RAMP_TC)` sur le `BiquadFilterNode` correspondant (lowShelf/peaking/highShelf créés dans `createDeckChain`).
- [x] Persistance : `localStorage` (`EQ_LOW/MID/HIGH_A/B`) + restauration au chargement + ré-application après bascule de mode (`restoreDeckDj` au `onReady`).

### 6.2 Filtre DJ (sweep LowPass ↔ HighPass)

- [x] **UI** : 1 knob vertical par voie (`.dj-knob`), position centrale = off (bypass). Bas = lowpass (cut aigus), haut = highpass (cut graves).
- [x] **Logique** `AudioEngine.setDjFilter(deck, position)` : `position ∈ [-1..+1]`, mapping log-scale (200Hz↔20kHz lowpass, 20Hz↔5kHz highpass), bypass = lowpass 20kHz. Rampé via `setTargetAtTime`.
- [x] **Kill switch** : double-clic sur le knob → reset à 0 (filtre off).
- [x] Persistance : `DJ_FILTER_A/B` en `localStorage` (stocké en -100..+100).

---

## 7. Pitch / Tempo control [x]

Permettre d'ajuster la vitesse de lecture pour le beatmatching.

- [x] **UI** : 1 slider vertical par voie, range -8% à +8%, centré à 0%. Affichage du pitch courant (%).
- [x] **Logique** : `audio.playbackRate = 1 + (pitch / 100)` (ex: pitch = +4% → `playbackRate = 1.04`)
- [x] **Préservation du pitch** : `audio.preservesPitch = true` (ou `audio.mozPreservesPitch = true`, `audio.webkitPreservesPitch = true`) → change la vitesse sans changer la hauteur (pas d'effet "chipmunk"). Requis pour le beatmatch. (posé dès `audio-player.js` createAudioElement)
- [x] Affichage BPM : si le BPM original est détecté (section 9), afficher `bpm * playbackRate` (BPM effectif)
- [x] **Reset** : double-clic → `playbackRate = 1.0` (reset pitch à 0%)
- [x] **Boutons RAZ** : petit bouton circulaire (↺) à côté de chaque slider vertical (EQ, filtre DJ, pitch) pour reset à 0 en un clic (`data-reset` attribute câblé dans `app.js` `wireDeckDj`)
- [x] Persistance : `pitchA`, `pitchB` en `localStorage` + restauration au chargement via `restoreDeckDj` + ré-application après bascule de mode
- [x] ⚠️ Le pitch ne fonctionne qu'en mode Piped (IFrame YouTube n'expose pas `playbackRate`)

---

## 8. Analyse spectrale & visualisation — `js/visualizer.js` [x]

Visualiser le signal audio en temps réel via les `AnalyserNode` du moteur audio.

- [x] **`js/visualizer.js`** : nouveau module de rendering canvas
- [x] **`createVisualizer(canvas, analyser, options)`** : boucle `requestAnimationFrame` qui :
  - Récupère `analyser.getByteFrequencyData(freqData)` → spectre de fréquences
  - Récupère `analyser.getByteTimeDomainData(waveData)` → waveform (forme d'onde)
  - Dessine sur le canvas
- [x] **Mode spectre** (bars) : dessiner des barres verticales colorées (dégradé bleu→rose pour A, inverse pour B). Hauteur proportionnelle à l'amplitude par bande de fréquence.
- [x] **Mode waveform** (ligne) : dessiner la forme d'onde. Utile pour voir les beats (pics = transitoires/basses).
- [x] **Canvas par voie** : un canvas dans chaque `.deck` (remplaçant ou complétant la zone `.deck-player`). Taille responsive.
- [x] **Canvas master** : un petit canvas dans la barre de mixage affichant le spectre global (post-masterGain).
- [x] **Performance** : `requestAnimationFrame` (pas `setInterval`), `fftSize=2048` (bon compromis résolution/perf), limiter le FPS à 30 si besoin.
- [x] Exposer : `window.Visualizer = { createVisualizer, start, stop }`

---

## 9. Détection BPM & beatmatch [x]

Estimer le tempo de chaque morceau en temps réel via l'`AnalyserNode`.

- [x] **`js/bpm-detector.js`** : algorithme de détection de beat en temps réel :
  1. Récupérer `analyser.getByteFrequencyData(freqData)` à intervalle régulier (~40ms)
  2. Isoler la bande bass (bins correspondant à 20-150Hz — kick drum)
  3. Calculer l'énergie de cette bande (somme des amplitudes)
  4. Détecter les pics d'énergie (beat = pic dépassant un seuil adaptatif)
  5. Stocker les timestamps des beats dans une fenêtre glissante (~8s)
  6. Calculer les intervalles inter-beat → médiane = intervalle moyen
  7. `bpm = 60000 / intervalleMoyen` (si intervalle en ms)
  8. Filtrer dans la plage plausible 60-200 BPM
- [x] **Affichage BPM** : un badge/afficheur par voie montrant le BPM détecté (ex: `128 BPM`)
- [x] **Slider de pitch** (section 7) : afficher le BPM effectif = `bpm * playbackRate`
- [x] **Bouton SYNC** (nouveau, distinct du sync de position) : ajuster automatiquement le `playbackRate` de B pour matcher le BPM de A :
  - `ratio = bpmA / bpmB`
  - `audioB.playbackRate = clamp(ratio, 0.92, 1.08)` (limiter à ±8%)
  - Si le ratio sort de la plage → afficher "BPM trop éloigné, sync impossible"
- [x] **Limitations documentées** :
  - La détection est approximative (±2-3 BPM). Les transitions, builds et breaks peuvent fausser la détection.
  - Le beatmatch n'est pas parfait — un écart résiduel de quelques BPM reste possible.
  - Ne pas promettre un sync frame-accurate.
- [x] Exposer : `window.BPMDetector = { start(deck), stop(deck), getBPM(deck), getProvisionalBPM(deck), getEffectiveBPM(deck), getEffectiveBPMIfChanged(deck), getState(deck), syncBtoA(), reset(deck), onBPMUpdate(deck) }` — `getState()` retourne `'idle' | 'detecting' | 'estimating' | 'locked'` (voir 9.2 pour l'état `estimating`).

### 9.2 Affichage précoce d'un BPM provisoire + bouton RAZ persistant

La version précédente attendait le verrouillage complet (3 cycles stables, ~15-30 s) avant d'afficher le moindre chiffre — le `—` persistait trop longtemps, donnant l'impression que le détecteur ne marchait pas.

- [x] **BPM provisoire exposé tôt** : nouvel état `'estimating'` entre `'detecting'` et `'locked'`. Dès qu'on a `MIN_BEATS_PROVISIONAL` (4) beats accumulés (~2-3 s), on calcule un BPM provisoire par **médiane des intervalles inter-beat** (`getProvisionalBPM(deck)`). L'UI l'affiche immédiatement en **orange** au lieu du `—`.
- [x] **Trois états visuels** (`data-bpm-state` sur `.dj-bpm`) :
  - `idle` / `detecting` → **rouge** (`#f87171`) + bordure pulse (`@keyframes bpm-pulse`) — acquisition en cours, pas encore de valeur.
  - `estimating` → **orange** (`#fb923c`) — BPM provisoire affiché, affinage en arrière-plan.
  - `locked` → **vert** (`#4ade80`) + bordure verte — valeur verrouillée, fiable.
- [x] **Affinage en arrière-plan** : l'histogramme continue de tourner pendant l'état `estimating`. Quand il converge (pic dominant ≥55 % stable sur 3 cycles), on passe en `locked` (vert) et la valeur se fige. Le provisoire ne fait que *devancer* l'affichage, pas remplacer le verrouillage.
- [x] **Mise à jour périodique du provisoire** : `getEffectiveBPMIfChanged()` garde la tolérance de 3 % en `locked`, mais le provisoire utilise une tolérance plus large (`UI_CHANGE_TOL_PROVISIONAL = 6 %`) pour accepter l'affinage sans clignotement permanent.
- [x] **Boucle d'affichage plus réactive** : `startBpmDisplayLoop()` (`app.js`) passe de 500 ms (~2 Hz) à 250 ms (~4 Hz) pendant l'estimation, pour que le provisoire se mette à jour visiblement.
- [x] **Bouton RAZ (`↺`) toujours visible** : le bouton de recalcul du BPM n'est plus masqué pendant le calcul. Il reste affiché en permanence sous la valeur, et un clic déclenche `BPMDetector.reset(deck)` + `BPMDetector.start(deck)` — relance proprement l'acquisition des beats et repasse en `idle`/`detecting`.
- [x] **Callback de transition** : `BPMDetector.onBPMUpdate(deck)` est déclenché à chaque changement d'état (`detecting` → `estimating` → `locked`, ou déverrouillage sur changement de tempo), pour que l'UI puisse réagir immédiatement.
- [x] **Reset à changement de morceau** : `onSearchSelect` (`app.js`) appelle toujours `BPMDetector.reset(deck)` — repart de zéro sur la nouvelle piste.

API étendue : `window.BPMDetector` expose désormais `getProvisionalBPM(deck)`, `onBPMUpdate(deck)`, et `getState(deck)` retourne `'idle' | 'detecting' | 'estimating' | 'locked'`.

---

## 10. Cue points & boucles [x]

Fonctionnalités DJ de navigation dans le morceau.

- [x] **Cue point** : bouton "CUE" par voie → sauvegarde le `currentTime` actuel comme point de départ. Re-clic → seek au point sauvegardé. Double-clic → play depuis le cue (comportement console DJ).
- [x] **Bouton PLAY/PAUSE** par voie (en plus du play/pause both) : contrôle individuel — déjà présent dans `.deck-transport` (`js/deck-controls.js`), conservé et fiabilisé (cf. 10.1).
- [x] **Loop A↔B** : 2 marqueurs (loop-in, loop-out) par voie. Quand les deux sont définis, l'audio boucle entre ces positions :
  - une boucle `requestAnimationFrame` (`startLoopWatch` dans `app.js`) surveille `currentTime` à ~60 Hz ; si `currentTime >= loopOut` → `seekTo(loopIn)` (transition quasi sample-accurate, plus fiable que `timeupdate` qui ne fire qu'~4 Hz)
- [x] **Loop de N beats** : boutons "1/2/4/8" → définit un loop de 1/2/4/8 beats à partir de la position actuelle (utilise le BPM détecté de la section 9, avec fallback sur le BPM provisoire). Active immédiatement la boucle.
- [x] Persistance : `cueA`/`cueB`, `loopInA`/`loopOutA`, `loopInB`/`loopOutB` en `localStorage` (clés ajoutées dans `config.js` `STORAGE_KEYS`). Restauration au démarrage via `wireDeckCueLoop`, mais la boucle n'est **pas** réactivée automatiquement au reload (une boucle auto-active serait surprenante).
- [x] ⚠️ Disponible uniquement en mode Piped (l'IFrame ne permet pas le loop précis) — le bloc `.deck-cue-loop` est masqué en IFrame via CSS (`body.mode-iframe`). À la bascule IFrame, toute boucle active est désactivée et la surveillance est arrêtée.

### 10.1 Fiabilisation du bouton PLAY/PAUSE (mode Piped)

Le bouton play/pause par voie existait déjà (`js/deck-controls.js`), mais il se désynchronisait dans plusieurs cas. Corrections apportées :

- [x] **Les événements `canplay`/`canplaythrough`/`loadeddata`/`loadedmetadata` n'émettent plus `CUED` pendant la lecture** (`js/audio-player.js`). Ces événements sont émis par l'`<audio>` CHAQUE FOIS que le buffer se remplit — y compris en plein playback (re-buffering après un seek, remplissage progressif). Si on signalait `CUED` à ce moment, l'icône revenait à `▶` (play) alors que l'audio jouait → l'utilisateur cliquait "play" en pensant que c'était en pause, et le bouton se désynchronisait. Maintenant on ne signale `CUED` que si l'`<audio>` est effectivement en pause (`audio.paused`).
- [x] **Le bouton play affiche `PAUSED` immédiatement au clic, même depuis `BUFFERING`** (`js/deck-controls.js`). Avant, depuis `BUFFERING`, on n'updait pas l'icône en attendant l'événement `pause` réel — or un `<audio>` en attente de buffer peut tarder à émettre `pause` après `pause()`, laissant le spinner bloqué. Maintenant l'optimiste `PAUSED` s'applique dans tous les cas de pause-demandée.
- [x] `reportState()` ne filtre plus les doublons (déjà en place depuis 3.1) : un même état publié deux fois est toujours notifié, pour que `onStateChange` force le rafraîchissement de l'icône après un échec de `play()` optimiste.

### 10.2 Détails d'implémentation

- **HTML** (`index.html`) : nouveau bloc `.deck-cue-loop` par voie (A et B), placé sous `.deck-dj`, contenant : bouton `◆ CUE`, `⤓ IN`, `⤒ OUT`, séparateur, boutons `1`/`2`/`4`/`8` (loop de N beats), `🔁 LOOP` (toggle), `✕` (clear).
- **CSS** (`css/styles.css`) : styles du bloc `.deck-cue-loop` et des boutons `.cl-btn` (états `aria-pressed`, couleurs distinctes pour cue set / loop in-out actifs / loop toggle actif). Masqué par défaut, affiché en `body.mode-piped`.
- **Logique** (`js/app.js`) : `wireDeckCueLoop(deck)` câble tous les boutons ; `startLoopWatch()`/`stopLoopWatch()` gèrent la surveillance des loops (une seule rAF pour les 2 voies). Les marqueurs sont effacés à chaque changement de morceau (`onSearchSelect`) car leurs positions (en secondes) ne sont plus pertinentes dans le nouveau morceau.

---

## 11. Scratch / platine vinyle — `js/scratch.js` [ ]

Permettre de « scratcher » un morceau (lecture avant/arrière à vitesse variable pilotée par un geste) comme sur une platine vinyle DJ. **Feature avancée — mode Piped uniquement.**

### Possibilités techniques

Trois approches, à choisir ou combiner :

**Approche A — Jog / nudge sur `MediaElementSource` (léger, limité)**
- Garder le `<audio>` streaming actuel. Piloter la vitesse via `audio.playbackRate` :
  - `playbackRate > 0` : accélère / ralentit (pitch bend).
  - `playbackRate < 0` (lecture arrière) : **support navigateur inégal** (OK Chrome/Firefox récents, partiel/absent sur Safari et certains mobiles). Ne pas s'y fier.
- Seek-jog : `audio.currentTime += delta` → saccades audibles (re-buffering), pas un vrai scratch.
- **Verdict** : bon pour un nudge / pitch bend temporaire (aligner un beat), pas pour un scratch expressif bidirectionnel.

**Approche B — Scratch réel sur `AudioBufferSourceNode` (lourd, expressif)** ⭐
- Pré-charger tout le morceau : `fetch(streamUrl)` → `arrayBuffer()` → `ctx.decodeAudioData()` → `AudioBuffer` (PCM float32 en mémoire).
- Créer un `AudioBufferSourceNode` branché sur l'entrée de la chaîne EQ de la voie (en lieu et place du `MediaElementSourceNode`).
- `source.playbackRate.value` accepte **n'importe quelle valeur, y compris négative** (vraie lecture arrière, sample-accurate, pitch variable).
- **Verdict** : vrai scratch DJ (avant/arrière, vitesse variable, pas de pitch-preserve). C'est l'approche à privilégier pour l'effet « platine ».

**Approche C — Hybride (recommandée)**
- Mode normal : `MediaElementSource` streaming (économie mémoire/réseau, seek progressif).
- Quand l'utilisateur « saisit » la platine (`pointerdown`) : bascule vers `AudioBufferSourceNode` (Approche B). Décode le buffer paresseusement au premier engage (état « chargement… »).
- Au relâchement (`pointerup`) : rebascule vers `MediaElementSource`, remet `audio.currentTime` à la position finale du scratch, reprend si en lecture.
- Combine l'efficacité du streaming et l'expressivité du vrai scratch.

### Implémentation — `js/scratch.js`

- [ ] **Platine visuelle** : élément circulaire (`.platter`) par voie (~120-160 px), avec un repère angulaire. Rotation visuelle liée à la position/lecture.
- [ ] **Saisie unifiée** : Pointer Events (`pointerdown` / `pointermove` / `pointerup` / `pointercancel`) → marche pour souris, tactile, stylet. Pas de `touch*` séparé.
- [ ] **Suivi angulaire** : convertir le déplacement du pointeur en angle (`Math.atan2`). Dérivée temporelle → vitesse angulaire → `playbackRate`.
- [ ] **Mappage vitesse** : `playbackRate = clamp(angularVelocity * SENS, -MAX_RATE, +MAX_RATE)` (ex: `MAX_RATE = 3`). Lissage (low-pass) pour éviter le jitter.
- [ ] **Inertie / freewheel (optionnel)** : au relâchement, laisser la platine continuer à tourner avec friction avant de revenir au mode normal (rendu plus naturel).
- [ ] **`decodeDeckBuffer(deckId, url)`** dans `audio-engine.js` : `fetch` + `decodeAudioData`, stocke `chains[deck].audioBuffer`. UI affiche un état de chargement.
- [ ] **`engageScratch(deckId)` / `disengageScratch(deckId, positionSec)`** dans `audio-engine.js` : swap du nœud source dans la chaîne (déconnecter `MediaElementSource`, connecter `AudioBufferSourceNode` à l'entrée `lowShelf`). Ducking court (ramp de gain) au point de bascule pour éviter le clic.
- [ ] **`setScratchRate(deckId, rate)` / `seekScratch(deckId, sec)`** : règle `playbackRate` (peut être négatif) / recrée l'`AudioBufferSourceNode` à l'offset voulu (ils sont one-shot).
- [ ] **Synchro position** : après scratch, reporter la position finale dans `audio.currentTime` pour que la lecture normale reprenne au bon endroit.
- [ ] Persistance : pas de persistance scratch en `localStorage` (état transitoire). Option : `scratchEnabled` par voie.
- [ ] Exposer : `window.Scratch = { enable, disable, engage, disengage, setRate, seek, isBufferReady }`
- [ ] Exposer côté `AudioEngine` : `decodeDeckBuffer, engageScratch, disengageScratch, setScratchRate, seekScratch`

### Écueils & contraintes (À LIRE)

- ⚠️ **`AudioBufferSourceNode` est one-shot** : un seul `start()` / `stop()` par instance. Chaque seek ou geste de scratch nécessite de **recréer le nœud** (déconnecter l'ancien, en créer un nouveau, reconnecter). Pas de réutilisation après `stop()`.
- ⚠️ **Mémoire** : un `AudioBuffer` PCM float32 stéréo ≈ 10 Mo/min → **~30 Mo pour 3 min**. Deux voies = ~60 Mo. Sur mobile, risque de pression mémoire / crash d'onglet. Décoder paresseusement (uniquement quand le scratch est engagé), pas au chargement de la voie.
- ⚠️ **Réseau / latence initiale** : `decodeAudioData` nécessite le **fichier complet** téléchargé. Le premier scratch sur un morceau = chargement complet (état « préparation du scratch… »). Pas de streaming progressif possible pour le scratch.
- ⚠️ **Conflit `preservesPitch`** : le beatmatch (section 7) veut `preservesPitch = true` (vitesse change, pitch constant). Le scratch veut l'inverse : **le pitch DOIT changer avec la vitesse** (c'est le son de scratch). `AudioBufferSourceNode.playbackRate` ne préserve jamais le pitch par défaut — c'est exactement ce qu'on veut. À documenter : les deux modes sont **mutuellement exclusifs** sur la même voix à un instant t.
- ⚠️ **Clics / craquements** : changement rapide de `playbackRate` ou inversion de sens = artefacts d'interpolation. Lisser le rate (ramp via `setTargetAtTime`), et idéalement un court fondu au point d'inversion.
- ⚠️ **Swap de source audible** : basculer entre `MediaElementSource` et `AudioBufferSourceNode` en plein playback génère un déclic. Toujours ducking (`gain → 0 → swap → gain → valeur`) sur ~10-30 ms.
- ⚠️ **Lecture arrière sur `<audio>`** : ne pas s'y fier (Approche A). Safari / mobile peuvent ignorer un `playbackRate` négatif (lecture avant à vitesse réduite, ou figée). Le vrai scratch bidirectionnel passe par l'Approche B/C.
- ⚠️ **Précision d'entrée** : Pointer Events à ~60-120 Hz vs audio à 44.1 kHz. La vitesse angulaire doit être interpolée / lissée pour un scratch propre.
- ⚠️ **Deux platines simultanées** : 2 `AudioBufferSourceNode` scratchés en même temps + DSP (EQ / filtre / analyser) = charge CPU. À tester (section 16).
- ⚠️ **Mode IFrame** : scratch **impossible** (pas d'accès au buffer audio — cf. contrainte #1 du `CLAUDE.md`). Masquer la platine, afficher un tooltip « Scratch disponible en mode Piped ».
- ⚠️ **`AudioContext` suspendu** : `ctx.resume()` requis après geste utilisateur (même contrainte autoplay que le reste de l'app).

### UI — modification de `index.html` + `css/styles.css`

Intégration du Scratch dans l'espace d'un deck :
- Le visualiser (`<canvas>`) occupe le tiers gauche : largeur = 1/2 × (largeurDeck - padding) → ~350–400 px si le deck fait ~768×340.
- La platine et ses contrôles (`.platter`, `knob`s pitch/vinyl, marqueurs cue) occupent les 2/3 restants : largeur ≈ reste de l'espace horizontal.
- Le split est un ratio ~35% left | 65% right. Les contrôle scratch sont à droite du canvas pour éviter le clash avec la waveform gauche.

Liste UI détaillée :

### Left Pane (visualizer) — `~320–400 px`:
- Un `<canvas id="waveformCanvas">` sous l'élément `.spectral-overlay`. Styles : 
  - `width: calc((100% * 0.56) + var(--gutter)); height: inherit; background: radial-gradient(circle at center, #2a2e39, #1c1f28);`
  - Ondulation de la waveform via Web Audio AnalyserNode.

### Right Pane (scratch controls) — `~60–75% du deck`:
- `.platter` (disque circulaire ~120 px), marqueurs angulaires, state (`idle/engaged/loading`).
- Boutons/sliders de pitch control (-8..+8%), vinyl slider pour le sweep ±45 BPM.

- [ ] `touch-action: none`, pointer-events natifs (tactile + mouse) sur `.platter` et ses sliders. Responsive, manipulations directes.

### Limites à documenter dans l'UI

- Le scratch expressif nécessite de pré-charger le morceau (mémoire + latence initiale).
- Sur mobile, décoder 2 morceaux complets peut excéder la mémoire → désactiver le scratch sur la 2e voix si la 1re est déjà décodée, ou avertir l'utilisateur.
- Lecture arrière non garantie sur tous les navigateurs via `<audio>` ; le vrai scratch passe par un buffer en mémoire.
- Le scratch et le pitch-beatmatch (`preservesPitch`) sont incompatibles simultanément.

---

## 12. Migration progressive & fallback IFrame [ ]

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

## 13. UI/UX DJ — modification de `index.html` + `css/styles.css` [ ]

Repenser l'interface pour une expérience DJ.

### 13.1 Layout par voie (`.deck`)

Structure cible de la **zone player audio** de chaque voie en mode Piped :

Le schéma ci-dessous décrit uniquement le composant `.deck-visualizer` / player audio qui remplace la zone vidéo YouTube IFrame. Il ne décrit pas le layout complet d'un `.deck` : dans l'interface actuelle, le champ de recherche et les résultats restent au-dessus de la zone player, et le header global de l'application contient le bouton de bascule de mode et le bouton Paramètres. Il ne faut pas ajouter de bouton de mode dans chaque deck.

```
│  ce canvas (remplace la zone vidéo IFrame)
┌─────────────────────────────┐
│ Badge A  Titre    [▶] [🔇]  │  ← header + bouton play/pause individuel ; le badge 
├─────────────────────────────┤
│ ┌─────────────────────────┐ │
│ │     Waveform / Spectre    │
│ │     (AnalyserNode)        │
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
└─────────────────────────────┘
```

- [ ] En mode Piped, remplacer la zone `.deck-player` (IFrame 16:9) par `.deck-visualizer` (canvas waveform/spectre) dans chaque deck
- [ ] Ajouter `.deck-eq` dans cette zone audio : conteneur avec 4 contrôles verticaux (LOW, MID, HIGH, FILTER)
- [ ] Ajouter `.deck-dj-controls` dans cette zone audio : BPM display + pitch slider + cue/loop/play buttons
- [ ] Conserver la zone de recherche au-dessus du player, conformément à l'interface actuelle ; les résultats restent associés à cette zone de recherche et ne font pas partie du player audio
- [ ] En mode IFrame fallback, masquer `.deck-eq` et `.deck-dj-controls`, puis restaurer `.deck-player` à la même position dans le deck
- [x] **Mode affiché dans l'en-tête global** et la bascule globale s'appliquent aux deux decks ; aucun bouton ou toggle de mode ne doit être ajouté dans un deck

### 13.2 Barre de mixage (`.mixer-bar`)

- [x] Crossfader existant conservé (mais branché sur `AudioEngine.applyCrossfade` en mode Piped)
- [x] Mini-canvas master spectrum ajouté dans la barre
- [x] Play both / pause both / sync / master volume fonctionnels

### 13.3 Styling

- [x] Sliders EQ verticaux : `-webkit-appearance: slider-vertical` ou `writing-mode: bt-lr` (vertical), hauteur uniforme ~280px
- [x] Knobs rotatifs remplacés par sliders verticaux pour simplifier
- [x] Thème sombre conservé (`#0f1115`, `#15181f`)
- [x] Couleurs par voie conservées : A = bleu `#3b82f6`, B = rose `#ec4899`
- [x] Canvas waveform : fond noir, ligne A en bleu, ligne B en rose
- [x] Responsive : en mode mobile (< 720px), les contrôles DJ s'empilent

---

## 14. Gestion des erreurs [x]

- [x] **Flux audio expiré** (403/network sur `<audio>`) : re-fetch automatique via `PipedStreams.refreshStream`, reprise à la même position. Si re-fetch échoue (instances down) → afficher erreur dans la voie + proposer fallback IFrame
- [x] **CORS bloqué** (audio tainted, AnalyserNode = silence) : détecter (analyser.getByteFrequencyData = all zeros après 1s de lecture) → afficher "CORS bloqué, passage en mode IFrame" → basculer la voie en IFrame
- [x] **Piped instances toutes down** au démarrage → fallback IFrame global + message d'info
- [x] **AudioContext bloqué** (autoplay policy) → afficher "Cliquez sur Play pour activer l'audio" (le premier geste débloque le contexte)
- [x] **Vidéo supprimée/privée** (Piped 500 avec message) → afficher le message dans la voie
- [x] **Quota / rate limit Piped** : les instances Piped n'ont pas de quota officiel mais peuvent être rate-limitées. Gérer le 429 comme dans `search.js` (warning non bloquant)
- [x] **Mode IFrame fallback** : si le mode Piped échoue, l'app doit continuer à fonctionner en mode IFrame (volume-only). La transition est invisible pour l'utilisateur (sauf le badge de mode)

---

## 15. Sliders de Gain par Deck — UI améliorée [x]

### Objectif

Ajouter un slider de contrôle de gain (volume) pour chaque deck A et B, positionné à gauche des contrôles EQ (LOW, MID, HIGH), avec une mise en page alignée verticalement et régulièrement espacée.

**Status** : Terminé ([x])
- HTML implémenté dans `index.html` (sections 15.1/15.2)
- Styles CSS ajoutés dans `css/styles.css`
- Logique JS dans `js/app.js` (wireDeckDj) + `js/audio-engine.js` (setDeckTrim)

### 15.1 Structure HTML — `index.html`

Dans le div `.deck-dj` (ligne 178 de index.html), ajouter l'élément de gain avant les contrôles EQ :

```html
<div class="deck-dj" data-deck="A" hidden>
  <!-- ... visualizer canvas ... -->
  
  <!-- Zone DJ avec gain + EQ alignés verticalement -->
  <div class="deck-controls-container">
    
    <!-- Gain control (nouveau, à gauche) -->
    <div class="deck-gain-control">
      <input type="range" 
             class="gain-slider-vertical" 
             id="gain-A" 
             min="0" max="12" 
             step="0.1" 
             value="3"
             data-deck="A" />
      <div class="gain-label">+0.0 dB</div>
    </div>
    
    <!-- EQ controls (LOW, MID, HIGH) -->
    <div class="deck-eq">
      <input type="range" class="eq-slider-vertical" min="-12" max="12" step="0.5" value="0" data-deck="A" data-band="low" />
      <input type="range" class="eq-slider-vertical" min="-12" max="12" step="0.5" value="0" data-deck="A" data-band="mid" />
      <input type="range" class="eq-slider-vertical" min="-12" max="12" step="0.5" value="0" data-deck="A" data-band="high" />
    </div>
    
  </div>
  
  <!-- ... autres contrôles (BPM, PITCH, LOOP) ... -->
</div>
```

**Implémentation :**

- [ ] Dupliquer la section `<div class="deck-dj" data-deck="A">` existante
- [ ] À l'intérieur, insérer un nouveau `div.deck-controls-container`
- [ ] Ajouter un `div.deck-gain-control` avec slider vertical + label dB
- [ ] Placer avant `.deck-eq` pour alignement horizontal correct
- [ ] Répéter la structure pour le deck B (via JS dynamique ou duplication)

### 15.2 Styling — `css/styles.css`

Règles pour l'alignement vertical et espacement :

```css
/* Conteneur principal des contrôles */
.deck-controls-container {
  display: flex;
  align-items: center;              /* Alignement vertical au centre */
  gap: 16px;                        /* Espace entre gain et EQ */
  height: 320px;                    /* Hauteur ajustée pour contenir tous les éléments */
}

/* Gain control (nouveau) */
.deck-gain-control {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  min-width: 40px;
}

/* Label dB - dynamique */
.gain-label {
  font-size: 12px;
  color: #3b82f6; /* Couleur deck A */
  font-weight: 500;
}

/* Sliders verticaux alignés */
.gain-slider-vertical,
.eq-slider-vertical {
  -webkit-appearance: slider-vertical;
  width: 16px;
  height: 280px;                    /* Hauteur uniforme */
  background: #1f232e;              /* Couleur neutre */
}

/* Customization pour Firefox */
.gain-slider-vertical::-moz-range-thumb,
.eq-slider-vertical::-moz-range-thumb {
  appearance: none;
  height: 28px;
  width: 16px;
  background: #3b82f6;
  border-radius: 4px;
}

/* Sliders EQ existants - ajustés */
.deck-eq {
  display: flex;
  gap: 12px;
  height: 280px;                    /* Même hauteur que les sliders */
}

/* Espacement régulier entre LOW/MID/HIGH */
.deck-eq > input {
  margin-top: auto;                /* Pusher le slider vers le bas pour alignement */
}
```

### 15.3 JavaScript — `js/app.js` + `js/audio-engine.js` [x]

**Contrôles de gain :**

- [x] Écouter les événements `input` sur le fader `.dj-gain-fader` pour chaque deck (dans `wireDeckDj`)
- [x] Plage pilotée par `config.GAIN_RANGE_DB` (±10 dB), pas de conversion arbitraire (le slider est en dB direct)
- [x] Mettre à jour le label avec `+X.X dB` (`applyGain`)
- [x] Appliquer le gain via `AudioEngine.setDeckTrim(deck, gainDb)` → `deckTrim.gain.value = Math.pow(10, db/20)` avec ramping `RAMP_TC`
- [x] Sauvegarder l'état dans `localStorage` (`gainA`, `gainB`)
- [x] Restaurer les gains au chargement + à chaque `onReady`/bascule de mode (`restoreDeckDj`)
- [x] Reset par double-clic **et** bouton RAZ "↺" (`data-reset="gain"`)

**Alignement vertical :**

- [x] Utiliser `flexbox` avec `gap` uniforme (même layout que les faders DJ existants, hauteur 110px)
- [x] Slider vertical via `writing-mode: vertical-lr` + `direction: rtl` (même technique que `.dj-fader`)
- [x] Curseur visuellement distinct (teinte verte) pour distinguer le trim du gain des faders EQ (bleu/rose par voie)

### 15.4 UX et rétroaction

- [x] Slider gain : plage ±10 dB (pilotée par `config.GAIN_RANGE_DB`, valeur neutre centrée)
- [x] Label dynamique "+X.X dB" mis à jour en temps réel
- [x] Valeur par défaut : +0.0 dB (position centrale du slider)
- [x] Rôle principal du gain : compenser le volume entre les deux decks avant le crossfader
- [x] Le gain ne doit PAS interférer avec le crossfader — ordre graphe : trim → EQ → Filter → Crossfader (`deckTrim` avant `deckGain`)
- [x] Documentation dans l'UI : libellé "GAIN" sous le fader
- [x] Bouton RAZ "↺" en dessous du fader (comme tous les autres sliders DJ) + double-clic = reset à 0 dB
- [x] Harmonisation UI : valeur affichée sous CHAQUE slider (GAIN, LOW, MID, HIGH, FILTER, PITCH) au-dessus du bouton ↺ — les bandes EQ + le filtre DJ ont reçu un `<span class="dj-band-value">` mis à jour en temps réel (`applyEq`/`applyDjFilter`)

### 15.5 Validation UI

**Layout cible après implémentation :**

```
┌───────────────────────────────────────────────────────────────┐
│  ┌─────────────────────────────────────────────────────────┐  │
│  │     Waveform / Spectre                                  │  │
│  └─────────────────────────────────────────────────────────┘  │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  GAIN  LOW   MID   HIGH   FILTER   PITCH       BPM PANEL     │
│  │     │      │      │       │      │           [83 BPM]    │
│  │     │      │      │       │      │            🔁          │
│  ├─────┼──────┼──────┼───────┼──────┼───────────────────────┤
│  +0dB  0dB    0dB    0dB     ±X    0.0%                    │
│                                                      │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  [CUE] [⤓ IN] [⤒ OUT]  |  [1] [2] [4] [8] [🔁 LOOP] [✕]     │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

**Spécifications :**

- **Hauteur de zone DJ après visualizer** : ~320px total
  - Partie supérieure (sliders) : ~240px
  - Partie inférieure (boutons cues/loop) : ~80px
- **Sliders verticaux alignés** : GAIN, LOW, MID, HIGH, FILTER, PITCH tous de hauteur uniforme (~160px)
- **Espacement horizontal** :
  - Entre GAIN et LOW : gap: 20px
  - Entre LOW/MID/HIGH : gap: 15px  
  - Entre HIGH/FILTER/PITCH : gap: 8px (zone étroite)
  - Entre PITCH et BPM PANEL : bord vertical séparateur
- **BPM display** : panneau rectangulaire à droite (~60px large) avec affichage BPM en grand + bouton refresh
- **Labels alignés à la base** pour lisibilité claire
- **Cues/loop buttons** : rangés horizontalement, séparé par une barre verticale entre IN/OUT et les boutons 1/2/4/8

### 15.6 Notes d'implémentation [x]

- Le gain est indépendant du crossfader : `deckTrim` est inséré **avant** `deckGain` dans le graphe (source → EQ → filtre → **trim** → crossfade → master)
- Plage retenue : ±10 dB (configurable via `config.GAIN_RANGE_DB`), neutre à 0 dB
- Clamp de sécurité à ±12 dB dans l'AudioEngine pour éviter la distorsion (> ±10 dB)
- Le slider de gain est positionné à gauche des EQ (comme un VU meter traditionnel), séparé par une bordure verticale
- Le visualiseur de voie tape AVANT le trim → il reste actif même si le gain est baissé (cohérent avec le crossfade)

---

## 16. Configuration — modification de `js/config.js` [x]

- [x] `STORAGE_KEYS` :
  - `PLAYER_MODE: 'playerMode'` — auto / piped / iframe
  - `EQ_LOW_A / EQ_MID_A / EQ_HIGH_A` (idem B) — positions d'EQ par voie
  - `DJ_FILTER_A / DJ_FILTER_B` — position du filtre DJ
  - `PITCH_A / PITCH_B` — réglage pitch par voie
  - `CUE_A / CUE_B` — positions de cue
  - `LOOP_IN_A / LOOP_OUT_A` (idem B) — marqueurs de loop
  - `GAIN_A / GAIN_B` — volume gain par voie (+X.X dB)
- [x] Constantes :
  - `GAIN_RANGE_DB: 10` — plage gain (±10 dB)
  - `GAIN_DEFAULT_DB: 0` — gain par défaut (+0.0 dB)
- [x] `PIPED_INSTANCES` et `PIPED_INSTANCE_TIMEOUT_MS` : déplacés de `search.js` vers `config.js` (partagés entre `search.js` et `piped-streams.js`)
- [x] Constantes audio :
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

## 16. Tests & validation [x]

### 16.1 Tests CORS & flux

- [x] Tester `/streams/{videoId}` sur les 5 instances Piped → documenter lesquelles répondent
- [x] Tester le flux audio en `<audio crossOrigin="anonymous">` → vérifier CORS
- [x] Tester `MediaElementAudioSourceNode` → vérifier que l'`AnalyserNode` reçoit des données non-nulles
- [x] Tester l'expiration d'URL → après quelques heures, re-fetch fonctionne

### 16.2 Tests audio

- [x] Crossfader A↔B en mode Piped → le son passe progressivement de A à B (audible, pas juste volume)
- [x] EQ Low/Mid/High fonctionnent ±12dB sans artefacts audibles
- [x] Filtre DJ lowpass ↔ highpass smooth
- [x] Master volume contrôle global bien lié aux gains nodes
- [x] Mute/unmute par voie fonctionne instantanément

### 16.3 Tests DJ

- [x] Pitch +4% → tempo augmenté, pitch préservé (pas chipmunk)
- [x] Détection BPM → affiche un BPM plausible (±2-3 BPM tolérance)
- [x] Sync BPM → re-sync fonctionne avec micro-gaps acceptables (<0.5s)
- [x] Cue point → sauvegarde + seek au point fonctionnel
- [x] Loop → boucle entre loop-in et loop-out stable
- [x] Scratch simulation fonctionnelle (platine vinyle)

### 16.4 Tests fallback

- [x] Couper instances Piped → bascule IFrame automatique transparent
- [x] Revenir mode Piped → contrôles réapparaissent

---

### 16.5 Notes de bugs connus & limitations

**⚠️ Scratch exit position (CORRIGÉ ✓)**

- **Problème originel** : À la sortie du scratch (quand on relâche le bouton et que l'audio reprend), l'audio était remis au point de démarrage du scratch (`currentTime = 0`) au lieu de rester à la position où avait été fait le lâcher.
- **Correction** : Le mécanisme `sourceMuteGain` (gain=0 pendant le drain du buffer stale ~800 ms post-disengage, puis seek + remontée du gain) a été implémenté dans `audio-engine.js`. La position finale est maintenant préservée.
- **Status** : [x] Résolu

**Logs scratch debug réduits**

- Les `console.log` de la boucle de rotation streaming (`[platter:...] rotation streaming:`) et les logs intermédiaires du buffer scratch ont été passés en `console.debug` pour éviter le bruit dans la console. Seuls les jalons importants d'engage/release restent en `console.log` (8 lignes au total).

---

### 16.6 UI Gain sliders

- [x] Sliders de gain ajoutés à gauche des EQ LOW/MID/HIGH
- [x] Alignement vertical uniforme (110px hauteur, même format que les faders existants)
- [x] Espacement horizontal régulier (séparateur gain→EQ, gap uniforme)
- [x] Labels dB mis à jour en temps réel (+X.X dB)
- [x] Bouton RAZ "↺" sous chaque fader de gain (data-reset="gain") + double-clic = reset à 0 dB
- [x] Plage ±10 dB fonctionnelle (pilotée par `config.GAIN_RANGE_DB`)
- [x] Persistance dans localStorage (gainA/gainB)
- [x] Test complet UX : vérifier que le gain ne crée pas de distorsion aux extrêmes
- [x] Graphe audio ajouté : `deckTrim` (GainNode) inséré entre `djFilter` et `deckGain`,
      indépendant du crossfader. API `AudioEngine.setDeckTrim(deck, gainDb)` (clamp ±12 dB
      par sécurité, ramping RAMP_TC). Reset possible par double-clic ou bouton ↺.
- [x] Harmonisation UI : valeur affichée sous CHAQUE contrôle de la zone DJ (GAIN, LOW, MID,
      HIGH, FILTER, PITCH) au-dessus du bouton ↺. Ajout de `<span class="dj-band-value">` sur
      les bandes EQ + filtre DJ, mis à jour en temps réel (`applyEq` → "+X.X dB",
      `applyDjFilter` → "LP x% / HP x% / OFF"). Testé et validé.

### 17. UI Recherche — Repli/Déploiement des résultats [x]

**Ajout d'un bouton ▲/▼ dans la barre de pagination des résultats**

- [x] Bouton `deck-results-toggle` créé dynamiquement dans `ensureToolbar()` (à droite des boutons ‹ ›) avec `margin-left: auto`
- [x] `▲` quand les résultats sont visibles (ferme), `▼` quand repliés (ouvre)
- [x] Repli via classe `.is-collapsed` sur `.deck-results` → `display: none` — **le contenu n'est pas vidé** (grille + pagination conservées)
- [x] Attributs accessibles à jour : `aria-expanded`, `aria-label`, `title`
- [x] L'état n'est pas persisté (simple confort UI, pas de state localStorage)
- Complément : le bouton `✕` (`deck-results-clear`) reste disponible dans la barre de recherche pour effacer requête + résultats

### 17.5 Tests performance

- [ ] 2 flux audio simultanés + 2 canvas waveform à 60fps → vérifier le CPU/latence
- [ ] Si saccades → réduire `fftSize` à 1024, limiter le FPS à 30, ou dessiner le waveform à une fréquence inférieure au spectre

---

## 18. Documentation [x]

- [x] Mettre à jour `CLAUDE.md` :
  - Ajouter une section "Mode Piped / Web Audio API" décrivant la nouvelle architecture
  - **Mettre à jour la contrainte #1** : préciser que l'impossibilité DSP s'applique à l'IFrame YouTube, MAIS que l'approche Piped + Web Audio API contourne cette limite en utilisant les flux audio directs proxifiés
  - Documenter les nouveaux fichiers (`piped-streams.js`, `audio-engine.js`, `audio-player.js`, `visualizer.js`, `bpm-detector.js`)
  - Documenter le dual mode (Piped / IFrame fallback)
- [x] Mettre à jour `README.md` et `README.fr.md` :
  - Nouvelles fonctionnalités : EQ 3 bandes, filtre DJ, pitch/tempo, BPM, waveform, cue/loop, **gain trim par voie**, **repli résultats ▲/▼**, **scratch/platine**
  - Nouvelle architecture audio (schéma du graphe Web Audio) — graphe mis à jour avec `deckTrim`
  - Prérequis : instances Piped (pour les flux audio), pas de clé API YouTube nécessaire
  - Limitations : CORS (dépend des instances Piped), expiration des URLs, audio-only (pas de vidéo), fiabilité des instances
- [ ] Documenter dans l'UI :
  - Le mode actif par voie (badge Piped / IFrame)
  - Les limites du BPM (approximatif, ±2-3 BPM)
  - La dépendance aux instances Piped (peuvent être lentes/indisponibles)
  - L'audio-only en mode Piped (pas de vidéo)
- [ ] Mettre à jour `tasks-list.md` : marquer les nouvelles tâches comme liées à cette migration

---

## 19. Plan d'implémentation (ordre suggéré)

| Phase | Section | Description | Risque | Statut |
|-------|---------|-------------|--------|--------|
| 1 | 0 | Recherche & validation CORS | 🔴 Critique — tout dépend de ça | ✅ |
| 2 | 1 | Client Piped Streams | 🟡 Modéré | ✅ |
| 3 | 2 | Moteur audio Web Audio | 🟡 Modéré | ✅ |
| 4 | 3 | Lecteur audio Piped | 🟡 Modéré | ✅ |
| 5 | 5 | Crossfader Web Audio | 🟢 Faible (modif mixer.js) | ✅ |
| 6 | 4 | Abstraction dual mode | 🟢 Faible | ✅ |
| 7 | 6 | EQ + filtre DJ | 🟡 UI + DSP | ✅ |
| 8 | 8 | Visualisation (spectre/waveform) | 🟢 Faible | ✅ |
| 9 | 9 | BPM & beatmatch | 🔴 Complexe (algo) | ✅ |
| 10 | 7 | Pitch / tempo | 🟢 Faible | ✅ |
| 11 | 10 | Cue & loop | 🟢 Faible | ✅ |
| 12 | 11 | Scratch / platine vinyle | 🔴 Complexe (buffer + mémoire + UI) | ✅ |
| 13 | 12 | Migration progressive & fallback | 🟡 Intégration | ✅ |
| 14 | 13 | UI/UX DJ | 🟡 CSS + HTML | ✅ |
| 15 | 14 | Gestion erreurs | 🟡 Robustesse | ✅ |
| 16 | 15 | Gain sliders + UI | 🟢 Faible (HTML/CSS) | ✅ |
| 17 | 16 | Config | 🟢 Faible | ✅ |
| 18 | 17 | Tests | 🟡 Validation | ~ |
| 19 | 18 | Documentation | 🟢 Faible | ✅ |
| 20 | 17 | Repli/déploiement résultats recherche | 🟢 Faible (JS) | ✅ |

---

## Notes

- **Phase 0 = tout ou rien** : si CORS est bloqué même via le proxy Piped, l'approche Web Audio API est impossible en web pur. Dans ce cas, les options sont : (a) garder l'IFrame (volume-only), (b) utiliser un mini-serveur local qui proxy les flux (ajoute une dépendance serveur), ou (c) faire l'app en React Native avec un module audio natif (voir `mobile-app-tasks-list.md`).
- **Audio-only en mode Piped** : on perd la vidéo YouTube. C'est un trade-off accepté pour un mixeur DJ. L'IFrame reste disponible en fallback si la vidéo est souhaitée.
- **`MediaElementAudioSourceNode` = point de non-retour** : une fois qu'un élément `<audio>` est connecté à un `MediaElementAudioSourceNode`, son audio ne sort plus directement vers les haut-parleurs — il DOIT passer par le graphe Web Audio jusqu'à `ctx.destination`. Pas de mode hybride (audio direct + DSP en parallèle) sur le même élément.
- **Persistance des instances Piped** : `search.js` utilise déjà `PIPED_INSTANCES` en cascade. Le nouveau `piped-streams.js` réutilisera la même liste. Les deux modules peuvent partager une instance préférée (celle qui a répondu à la dernière recherche) pour optimiser la résolution du flux.
- **`preservesPitch`** : supporté par Chrome, Firefox, Safari modernes. Préfixes : `mozPreservesPitch`, `webkitPreservesPitch`. Feature detection nécessaire.
- **Double flux audio = double bande passante** : 2 flux audio Piped simultanés. Sur mobile, peut être lourd. Le warning de "lourdeur double lecture" du `CLAUDE.md` reste valable.
- **Les instances Piped publiques ne sont pas fiables** : pour une app de production, il faudrait self-host un backend Piped (Docker). Les instances publiques peuvent tomber, être lentes, ou rate-limiter. L'app gère le fallback mais l'expérience sera meilleure avec une instance dédiée.

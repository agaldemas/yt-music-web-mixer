# 📋 YT Music Web Mixer — Tâches

État du projet au 2026-08-29 19:51. Référence : `CLAUDE.md` (cahier des charges).

## Légende

- [x] Terminé · [~] Partiellement / en cours · [ ] À faire

> **État Git** : Merge de la branch ScioNos/refactor/secure-audio-pipeline sur main.  
Committed `1d79f97` (merge). Working tree propre.

---

## 0. 🎉 PR #1 — Merge ✅

**Titre du PR** : "Refactor: Secure audio extraction pipeline, robust deck lifecycle, and test coverage"  
**Auteur** : @ScioNos  
**URL** : https://github.com/agaldemas/yt-music-web-mixer/pull/1  

### 📦 Ce que le merge apporte

#### 1. Server Security & Extraction Pipeline Hardening (`feat(server)`)

- ✅ **Bind de la serving de extraction sur loopback (`127.0.0.1`)** avec validation des headers `Host` locaux (évite l'exposition à l'extérieur).
- ✅ **Web asset allowlist** : remplacement du repository-wide static directory serving par une liste explicite des assets autorisés.
- ✅ **Protections API endpoints sensibles** : token de session en mémoire pour protéger les routes `/api/health`, `/api/streams/*`, `/api/audio/*`.
- ✅ **Split `/api/health`** : flags séparés `liveness` (`ok`) et `audio_ready` (détection indépendante de `yt-dlp` et `ffmpeg`).
- ✅ **Concurrency controls** : bounds sur la queue d'extraction, capacité de disque du cache, nombre max d'enregistrements.
- ✅ **Cleanup automatique** : suppression des fichiers temporaires stalés + limitation du cache disque.
- ✅ **Browser-cookie access disabled** par défaut pour des raisons de sécurité.

**Impact** : serveur beaucoup plus sécurisé et robuste contre les attaques et abuse.

#### 2. Deck Audio Lifecycle & Safety (`fix(audio)`)

- ✅ **AbortController guards** : annulation des fetch/decode requests obsolètes lors du fast-switching entre tracks (évitement de leaks mémoire/CPU).
- ✅ **Unified loading logic** : logique unifiée pour YouTube, cue points et fichiers audio locaux → moins de code dupliqué.
- ✅ **Séparation state backend ↔ source state** : meilleure encapsulation entre l'état du lecteur Web Audio et la source d'origine (YouTube/IFrame).
- ✅ **Local file imports** : support direct des lectures de fichiers audio locaux depuis le mode IFrame.
- ✅ **Dedicated Web Audio mute gain** : GainNode séparé pour le muting de chaque voie, indépendant du crossfader → contrôle précis du son/mute.
- ✅ **ID3v2.3 et ID3v2.4 parsing** : lecture complète des tags ID3 y compris l'artwork APIC (pochette) avec support des MIME types.
- ✅ **Cleanup YouTube players** : destruction propre des instances YouTube inutilisées + déduplication de l'injection IFrame API.

**Impact** : meilleure fiabilité, moins memory leak, handling robuste des switch rapides tracks, artwork correctement stocké dans les tags MP3/ID3.

#### 3. Documentation, Accessibility & Test Coverage (`chore`)

- ✅ **README.md (en)** mis à jour avec :
  - Architecure loopback security explained
  - Readiness checks détaillés
  - Resource limits documentés
  - ASCII diagrams d'architecture
- ✅ **Diagrammes SVG ajoutés dans `docs/`** :
  - `fonctionnement-programme.svg` (diagramme de fonctionnement)
  - `program-operation-en.svg` (version anglaise)
- ✅ **Diagnostics d'accessibilité** : labels A11y corrigés, contrastes vérifiés, navigation clavier améliorée sur les cards de résultats.
- ✅ **Tests déterministes ajoutés dans `tests/`** :
  - `check-syntax.js` : parsing syntaxique du JS
  - `test_id3.js` : tests unitaires du parser ID3v2.x
  - `test_server.js` : tests de readiness check et health endpoints
  - `test_task_queue.js` : tests de la file d'exécution
- ✅ **Cleanup unused dependencies** : suppression des packages non utilisés dans `package.json`.

**Impact** : code plus maintenable, mieux testé, conforme aux standards A11y.

#### 4. Nouveaux fichiers ajoutés par le merge (non committés avant)

Les fichiers suivants ont été créés/intégrés via le merge :

- `js/id3.js` : parser ID3v2.x complet avec support APIC
- `js/local-api.js` : binding API locale pour les fichiers audio
- `server/cache-manager.js` : gestionnaire centralisé du cache disque
- `server/task-queue.js` : file d'exécution asynchrone pour yt-dlp
- `tests/test_id3.js` : tests unitaires du parser ID3
- `tests/check-syntax.js` : linter syntaxique
- `docs/fonctionnement-programme.svg` : diagramème SVG
- `docs/program-operation-en.svg` : version anglaise

#### 5. Fichiers modifiés (extraits)

Les modules principaux touchés par le merge :

| Fichier | Changelog succinct |
|---------|-------------------|
| `.gitignore` | Ignore de nouveaux tests et scratch files |
| `js/audio-player.js` | ~400 lignes modifiées : lifecycle managé, cancellation, ID3 support |
| `js/config.js` | Ajout options cache concurrency bounds |
| `js/deck-controls.js` | Contrôles deck améliorés (mute gain séparé) |
| `js/youtube.js` | Déduplication IFrame API script injection |
| `server/server.js` | Binding loopback, allowlist, token auth, queue/task-manager |
| `tests/run-all.js` | Exécution orchestrée des tests unitaires + réseau en sélectif |
| `index.html` | Ajout modal de configuration session token (démo) |

---

## 9. Squelette HTML/CSS ✅

- [x] Structure `index.html` : header, zone A \u2022 B, barre de mixage fixe en bas
- [x] Grille 2 colonnes responsive (`css/styles.css`)
- [x] Voie A (gauche) et voie B (droite) : lecteur, recherche, résultats, badge, mute, erreur
- [x] Barre de mixage : crossfader, play/pause both, sync B\u2192A, sync continu, master volume
- [x] Thème sombre, responsive (1 colonne < 720px)
- [x] Thumb crossfade : rectangle 15\u00d730px avec curseur `ew-resize` (s\xe9par\xe9 du master slider)
- [x] Thumb master : rond 18px classique
- [x] Bug `#api-error-banner` dupliqu\xe9 corrig\xe9 (une seule occurrence dans `index.html` et `styles.css`)

## 10. Projet & documentation ✅

- [x] `.gitignore` adapt\xe9 (OS, \xe9diteurs, `.claude/settings.local.json`, `node_modules/`, `.env`, etc.)
- [x] `git init` + commits sur `main`
- [x] `README.md` (anglais) \u2014 pr\xe9sentation, d\xe9marrage, architecture, limites
- [x] `README.fr.md` (fran\u00e7ais) \u2014 version traduite
- [x] Scripts de lancement `start.sh` (macOS/Linux/WSL) et `start.bat` (Windows) : d\xe9marreraient un serveur statique sur `localhost:8080` et ouvrent l'app dans le navigateur par d\xe9faut

## 11. Chargement IFrame API + 2 lecteurs ✅

- [x] `js/youtube.js` : chargement asynchrone de l'API IFrame (`loadApi` + `onYouTubeIframeAPIReady`)
- [x] `createPlayer(elementId, { videoId, onReady, onStateChange, onError })` \u2014 wrapper simplifi\xe9 (objet literal direct, plus de `wrapPlayer()` factory)
- [x] `mute: 1` dans `playerVars` au d\xe9marrage \u2192 autorise l'autoplay malgr\xe9 la politique du navigateur
- [x] `origin` ajout\xe9e uniquement en `http(s):` (pas en `file://` \u2192 \xe9vite l'erreur 153)
- [x] Timeout 10s avec fallback : v\xe9rifie `YT.Player` apr\xe8s timeout (certains bloqueurs interceptent le callback)

---

## 7. Crossfade progressif par paliers ✅

(Les sections 4\u20136 du contenu original restent inchang\xe9s, mais mis \u00e0 jour avec les nouvelles balises de section n\u00b011+)

---

## Notes

- **Merge PR #1 termin\xe9** : commit `1d79f97` int\xe9gre toutes les am\xe9liorations ScioNos.
- **Tests \u00e0 lancer apr\xe8s merge** : `npm test` ou `node tests/run-all.js`.
- **Serveur de d\xe9veloppement** : `npm start` (ou `start.sh` / `start.bat`) lance le backend local avec les nouvelles r\xe9glementations de s\xe9curit\xe9.
- **Documentation** : lire les nouveaux diagrams dans `docs/` et les mises \u00e0 jour READMEs.

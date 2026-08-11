# 📋 YT Music Web Mixer — Tâches

État du projet au 2026-08-11. Référence : `CLAUDE.md` (cahier des charges).

## Légende

- [x] Terminé · [~] Partiellement / en cours · [ ] À faire

> **État Git** : 8 commits sur `main` (`4cdceea` scaffold → `65a70e8` READMEs → `83f42bf` tasks-list → `b9050fc`/`701f537` .gitignore → `90d04b3` implement players, search, mixer, settings → `e6b541e` tasks-list → `5894e33` show A/B volume values in crossfade). Working tree propre.

---

## 1. Squelette HTML/CSS ✅

- [x] Structure `index.html` : header, zone A | B, barre de mixage fixe en bas
- [x] Grille 2 colonnes responsive (`css/styles.css`)
- [x] Voie A (gauche) et voie B (droite) : lecteur, recherche, résultats, badge, mute, erreur
- [x] Barre de mixage : crossfader, play/pause both, sync B→A, sync continu, master volume
- [x] Thème sombre, responsive (1 colonne < 720px)
- [x] Thumb crossfade : rectangle 15×30px avec curseur `ew-resize` (séparé du master slider)
- [x] Thumb master : rond 18px classique
- [x] Bug `#api-error-banner` dupliqué corrigé (une seule occurrence dans `index.html` et `styles.css`)

## 2. Projet & documentation ✅

- [x] `.gitignore` adapté (OS, éditeurs, `.claude/settings.local.json`, `node_modules/`, `.env`, etc.)
- [x] `git init` + commits sur `main`
- [x] `README.md` (anglais) — présentation, démarrage, architecture, limites
- [x] `README.fr.md` (français) — version traduite
- [x] Scripts de lancement `start.sh` (macOS/Linux/WSL) et `start.bat` (Windows) : démarrent un serveur statique sur `localhost:8000` et ouvrent l'app dans le navigateur par défaut

---

## 3. Chargement IFrame API + 2 lecteurs ✅

- [x] `js/youtube.js` : chargement asynchrone de l'API IFrame (`loadApi` + `onYouTubeIframeAPIReady`)
- [x] `createPlayer(elementId, { videoId, onReady, onStateChange, onError })` — wrapper simplifié (objet literal direct, plus de `wrapPlayer()` factory)
- [x] `mute: 1` dans `playerVars` au démarrage → autorise l'autoplay malgré la politique du navigateur
- [x] `origin` ajoutée uniquement en `http(s):` (pas en `file://` → évite l'erreur 153)
- [x] Timeout 10s avec fallback : vérifie `YT.Player` après timeout (certains bloqueurs interceptent le callback)
- [x] File de chargement (`_queue`) : créations mises en cache avant `onYouTubeIframeAPIReady`
- [x] 2 lecteurs (A, B) créés dans `app.js`, démarrant en `muted` (vidéos de test en dur dans `config.js`)
- [x] Gestion `onError` (codes 2/5/100/101/150) → message localisé dans la voie concernée
- [x] Méthodes wrapper : `loadVideoById`, `cueVideoById`, `playVideo`, `pauseVideo`, `seekTo`, `setVolume`, `mute`, `unMute`, `getCurrentTime`, `getDuration`, `getPlayerState`
- [x] Constantes d'état : `YTWrapper.STATE` (UNSTARTED/ENDED/PLAYING/PAUSED/BUFFERING/CUED)
- [x] Boutons mute/unmute par voie avec helper `setDeckMuted()` : bouton toujours synchronisé avec l'état réel
- [x] Son activé systématiquement au changement de vidéo (`setDeckMuted(deck, false)` dans `onSearchSelect`)

---

## 4. Crossfader ✅

- [x] `js/mixer.js` : implémentation complète (equal-power + contrôles de transport)
- [x] Calcul equal-power : `vA = cos(p·π/2)·100·master`, `vB = sin(p·π/2)·100·master`
- [x] Application temps réel via `player.setVolume()` sur `input` du slider
- [x] Slider `#crossfade` lié aux volumes (0 = full A, 100 = full B, 50 = centre equal-power)
- [x] Affichage volumes A/B séparés (`#xf-value-a` = `100-crossfade`, `#xf-value-b` = `crossfade`) + master (`#master-value`) mis à jour sur `input`
- [x] Slider accessible au clavier (`<input type="range">` natif, flèches gauche/droite)
- [x] Thumb rectangle 15×30px avec `cursor: ew-resize` (stylé comme un curseur de console de mixage)

---

## 5. Recherche ✅

- [x] `js/search.js` : implémentation complète
- [x] Recherche YouTube Data API (`videoCategoryId=10` = Musique, `maxResults=10`)
- [x] Durées récupérées via `/videos?part=contentDetails` (best-effort, échec toléré)
- [x] Affichage résultats : vignette + titre + durée formatée (`PT3M45S` → `3:45`)
- [x] États UI du panneau : `idle`, `loading`, `results`, `error`, `no-results`
- [x] Gestion d'erreurs : 403/429 (quota), 400 (clé invalide), réseau/CORS, pas de résultats
- [x] Clé API optionnelle : sans clé, la recherche par mot-clé affiche un warning non bloquant (`UI_STATE.WARNING`) au lieu d'une erreur ; l'app reste utilisable via le fallback URL/ID
- [x] Rate limiting géré proprement : 403/429 → warning (non bloquant) au lieu d'erreur, l'utilisateur peut basculer sur la saisie URL/ID ou réessayer plus tard
- [x] Fallback sans clé : saisie URL (`youtu.be/...`, `watch?v=...`, `/shorts/...`, `/embed/...`) ou ID brut → extraction `videoId`
- [x] Sélection résultat → `onSelect(videoId)` → `onSearchSelect(deck, videoId)` dans `app.js` → `loadVideoById`
- [x] UI de configuration de la clé API (⚙️ Paramètres — modal complète avec validation format `AIza…`, persistance `localStorage`)
- [x] Recherche annulable (`AbortController` : une nouvelle recherche annule la précédente)
- [x] Boutons de pagination ‹ › dans la barre d'outils résultats (à gauche du bouton `deck-results-clear`), gérant `nextPageToken`/`prevPageToken` de l'API YouTube Data. Icônes triangle SVG, tooltips adaptés, boutons `disabled` quand pas de page dispo.
- [x] Les vignettes des résultats de recherche sont conservées après sélection d'une vidéo dans chaque voie. Le panneau est remplacé uniquement lors d'une nouvelle recherche, ou vidé manuellement via un bouton "✕ Effacer les résultats" placé sous le champ de recherche. Le résultat actuellement en lecture est marqué visuellement (`.search-result.is-active` + badge "▶ En cours") — `search.markActive(videoId)` exposé par `search.js`, appelé par `app.js#onSearchSelect`.
- [x] Boutons flèches `<` et `>` dans la barre d'outils résultats, à gauche du bouton `deck-results-clear`, pour naviguer dans l'historique des résultats de recherche de la voie concernée (précédent / suivant). Boutons désactivés aux bornes de l'historique. ✅ Fonctionne.

---

## 6. Contrôles avancés & persistance [~]

- [x] Play both / pause both (`#play-both` / `#pause-both`) câblés dans `mixer.js`
- [x] Sync ponctuel B→A (`#sync-ba`) : seek B au `currentTime` de A + play si A joue
- [x] Sync continu (`#resync-toggle`) : `setInterval(1s)`, re-seek si drift > 0.5s, toggle on/off
- [x] Master volume (`#master-volume`) appliqué multiplicativement au crossfade
- [x] Persistance `localStorage` :
  - [x] Clé API (`youtubeApiKey`) — lu/écrit dans `search.js`, modal dans `app.js`
  - [x] Dernière requête par voie (`lastSearchQueryA/B`) — persistée dans `search.js`, restaurée dans `app.js` au démarrage
  - [x] Dernier videoId par voie (`lastVideoIdA/B`) — persisté dans `app.js` (`persistVideoId`)
- [x] Restauration au reload — `lastVideoIdA/B` est lu au démarrage via `getPersistedVideoId(deck)`, fallback sur `CFG.TEST_VIDEO_A/B` si absent
- [ ] **Manquant** : persistance des positions de lecture (`lastSeekA/B`) — clés définies dans `config.js` mais **jamais utilisées**
- [ ] **Manquant** : `seekTo(sec)` après `loadVideoById` pour reprise à la position précédente

---

## 7. Crossfade progressif par paliers ✅

- [x] Variables de config `CROSSFADE_STEP_PERCENT` (palier en %) et `CROSSFADE_STEP_INTERVAL_MS` (intervalle en ms) dans `config.js` + clés `localStorage` (`crossfadeStepPercent`, `crossfadeStepIntervalMs`)
- [x] `mixer.js` : crossfade progressif — la valeur cible du slider est atteinte par paliers de `x%` toutes les `y` ms via `setInterval`, au lieu d'être appliquée instantanément. Comportement instantané conservé si `stepPercent ≥ 100` ou `intervalMs ≤ 0`.
- [x] Modal Paramètres (`index.html`) : 2 sliders (palier %, intervalle ms) avec persistance `localStorage`
- [x] `app.js` : lecture/écriture des 2 réglages, initialisation des inputs au démarrage
- [x] Affichage des volumes A/B toujours synchronisé avec la cible (pas avec la valeur appliquée intermédiaire)

---

## 8. Polissage [~]

- [x] Responsive complet (grille 1 colonne < 720px, barre de mixage en flex-wrap)
- [x] Aucun `console.log` résiduel dans le code de production
- [ ] Raccourcis clavier (play/pause, crossfade ←/→, mute) — seul Escape (modal) et Enter (input clé) sont câblés
- [ ] État visuel des voies (joue / pause / buffer) — seulement l'erreur voie + banner global
- [ ] Documentation des limites dans l'UI (lourdeur double lecture, sync imparfait, quotas) — seulement en commentaires de code, pas dans l'UI

---

## Notes

- **Phases 3, 4, 5 terminées et commitées** (`90d04b3`). Le wrapper YouTube (`youtube.js`) a été simplifié : plus de factory `wrapPlayer()`, objet literal direct, `mute:1` dans `playerVars` pour autoriser l'autoplay, timeout avec fallback.
- **Bug volume corrigé** : `setVolume(0)` dans `app.js` tuait le son même après unmute. Remplacé par `Mixer.applyVolumes()`.
- **Mute/unmute fiabilisé** : helper `setDeckMuted(deck, muted)` centralise l'état + le bouton. Le son est activé systématiquement au changement de vidéo.
- **Validation restante** : tester l'app via `python3 -m http.server` — vérifier crossfade en temps réel, sync B→A, recherche avec clé API.
- **Persistance incomplète** : les videoIds sont sauvés mais pas restaurés au reload ; les positions de lecture ne sont ni sauvées ni restaurées.
- Ordre `CLAUDE.md` : 1 (✅) → 2 (✅) → 3 (✅) → 4 (✅) → 5 (✅) → 6 (~) → 7 (~).
- Prochain jalon : **persistance au reload** (restaurer videoIds + positions), puis **polissage** (raccourcis clavier, état visuel des voies, documentation des limites dans l'UI).

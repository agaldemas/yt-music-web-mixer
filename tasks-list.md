# 📋 YT Music Web Mixer — Tâches

État du projet au 2026-08-10. Référence : `CLAUDE.md` (cahier des charges).

## Légende

- [x] Terminé · [~] Partiellement / en cours · [ ] À faire

> ⚠️ **État Git** : 3 commits sur `main` (`4cdceea` scaffold, `65a70e8` READMEs, `83f42bf` tasks-list).
> Les développements de la **phase 3** (lecteurs YouTube) sont présents dans le **working tree** mais **non commités** (`js/youtube.js`, `js/app.js`, `js/config.js`, `index.html`, `css/styles.css` modifiés). `plan.md` est non suivi.

---

## 1. Squelette HTML/CSS ✅

- [x] Structure `index.html` : header, zone A | B, barre de mixage fixe en bas
- [x] Grille 2 colonnes responsive (`css/styles.css`)
- [x] Voie A (gauche) et voie B (droite) : lecteur, recherche, résultats, badge, mute, erreur
- [x] Barre de mixage : crossfader, play/pause both, sync B→A, sync continu, master volume
- [x] Thème sombre, slider equal-power stylisé, responsive (1 colonne < 720px)
- [x] Fichiers JS squelettes (`config.js`, `youtube.js`, `search.js`, `mixer.js`, `app.js`) avec TODOs
- [~] **Bug à corriger** : `#api-error-banner` est dupliqué dans `index.html` (lignes 19 et 22) et la règle `.api-error-banner` est dupliquée dans `css/styles.css` (lignes 39-48 et 50-59). Les IDs dupliqués sont invalides en HTML — le second `getElementById` ne renverra jamais cet élément.

## 2. Projet & documentation ✅

- [x] `.gitignore` adapté (OS, éditeurs, `.claude/settings.local.json`, `node_modules/`, etc.)
- [x] `git init` + premier commit staging
- [x] `README.md` (anglais) — présentation, démarrage, architecture, limites
- [x] `README.fr.md` (français) — version traduite

---

## 3. Chargement IFrame API + 2 lecteurs [~] (working tree, non commité)

- [x] `js/youtube.js` : chargement asynchrone de l'API IFrame (`loadApiScript` + `onYouTubeIframeAPIReady`)
- [x] `createPlayer(elementId, { onReady, onStateChange, onError })` — wrapper complet avec `wrapPlayer()`
- [x] 2 lecteurs (A, B) créés dans `app.js` et démarrant en `muted` (politique d'autoplay)
- [x] `playerVars` : `{ rel: 0, playsinline: 1, origin: window.location.origin, controls: 1, modestbranding: 1 }` (dans `config.js`)
- [x] Gestion `onError` (codes 2/5/100/101/150) → message localisé dans la voie concernée
- [x] File de chargement (`_pending`) : appels mis en cache avant `onYouTubeIframeAPIReady`, vidés à l'init
- [x] Vidéos de test en dur dans `config.js` (`TEST_VIDEO_A`/`B`) → chargées au bootstrap pour validation
- [x] Timeout 10s (`API_LOAD_TIMEOUT_MS`) si l'API ne charge pas → `showGlobalError()` (banner)
- [x] Méthodes wrapper exposées : `loadVideoById`, `cueVideoById`, `playVideo`, `pauseVideo`, `seekTo`, `setVolume`, `mute`, `unMute`, `getCurrentTime`, `getDuration`, `getPlayerState`
- [x] Constantes d'état exposées : `YTWrapper.STATE` (UNSTARTED/ENDED/PLAYING/PAUSED/BUFFERING/CUED)
- [x] Boutons mute/unmute par voie câblés dans `app.js` (avec `aria-pressed`)
- [ ] **Non validé en console** : `playVideo`/`setVolume` non testés manuellement (voir Notes)
- [ ] **Manquant** : pas de play/pause par voie, pas de play both / pause both (boutons présents dans le HTML mais non câblés dans `app.js`)

---

## 4. Crossfader [ ]

- [ ] `js/mixer.js` : toujours un squelette vide (TODO) — aucune logique crossfade
- [ ] Calcul equal-power : `vA = cos(p·π/2)·100`, `vB = sin(p·π/2)·100`
- [ ] Application : `playerA.setVolume(vA·master/100)`, `playerB.setVolume(vB·master/100)`
- [ ] Slider lié aux volumes (temps réel)
- [ ] Affichage valeur du crossfade + master
- [ ] Slider accessible au clavier

> Note : les éléments UI (slider `#crossfade`, `#xf-value`, `#master-volume`, `#master-value`) existent déjà dans `index.html` et sont stylés dans `css/styles.css`, mais aucun `addEventListener` ne les relie. `app.js` ne câble pas la barre de mixage.

---

## 5. Recherche [ ]

- [ ] `js/search.js` : toujours un squelette vide (TODO)
- [ ] Recherche YouTube Data API (`videoCategoryId=10` = Musique)
- [ ] Affichage résultats : vignette + titre + durée
- [ ] États UI du panneau : `idle`, `loading`, `results`, `error`, `no-results`
- [ ] Gestion d'erreurs : 403/429 (quota), 400 (clé invalide), réseau/CORS, pas de résultats
- [ ] Fallback sans clé : saisie URL (`youtu.be/...`, `watch?v=...`) ou ID brut → extraction `videoId`
- [ ] Sélection résultat → renvoie `videoId` au lecteur de la voie (A ou B)
- [ ] UI de configuration de la clé API (⚙️ Paramètres — bouton présent mais non câblé)

---

## 6. Contrôles avancés & persistance [ ]

- [ ] `js/app.js` : bootstrap minimal phase 3 uniquement, câblage transport/sync/persistance manquant
- [ ] Play/pause par voie + play both / pause both (boutons `#play-both`/`#pause-both` présents, non câblés)
- [ ] Sync ponctuel B→A (seek + play si A joue) — bouton `#sync-ba` présent, non câblé
- [ ] Sync continu (optionnel, `setInterval ~1s`, re-seek si écart > 0.5s) — bouton `#resync-toggle` présent, non câblé
- [ ] Bouton `resync off` pour désactiver le sync continu
- [ ] Persistance `localStorage` :
  - [~] Clés de stockage définies dans `config.js` (`STORAGE_KEYS`), mais **aucune lecture/écriture** dans `app.js` (clé API, videoIds, requêtes, positions)
  - [ ] Au reload : `seekTo(sec)` après `loadVideoById` pour reprise à la position

---

## 7. Polissage [ ]

- [x] Responsive complet (grille 1 colonne < 720px, barre de mixage en flex-wrap)
- [ ] Raccourcis clavier
- [ ] État visuel des voies (joue / pause / buffer / erreur) — seulement erreur voie + banner global
- [ ] Documentation des limites dans l'UI (lourdeur double lecture, sync imparfait, quotas)
- [ ] Suppression des `console.log` non critiques (actuellement aucun log résiduel)

---

## Notes

- **Phase 3 en working tree non commitée.** Le wrapper YouTube (`js/youtube.js`) est complet et fonctionnel ; `app.js` ne couvre que la création des 2 lecteurs en muted + boutons mute/unmute. Les contrôles de transport (play/pause, sync, crossfade, master volume) ont leurs boutons dans le HTML mais ne sont **pas câblés**.
- **Validation restante phase 3** : ouvrir `index.html` (ou servir via `python3 -m http.server`), vérifier que les 2 lecteurs chargent les vidéos de test, tester `window.state.players.A.playVideo()` / `.setVolume(50)` depuis la console, et cliquer les boutons mute/unmute. À faire avant d'attaquer la phase 4.
- **Bugs HTML/CSS à corriger** : `#api-error-banner` dupliqué dans `index.html` (lignes 19 & 22) et `.api-error-banner` dupliquée dans `css/styles.css` (lignes 39-48 & 50-59). Les IDs dupliqués sont invalides — le second `getElementById('api-error-banner')` ne cible jamais l'élément dupliqué.
- L'ordre suggéré dans `CLAUDE.md` : 1 (✅) → 2 (✅) → 3 (~) → 4 → 5 → 6 → 7.
- Prochain jalon : finir la **phase 3** (câbler play/pause both + validation console), puis attaquer la **phase 4** (crossfader dans `mixer.js`).

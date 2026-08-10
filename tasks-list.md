# 📋 YT Music Web Mixer — Tâches

État du projet au 2026-08-10. Référence : `CLAUDE.md` (cahier des charges).

## Légende

- [x] Terminé · [~] Partiellement / en cours · [ ] À faire

---

## 1. Squelette HTML/CSS ✅

- [x] Structure `index.html` : header, zone A | B, barre de mixage fixe en bas
- [x] Grille 2 colonnes responsive (`css/styles.css`)
- [x] Voie A (gauche) et voie B (droite) : lecteur, recherche, résultats, badge, mute, erreur
- [x] Barre de mixage : crossfader, play/pause both, sync B→A, sync continu, master volume
- [x] Thème sombre, slider equal-power stylisé, responsive (1 colonne < 720px)
- [x] Fichiers JS squelettes (`config.js`, `youtube.js`, `search.js`, `mixer.js`, `app.js`) avec TODOs

## 2. Projet & documentation ✅

- [x] `.gitignore` adapté (OS, éditeurs, `.claude/settings.local.json`, `node_modules/`, etc.)
- [x] `git init` + premier commit staging
- [x] `README.md` (anglais) — présentation, démarrage, architecture, limites
- [x] `README.fr.md` (français) — version traduite

---

## 3. Chargement IFrame API + 2 lecteurs [ ]

- [ ] `js/youtube.js` : chargement asynchrone de l'API IFrame (`onYouTubeIframeAPIReady`)
- [ ] `createPlayer(elementId, { onReady, onStateChange, onError })`
- [ ] 2 lecteurs (A, B) démarrant en `muted`
- [ ] `playerVars` : `{ rel: 0, playsinline: 1, origin: window.location.origin }`
- [ ] Gestion `onError` (codes 100/101/150) → message dans la voie concernée
- [ ] File de chargement (cache des appels avant `onReady`)
- [ ] Vidéos de test en dur pour valider `playVideo`/`setVolume` depuis la console
- [ ] Timeout 10s si l'API ne charge pas → message d'erreur global

## 4. Crossfader [ ]

- [ ] `js/mixer.js` : état `crossfade`, `masterVolume`, `isPlayingA/B`
- [ ] Calcul equal-power : `vA = cos(p·π/2)·100`, `vB = sin(p·π/2)·100`
- [ ] Application : `playerA.setVolume(vA·master/100)`, `playerB.setVolume(vB·master/100)`
- [ ] Slider lié aux volumes (temps réel)
- [ ] Affichage valeur du crossfade + master
- [ ] Slider accessible au clavier

## 5. Recherche [ ]

- [ ] `js/search.js` : recherche YouTube Data API (`videoCategoryId=10` = Musique)
- [ ] Affichage résultats : vignette + titre + durée
- [ ] États UI du panneau : `idle`, `loading`, `results`, `error`, `no-results`
- [ ] Gestion d'erreurs : 403/429 (quota), 400 (clé invalide), réseau/CORS, pas de résultats
- [ ] Fallback sans clé : saisie URL (`youtu.be/...`, `watch?v=...`) ou ID brut → extraction `videoId`
- [ ] Sélection résultat → renvoie `videoId` au lecteur de la voie (A ou B)
- [ ] UI de configuration de la clé API (⚙️ Paramètres)

## 6. Contrôles avancés & persistance [ ]

- [ ] `js/app.js` : bootstrap, état global (`state`), câblage événements
- [ ] Play/pause par voie + play both / pause both
- [ ] Sync ponctuel B→A (seek + play si A joue)
- [ ] Sync continu (optionnel, `setInterval ~1s`, re-seek si écart > 0.5s)
- [ ] Bouton `resync off` pour désactiver le sync continu
- [ ] Persistance `localStorage` :
  - [ ] `youtubeApiKey`, `lastVideoIdA/B`, `lastSearchQueryA/B`, `lastSeekA/B`
  - [ ] Au reload : `seekTo(sec)` après `loadVideoById` pour reprise à la position

## 7. Polissage [ ]

- [ ] Responsive complet
- [ ] Raccourcis clavier
- [ ] État visuel des voies (joue / pause / buffer / erreur)
- [ ] Documentation des limites dans l'UI (lourdeur double lecture, sync imparfait, quotas)
- [ ] Suppression des `console.log` non critiques

---

## Notes

- Les étapes 1 et 2 sont les seules terminées. L'étape 3 (lecteurs YouTube) est le prochain jalon fonctionnel.
- L'ordre suggéré dans `CLAUDE.md` : 1 (✅) → 2 (✅) → 3 → 4 → 5 → 6 → 7.

# YT Music Web Mixer — Guide des agents

Application web **sans serveur** (HTML + JS pur, ouverte via `file://` ou un hébergement statique) permettant de charger 2 morceaux YouTube côte à côte (voies **A** et **B**), de les lancer, et de les mixer via un **crossfader** en bas de page.

## Objectif produit

- 2 fenêtres côte à côte : **A** (gauche) et **B** (droite). Chacune contient un lecteur YouTube + une barre de recherche.
- L'utilisateur recherche un morceau dans chaque voie, le sélectionne, il se charge dans le lecteur correspondant.
- Barre d'outils en bas : un **slider de crossfade A↔B** (0 = full A, 100 = full B, 50 = équilibré), plus contrôles de lecture (play/pause, sync, volume master).
- Le slider ajuste en temps réel le volume relatif de A et B.

## Contraintes techniques majeures (À LIRE)

1. **Pas d'accès au flux audio YouTube.** L'API IFrame YouTube ne donne pas accès au `AudioBuffer` / `MediaElementAudioSourceNode` (origine croisée, pas de CORS sur l'iframe). **On ne peut PAS** faire de vrai mixage DSP (EQ, filtres, analyse spectrale, beatmatch) sur le son YouTube. Le "mixage" se fait **uniquement par contrôle du volume** de chaque lecteur (`setVolume`). Ne pas perdre de temps à tenter un branchement Web Audio API sur l'iframe — ça ne marche pas et c'est documenté comme impossible.
2. **Crossfade = contrôle de volume.** `playerA.setVolume(vA)`, `playerB.setVolume(vB)`. Utiliser une courbe d'amplitude (linéaire simple, voire equal-power `sqrt` si on veut être propre) pour éviter le creux de niveau au milieu.
3. **Autoplay / politique navigateur.** Un lecteur doit être **muted** pour démarrer sans geste utilisateur. Chaque voie (A et B) doit avoir son propre **bouton mute/unmute** ("Activer le son") déclenché par clic, car le navigateur traite chaque lecteur indépendamment. Les deux lecteurs ne peuvent pas démarrer en son fort sans interaction. À l'initialisation, démarrer les deux lecteurs en `muted`, puis proposer un unmute explicite par voie.
4. **Recherche YouTube sans serveur.** L'API YouTube Data v3 exige une clé. Comme il n'y a pas de serveur pour masquer la clé :
   - **Option recommandée** : l'utilisateur fournit sa propre clé API YouTube Data (récupérée sur Google Cloud Console), stockée en `localStorage`. La recherche se fait en `fetch()` direct vers `https://www.googleapis.com/youtube/v3/search`.
   - **Fallback sans clé** : saisie manuelle d'une URL YouTube ou d'un ID vidéo dans chaque voie (pas de recherche).
   - **Ne jamais** embarquer une clé partagée dans le code source.
5. **Pas de build, pas de bundler.** HTML + JS vanilla. Pas de `npm install`, pas de framework. Une page `index.html` + quelques fichiers JS en modules (`<script type="module">`) ou scripts simples. Doit fonctionner en double-cliquant le fichier.
6. **CORS / `file://`.** Les modules ES peuvent être bloqués en `file://` selon le navigateur. Préférez des scripts classiques (`<script src="js/app.js">`). **Attention : l'appel `fetch()` vers l'API YouTube Data peut aussi être bloqué en `file://` dans certains navigateurs (Chrome notamment).** Pour la recherche, recommandez FORTEMENT de servir via `python3 -m http.server` ou tout serveur statique. L'app doit au minimum s'ouvrir en `file://` pour les lecteurs YouTube, mais la recherche peut nécessiter un serveur local.

## Architecture de fichiers

```
yt-music-web-mixer/
├── CLAUDE.md            # ce fichier
├── index.html           # structure : header, zone A | B, barre de mixage
├── css/
│   └── styles.css       # layout grille 2 colonnes + barre fixe en bas
└── js/
    ├── config.js        # constantes, lecture clé API depuis localStorage
    ├── youtube.js       # wrapper YouTube IFrame API (load API, créer joueurs A/B)
    ├── search.js        # recherche YouTube Data API + affichage résultats
    ├── mixer.js         # logique crossfade (slider → volumes A/B)
    └── app.js           # bootstrap, câblage événements, état global
```

### `youtube.js` — Wrapper IFrame Player
- Charge l'API IFrame YouTube de façon asynchrone (script tag vers `https://www.youtube.com/iframe_api`).
- Expose `createPlayer(elementId, { onReady, onStateChange, onError })` retournant un objet joueur.
- **Méthodes utilisées** : `loadVideoById(id)` (ou `cueVideoById(id)` + `playVideo()`), `playVideo()`, `pauseVideo()`, `seekTo(sec)`, `setVolume(0-100)`, `mute()`, `unMute()`, `getCurrentTime()`, `getDuration()`, `getPlayerState()`.
  - `loadVideoById` est préféré (charge ET joue automatiquement) ; `cueVideoById` ne fait que charger sans jouer.
- **Constantes d'état du lecteur** (via `getPlayerState()`) :
  - `-1` = UNSTARTED, `0` = ENDED, `1` = PLAYING, `2` = PAUSED, `3` = BUFFERING, `5` = CUED.
- **Paramètres `playerVars` recommandés** à la création : `{ rel: 0, playsinline: 1, origin: window.location.origin }` pour éviter les vidéo suggérées en fin de lecture, forcer le lecture inline, et fixer l'origine.
- **Gestion des erreurs YouTube IFrame** : écouter le callback `onError` (code 100 = vidéo supprimée/privée, 101 = intégration refusée, 150 = contenu restreint). Afficher un message clair dans la voie concernée.
- Garder une **file de chargement** : l'API n'est pas prête immédiatement, met en cache les appels avant `onYouTubeIframeAPIReady`.

### `search.js` — Recherche
- Si clé API présente : `GET https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&q=<query>&key=<key>` (`videoCategoryId=10` = Musique). Afficher vignette + titre + durée éventuelle.
- **Gestion d'erreurs obligatoire pour la recherche** :
  - **403 / 429** (quota dépassé) → message "Quota API dépassé, réessayer plus tard" + proposer le fallback URL manuelle.
  - **400** (clé invalide) → message "Clé API invalide, vérifier dans les paramètres".
  - **Échec réseau / CORS** → message "Impossible de contacter l'API YouTube. Utiliser le mode sans clé (saisie d'URL)."
  - **Pas de résultats** → message adapté, pas un tableau vide.
- **États d'UI du panneau de recherche** : `idle` (champ vide), `loading` (spinner), `results` (grille de résultats), `error` (message d'erreur selon le cas), `no-results`.
- Sélection d'un résultat → renvoie le `videoId` au lecteur de la voie concernée (A ou B).
- Fallback sans clé : champ acceptant URL (`youtu.be/...`, `watch?v=...`) ou ID brut → extraire le `videoId`.

### `mixer.js` — Crossfader
- État : `crossfade` (0–100), `masterVolume` (0–100), `isPlayingA/B`.
- Calcul des volumes : pour une position `p` (0–1) :
  - Linéaire : `vA = (1-p)*100`, `vB = p*100`.
  - Equal-power (préféré) : `vA = Math.cos(p*Math.PI/2)*100`, `vB = Math.sin(p*Math.PI/2)*100`.
- Applique via `playerA.setVolume(vA * master/100)` (idem B) à chaque mouvement de slider.
- Boutons : `play/pause` par voie + `play both` / `pause both`, `sync B on A`, `resync`.
- **Sync B → A — contrat détaillé** :
  - **Sync ponctuel** (au clic) : seek B au `currentTime` de A et lance B si A joue. C'est le comportement de base.
  - **Sync continu (optionnel, à activer par l'utilisateur)** : lancer une `setInterval(~1s)` qui compare `currentTime` des deux lecteurs. Si l'écart dépasse 0.5s, re-seeker le retardataire. Désactiver avec un bouton `resync off`.
  - **Important** : le sync continu n'est jamais parfait — le temps de seek + buffering crée une micro-coupure audible. À documenter dans l'UI.
  - **Drift** : les deux lecteurs YouTube ne sont pas synchronisés à la trame. Même avec sync continu, un écart résiduel de 200-500ms est normal. Ne pas promettre un sync parfait.
- Slider accessible au clavier, valeurs affichées.

### `app.js` — Bootstrap
- Initialise 2 lecteurs (A, B), 2 modules de recherche, le mixer.
- Gère l'état global (joueur prêt, clé API, videoIds courants).
- **Stratégie de persistance en `localStorage`** :
  - `youtubeApiKey` : clé API YouTube Data.
  - `lastVideoIdA`, `lastVideoIdB` : derniers videoIds chargés.
  - `lastSearchQueryA`, `lastSearchQueryB` : dernières requêtes de recherche.
  - `lastSeekA`, `lastSeekB` : `currentTime` au moment de l'arrêt (pour reprise à la même position).
  - Au reload : si `lastSeekA` existe, faire `seekTo(sec)` après `loadVideoById` pour reprendre à la position précédente (pas seulement recharger au début).
  - **Limite** : si le navigateur purge `localStorage` ou si l'utilisateur est en navigation privée, pas de persistance. C'est normal.
- **Gestion des erreurs globales** :
  - Si l'API YouTube ne charge pas (timeout après 10s), afficher un message "Impossible de charger YouTube. Vérifier votre connexion ou les bloqueurs de pub."
  - Si un lecteur est en erreur, afficher un message dans sa voie, pas dans toute l'application.
  - Si la clé API est invalide, le signaler dans l'interface de configuration, pas seulement dans la console.

## Plan d'implémentation (ordre suggéré)

1. **Squelette HTML/CSS** : grille 2 colonnes responsive + barre fixe en bas. Lecture visuelle correcte avant toute logique.
2. **Chargement IFrame API + 2 lecteurs** : afficher 2 vidéos de test (IDs codés en dur), vérifier `playVideo`/`setVolume` depuis la console.
3. **Crossfader** : slider lié aux volumes des 2 lecteurs. C'est le cœur fonctionnel — à valider tôt.
4. **Recherche** : champ + résultats dans chaque voie (avec clé API utilisateur saisie via UI).
5. **Contrôles avancés** : sync, play/pause both, master volume, persistance.
6. **Polissage** : responsive, raccourcis clavier, état visuel des voies.

## Conventions de code

- JS vanilla, **pas de dépendances externes** (pas de React, pas de jQuery).
- Noms en `camelCase`, constantes en `UPPER_SNAKE`.
- Un seul état global dans `app.js` (objet `state`), les modules reçoivent leurs dépendances en paramètre (pas d'import circulaire).
- Commentaires courts en français, noms de variables en anglais.
- Pas de console.log en production finale (sauf erreurs critiques).

## À ne pas faire

- ❌ Brancher l'iframe YouTube dans Web Audio API (impossible, cross-origin).
- ❌ Embarquer une clé API dans le code source.
- ❌ Introduire un bundler / framework / serveur Node.
- ❌ Stocker des données utilisateur ailleurs que `localStorage`.
- ❌ Appeler l'API YouTube Data sans que l'utilisateur ait fourni sa clé.

## Limites connues à documenter dans l'UI

- Le "mixage" est un **crossfade de volumes**, pas un mixage DSP. Pas d'EQ, pas de tempo sync automatique.
- **⚠️ ATTENTION — Lourdeur de la double lecture :** La lecture simultanée de 2 vidéos YouTube peut être très lourde (CPU, RAM, réseau). Recommandations à afficher :
  - Fermer les autres onglets lourds.
  - Réduire la qualité vidéo (paramètre YouTube, non contrôlable par l'app).
  - Sur machine modeste, préférer une seule voie à la fois.
  - Si la lecture saccade, baisser le volume de l'interface système.
- La clé API YouTube Data est soumise à **quotas Google** (10 000 unités/jour par défaut, une recherche = 100 unités). Au-delà, la recherche est bloquée jusqu'au lendemain.
- **Le sync continu n'est jamais parfait :** un écart résiduel de 200-500ms est normal. Pas de sync frame-accurate possible sur YouTube.
- **La persistance est limitée :** en navigation privée ou après vidage du cache, les données sauvegardées (`localStorage`) sont perdues.

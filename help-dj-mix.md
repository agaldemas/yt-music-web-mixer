# 🎚️ Aide — Interface du Deck DJ

> yt-music-web-mixer — Guide de l'interface DJ

Cette page explique chaque contrôle du **deck DJ** (voie A ou B). Le mode DJ active le vrai mixage audio via Web Audio API : crossfade par `GainNode`, EQ 3 bandes, filtre DJ, pitch/tempo, détection BPM, et **cue points & boucles**.

---

## 🔄 Les deux modes de l'application

L'application fonctionne en **dual mode** : un bouton dans l'en-tête permute les **deux decks ensemble** entre le mode DJ et le mode vidéo YouTube. Il n'y a pas de mode hybride (un deck DJ + un deck YT) — la bascule est globale.

### Mode DJ (Audio / DSP) 🔊

![Application en mode DJ](app-dj-mode.png)

> Le bouton d'en-tête affiche **🔊 DJ**. Le flux audio est extrait localement (backend `yt-dlp`) puis traité via **Web Audio API**. On perd la vidéo YouTube (audio-only) mais on gagne le vrai mixage : crossfade audio réel, EQ, filtres, analyse spectrale, BPM, cue/loop.

### Mode YT IFrame (YouTube) 📺

![Application en mode YouTube IFrame](app-youtube-mode.png)

> Le bouton d'en-tête affiche **📺 YT IFrame**. Lecteur vidéo YouTube officiel, mais le "mixage" se fait **uniquement par contrôle du volume** (`setVolume`) — pas de DSP possible sur l'iframe (origine croisée, pas de CORS). Les contrôles DJ (EQ, filtre, pitch, BPM, cue/loop) sont masqués.

> 💡 **Pour passer de l'un à l'autre** : clique sur le bouton **🔊 DJ / 📺 YT IFrame** dans l'en-tête. Le mode « Auto » (résolution au démarrage) n'est atteignable que depuis la modal Paramètres.

---

## 🖼️ Focus : le bloc CUE & LOOP

![Aperçu de l'interface du deck DJ](dj-deck-ui.png)

Le bloc ci-dessus regroupe les boutons de navigation dans le morceau : **cue point**, **marqueurs de boucle**, **boucles de N beats**, et **activation/effacement de la boucle**.

---

## 📍 Vue d'ensemble d'un deck (mode DJ)

Chaque deck (voie A à gauche, voie B à droite) contient, de haut en bas :

| Zone | Rôle |
|------|------|
| **Recherche** | Champ de recherche YouTube (clé API) ou Piped (sans clé) + résultats |
| **Now playing** | Miniature, titre, uploader, badge de mode (DJ · DSP / YT IFrame) |
| **Lecteur + visualiseur** | Canvas spectre/waveform (remplace la vidéo YouTube en mode DJ) |
| **Barre de transport** | ▶/⏸ lecture/pause, curseur de position, temps courant / durée |
| **Bloc DJ** (EQ + filtre + pitch + BPM) | Faders verticaux LOW/MID/HIGH, knob FILTER, fader PITCH, badge BPM |
| **Bloc CUE & LOOP** | Boutons de cue et boucles (détaillés ci-dessous) |

---

## 🎛️ Bloc DJ (EQ + filtre + pitch + BPM)

### EQ 3 bandes — `LOW` / `MID` / `HIGH`

Trois faders verticaux par voie, de **−12 dB** (bas = coupé) à **+12 dB** (haut = amplifié). Le centre (0 dB) est neutre.

- **LOW** : graves (sub, kick drum, basse) — 200 Hz
- **MID** : médiums (voix, mélodies, snare) — 1000 Hz
- **HIGH** : aigus (cymbales, transitoires, chapelet) — 4000 Hz

> Double-clic sur un fader = reset à 0 dB. Le petit bouton **↺** à côté fait pareil en un clic.

### Filtre DJ — `FILTER`

Un knob vertical, de **−1** (bas) à **+1** (haut), centré à 0 (bypass) :

- **Bas (−1)** : lowpass très fermé → son étouffé, on ne garde que les graves (200 Hz)
- **Centre (0)** : transparent, audio non modifié
- **Haut (+1)** : highpass très ouvert → on ne garde que les aigus (au-dessus de 5 kHz)

> Le knob balaie en échelle **logarithmique** : la sensation est régulière. Double-clic = bypass.

### Pitch / Tempo — `PITCH`

Fader vertical de **−8 %** à **+8 %**, centré à 0 %.

- Modifie la **vitesse de lecture** (`playbackRate`) sans changer la **hauteur** (pas d'effet "chipmunk") grâce à `preservesPitch`.
- Sert au **beatmatching** : ajuster le tempo de B pour le caler sur A.
- Le **BPM effectif** affiché dans le badge BPM tient compte du pitch (BPM × playbackRate).

> ⚠️ Ne fonctionne qu'en mode DJ. Double-clic = reset à 0 %.

### Badge BPM

Affiche le tempo détecté en temps réel, avec 3 états visuels :

| État | Couleur | Signification |
|------|---------|---------------|
| `idle` / `detecting` | 🔴 rouge (pulsé) | Acquisition en cours, pas encore de valeur fiable |
| `estimating` | 🟠 orange | BPM provisoire affiché (~2-3 s), affinage en arrière-plan |
| `locked` | 🟢 vert | BPM verrouillé, valeur fiable |

> Le bouton **↺** sous le badge relance le calcul (repart de zéro). La détection est **approximative** (±2-3 BPM) — les transitions et breaks peuvent fausser la mesure.

---

## 🔁 Bloc CUE & LOOP — Détail des boutons

C'est la partie qui nous intéresse le plus. Voici chaque bouton, de gauche à droite :

### `◆ CUE` — Point de repère

Sauvegarde et rappelle une position dans le morceau.

| Action | Comportement |
|--------|-------------|
| **1er clic** (aucun cue défini) | Mémorise la position courante (`currentTime`). Le bouton devient vert (`is-set`). |
| **Clic suivant** (cue déjà défini) | Seek immédiat vers le point mémorisé. |
| **Double-clic** | Seek vers le cue **ET** lance la lecture (play depuis le cue). |

> Comportement type console DJ : tu calez un point de départ (intro, drop, premier beat), puis tu peux y revenir instantanément d'un seul clic.

### `⤓ IN` — Marqueur de début de boucle (Loop In)

Pose le **point d'entrée** de la boucle à la position courante.

- Le bouton s'allume en **orange** (`aria-pressed`) quand le marqueur est posé.
- Si tu poses un `IN` **après** un `OUT` existant, le `OUT` est automatiquement effacé (il doit toujours être après le `IN`).

### `⤒ OUT` — Marqueur de fin de boucle (Loop Out)

Pose le **point de sortie** de la boucle à la position courante.

- Le bouton s'allume en **orange** quand le marqueur est posé.
- Si tu poses un `OUT` **avant** un `IN` existant, le `IN` est automatiquement effacé.

> Une fois que **les deux** marqueurs `IN` et `OUT` sont posés (et que `OUT > IN`), le bouton **🔁 LOOP** devient actif (utilisable).

### `1` / `2` / `4` / `8` — Boucle de N beats

Pose automatiquement une boucle de **1, 2, 4 ou 8 beats** à partir de la position courante.

- La **durée d'un beat** est calculée à partir du **BPM détecté** (`60 / BPM`).
- Si le BPM est encore en cours d'estimation, on utilise le **BPM provisoire** (orange).
- Si aucun BPM n'est disponible (rouge, pas encore de beats accumulés), un message t'invite à patienter : « BPM non détecté — impossible de calibrer la boucle. »
- La boucle est **immédiatement activée** (pas besoin de cliquer `🔁 LOOP` après).

> Exemple : BPM = 128 → 1 beat = 0,469 s. Le bouton `4` crée une boucle de ~1,875 s à partir de maintenant.

### `🔁 LOOP` — Activation / désactivation de la boucle

Bouton **toggle** : active ou désactive la boucle A↔B définie par `IN` et `OUT`.

- **Grisé** (désactivé) tant que les deux marqueurs ne sont pas posés.
- **Bleu** (`aria-pressed="false"`) : boucle définie mais inactive.
- **Vert** (`aria-pressed="true"`) : boucle **active** — l'audio rejoue depuis `IN` dès qu'il atteint `OUT`.

> La surveillance tourne à ~60 Hz (`requestAnimationFrame`), donc la transition est quasi **sample-accurate** (plus fiable qu'un `timeupdate` qui ne se déclenche qu'~4 fois par seconde).

### `✕` — Effacer la boucle (Clear)

Le petit bouton rond **à droite**.

- Efface **les deux** marqueurs `IN` et `OUT` de cette voie.
- Désactive la boucle active.
- Les marqueurs sont aussi retirés du `localStorage`.

> C'est le bouton "reset complet" de la boucle. À utiliser quand tu veux repartir d'une boucle propre, ou quand tes marqueurs ne sont plus pertinents (changement de section du morceau, etc.).

---

## 💾 Persistance

Les réglages suivants sont sauvegardés dans le `localStorage` et restaurés au prochain démarrage :

| Réglage | Clé | Comportement au reload |
|---------|-----|------------------------|
| Cue point | `cueA` / `cueB` | Restauré ✅ |
| Loop In | `loopInA` / `loopInB` | Restauré ✅ |
| Loop Out | `loopOutA` / `loopOutB` | Restauré ✅ |
| Boucle active | — | **Non réactivée** ❌ (une boucle qui se relance toute seule au démarrage serait surprenante — tu dois cliquer `🔁 LOOP` pour la relancer) |

> ⚠️ Au changement de morceau, **les cue points et marqueurs de boucle sont effacés** : leurs positions (en secondes) ne correspondent plus au nouveau morceau.

---

## ⚠️ Limites & points d'attention

- **Mode DJ uniquement** : le bloc CUE & LOOP est masqué en mode IFrame YouTube (le loop précis n'est pas possible sur l'iframe — pas d'accès au `currentTime` à la milliseconde).
- **BPM approximatif** (±2-3 BPM) : les boucles de N beats peuvent être légèrement décalées sur des morceaux à tempo variable (transitions, breaks).
- **Loop de N beats sans BPM** : si le détecteur n'a pas encore de valeur, attends quelques secondes que le BPM provisoire (orange) s'affiche.
- **Deux boucles actives** (A et B) : tu peux avoir une boucle active sur chaque voie simultanément — utile pour caler une transition.
- **Cue + boucle** : les deux sont indépendants. Le cue n'est pas affecté par la boucle ; tu peux boucler une section et revenir à ton cue d'un clic.

---

## 🎯 Cas d'usage typiques

### 1. Caler une transition (beatmatch)
1. Charge le morceau A, laisse le BPM se verrouiller (vert).
2. Charge le morceau B, laisse le BPM se verrouiller.
3. Clique **🎚️ SYNC BPM** dans la barre de mixage → le tempo de B s'ajuste (±8 %) pour matcher A.
4. Utilise **🔗 Sync B → A** pour caler la position.
5. Fais glisser le **crossfade** de A vers B.

### 2. Boucler un drop
1. Attends le début du drop, clique **⤓ IN**.
2. À la fin du drop, clique **⤒ OUT**.
3. Clique **🔁 LOOP** → le drop tourne en boucle.
4. Mix par-dessus avec l'autre voie, puis clique **🔁 LOOP** pour relâcher.

### 3. Boucle de 4 beats improvisée
1. Repère le premier beat d'une phrase.
2. Clique **4** → une boucle de 4 beats (1 mesure) se crée et s'active immédiatement.
3. Ajuste au besoin : re-clique **4** depuis une nouvelle position, ou **✕** pour effacer.

### 4. Revenir à un point précis (cue)
1. À l'intro, clique **◆ CUE** (le bouton passe en vert).
2. Laisse le morceau avancer.
3. Clique **◆ CUE** → retour instantané à l'intro.
4. **Double-clic** → retour **ET** lecture.

# 🎵 YT Music Web Mixer

Application web **sans serveur** (HTML + JS pur) permettant de charger 2 morceaux YouTube côte à côte (voies **A** et **B**) et de les mixer via un **crossfader** en bas de page.

> ⚠️ Le « mixage » ici est un **crossfade de volumes** : on contrôle le volume relatif de chaque lecteur YouTube. Aucun traitement DSP (EQ, filtres, beatmatch) n'est possible sur le son YouTube — voir [Limites connues](#-limites-connues).

---

## ✨ Fonctionnalités

- **2 voies côte à côte** (A à gauche, B à droite), chacune avec son lecteur YouTube et sa barre de recherche.
- **Recherche YouTube** par mot-clé (nécessite une clé API YouTube Data) **ou** saisie manuelle d'une URL / ID vidéo.
- **Crossfader A↔B** (0 = full A, 100 = full B, 50 = équilibré) avec courbe *equal-power* pour éviter le creux de niveau au milieu.
- **Volume master** global (0–100%).
- **Boutons mute/unmute par voie** (obligatoire pour contourner les politiques d'autoplay des navigateurs).
- **Contrôles de lecture** : *play both* / *pause both*.
- **Sync B → A** : aligner B sur la position de A (ponctuel ou continu).
- **Démutage automatique au changement de vidéo** : la sélection d'un nouveau morceau active le son automatiquement (le clic compte comme geste utilisateur pour les politiques d'autoplay).
- **Affichage séparé des volumes A/B** : la barre de crossfade affiche le pourcentage de volume de chaque voie individuellement.
- **Curseur de crossfade style mixage** : rectangle 15×30px avec curseur `ew-resize`, comme un fader de console matérielle.
- **Persistance** via `localStorage` : clé API, dernières requêtes et derniers videoIds sauvegardés. Les requêtes sont restaurées dans les champs de recherche au reload.
- **Responsive** : passe en une colonne sur petit écran.

---

## 🚀 Démarrage

### 1. Ouvrir l'application

Double-cliquez sur `index.html` pour l'ouvrir en `file://`. Les lecteurs YouTube fonctionnent dans ce mode.

### 2. (Recommandé) Servir en local pour la recherche

L'appel `fetch()` vers l'API YouTube Data peut être bloqué en `file://` (notamment sur Chrome). Pour activer la recherche, lancez un serveur statique :

```bash
python3 -m http.server 8000
```

Puis ouvrez <http://localhost:8000>.

### 3. Configurer la clé API YouTube Data (optionnel mais recommandé)

- Récupérez une clé sur [Google Cloud Console](https://console.cloud.google.com/) (API *YouTube Data API v3*).
- Ouvrez l'app → ⚙️ **Paramètres** → collez votre clé.
- La clé est stockée localement dans votre navigateur (`localStorage`), jamais envoyée ailleurs que vers Google.

> Sans clé, utilisez le **fallback manuel** : collez une URL YouTube (`youtu.be/...`, `watch?v=...`) ou un ID vidéo brut dans le champ de recherche.

---

## 🗂️ Architecture

```
yt-music-web-mixer/
├── CLAUDE.md            # Guide des agents (cahier des charges)
├── README.md            # ce fichier
├── index.html           # structure : header, zone A | B, barre de mixage
├── css/
│   └── styles.css       # layout grille 2 colonnes + barre fixe en bas
└── js/
    ├── config.js        # constantes, lecture clé API depuis localStorage
    ├── youtube.js       # wrapper YouTube IFrame API (chargement, joueurs A/B)
    ├── search.js        # recherche YouTube Data API + affichage résultats
    ├── mixer.js         # logique crossfade (slider → volumes A/B)
    └── app.js           # bootstrap, câblage événements, état global
```

**Stack** : HTML + CSS + JS vanilla. Aucune dépendance, aucun bundler, aucun framework. Fonctionne en `file://` (lecteurs) ou via serveur statique (recherche).

---

## 🎛️ Utilisation

1. Dans la **voie A**, recherchez ou collez un morceau → sélectionnez-le → il se charge dans le lecteur A (le son est activé automatiquement).
2. Faites de même pour la **voie B**.
3. (Optionnel) Basculez **🔇 / 🔊** sur une voie pour muter/démuter individuellement.
4. Lancez la lecture (**▶️ Play both**).
5. Bougez le **crossfader** pour passer progressivement de A à B.
6. Ajustez le **volume master** si besoin.
7. Optionnel : **Sync B → A** pour aligner B sur la position de A.

---

## ⚠️ Limites connues

- **Pas de vrai mixage DSP.** L'API IFrame YouTube ne donne pas accès au flux audio (cross-origin, pas de CORS). Le mixage se fait **uniquement par contrôle du volume** (`setVolume`). Pas d'EQ, pas de tempo sync automatique.
- **Lourdeur de la double lecture.** La lecture simultanée de 2 vidéos YouTube peut être lourde (CPU, RAM, réseau). Recommandations :
  - Fermez les autres onglets lourds.
  - Sur machine modeste, préférez une seule voie à la fois.
  - Si la lecture saccade, réduisez la qualité côté YouTube (non contrôlable par l'app).
- **Quotas API YouTube Data.** 10 000 unités/jour par défaut, une recherche = 100 unités. Au-delà, la recherche est bloquée jusqu'au lendemain.
- **Sync continu imparfait.** Un écart résiduel de 200–500ms est normal (le seek + buffering crée une micro-coupure). Pas de sync *frame-accurate* possible sur YouTube.
- **Persistance limitée.** En navigation privée ou après vidage du cache, les données `localStorage` sont perdues.
- **Autoplay.** Les lecteurs démarrent en `muted` au chargement de la page. Le son est activé automatiquement lors de la sélection d'un nouveau morceau (le clic de sélection compte comme geste utilisateur). Vous pouvez toujours muter/démuter chaque voie à tout moment.

---

## 📜 Licence

Projet personnel/éducatif. À utiliser dans le respect des conditions d'utilisation de YouTube.

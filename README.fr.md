# 🎵 YT Music Web Mixer

Application web **sans serveur** (HTML + JS pur) permettant de charger 2 morceaux YouTube côte à côte (voies **A** et **B**) et de les mixer via un **crossfader** en bas de page.

> ⚠️ Le « mixage » ici est un **crossfade de volumes** : on contrôle le volume relatif de chaque lecteur YouTube. Aucun traitement DSP (EQ, filtres, beatmatch) n'est possible sur le son YouTube — voir [Limites connues](#-limites-connues).

---

## ✨ Fonctionnalités

- **2 voies côte à côte** (A à gauche, B à droite), chacune avec son lecteur YouTube et sa barre de recherche.
- **Recherche YouTube** par mot-clé (clé API YouTube Data optionnelle) **ou** saisie manuelle d'une URL / ID vidéo. Sans clé, l'app reste pleinement utilisable via le fallback URL/ID — la recherche affiche simplement un avertissement non bloquant.
- **Crossfader A↔B** (0 = full A, 100 = full B, 50 = équilibré) avec courbe *equal-power* pour éviter le creux de niveau au milieu.
- **Volume master** global (0–100%).
- **Boutons mute/unmute par voie** (obligatoire pour contourner les politiques d'autoplay des navigateurs).
- **Contrôles de lecture** : *play both* / *pause both*.
- **Sync B → A** : aligner B sur la position de A (ponctuel ou continu).
- **Démutage automatique au changement de vidéo** : la sélection d'un nouveau morceau active le son automatiquement (le clic compte comme geste utilisateur pour les politiques d'autoplay).
- **Affichage séparé des volumes A/B** : la barre de crossfade affiche le pourcentage de volume de chaque voie individuellement.
- **Curseur de crossfade style mixage** : rectangle 15×30px avec curseur `ew-resize`, comme un fader de console matérielle.
- **Persistance** via `localStorage` : clé API, dernières requêtes et derniers videoIds sauvegardés. Les requêtes sont restaurées dans les champs de recherche au reload.
- **Scripts de lancement en un clic** : `start.sh` (macOS/Linux/WSL) et `start.bat` (Windows) démarrent un serveur local sur le port 8000 et ouvrent l'app dans le navigateur par défaut.
- **Responsive** : passe en une colonne sur petit écran.

---

## 🚀 Démarrage

### 1. Ouvrir l'application

Double-cliquez sur `index.html` pour l'ouvrir en `file://`. Les lecteurs YouTube fonctionnent dans ce mode.

### 2. (Recommandé) Servir en local pour la recherche

L'appel `fetch()` vers l'API YouTube Data peut être bloqué en `file://` (notamment sur Chrome). Pour activer la recherche, lancez un serveur statique :

**Option A — Python (intégré)**

```bash
python3 -m http.server 8000
```

**Option B — Node.js (via npx)**

```bash
npx serve -p 8000
```

Puis ouvrez <http://localhost:8000> dans votre navigateur.

**Option C — Script de lancement en un clic**

Démarrez le serveur et ouvrez le navigateur en une seule commande :

- macOS / Linux / WSL : `./start.sh`
- Windows : double-cliquez sur `start.bat` (ou lancez-le dans un terminal)

Le script utilise le serveur intégré de Python et ouvre <http://localhost:8000> automatiquement.

### 3. Créer et configurer une clé API YouTube Data (optionnel)

Une clé est nécessaire uniquement pour la **recherche par mot-clé**. Sa création est gratuite et ne demande aucune connaissance en programmation ; Google applique toutefois un quota quotidien d'utilisation.

1. Ouvrez la [Google Cloud Console](https://console.cloud.google.com/) et connectez-vous avec votre compte Google.
2. Créez un projet : cliquez sur le sélecteur de projet en haut de la page → **Nouveau projet** → donnez-lui un nom, par exemple `YT Music Mixer` → **Créer**. Si un projet est déjà sélectionné, vous pouvez aussi l'utiliser.
3. Dans le menu de gauche, ouvrez **API et services** → **Bibliothèque**. Recherchez **YouTube Data API v3**, ouvrez le résultat, puis cliquez sur **Activer**.
4. Ouvrez **API et services** → **Identifiants** → **Créer des identifiants** → **Clé API**. Google affiche alors une nouvelle clé : cliquez sur l'icône de copie.
5. Revenez dans le mixer, ouvrez ⚙️ **Paramètres**, collez la clé puis enregistrez-la. Vous pouvez maintenant rechercher un morceau par son nom dans les deux voies.

La clé est enregistrée uniquement dans ce navigateur (`localStorage`) et n'est envoyée qu'à Google lors d'une recherche. Ne la partagez pas et ne la publiez jamais dans un dépôt public.

#### Recommandé : restreindre la clé

Dans la Google Cloud Console, ouvrez **API et services** → **Identifiants**, sélectionnez la clé créée, puis choisissez **Restreindre la clé** :

- Sous **Restrictions relatives aux API**, choisissez de restreindre la clé et n'autorisez que **YouTube Data API v3**.
- Si vous hébergez l'application sur un site web, sous **Restrictions liées aux applications**, choisissez **Sites Web** et ajoutez l'adresse de ce site.
- Pour une utilisation locale, ajoutez `http://localhost:8000/*` si vous utilisez le script de lancement fourni ou les commandes ci-dessus. Ajoutez l'adresse et le port exacts que vous utilisez : une restriction ne contenant pas l'adresse ouverte dans le navigateur empêchera la recherche de fonctionner.

> Sans clé, l'app fonctionne toujours : collez une URL YouTube (`youtu.be/...`, `watch?v=...`) ou un ID vidéo brut dans le champ de recherche. La recherche par mot-clé affiche un avertissement non bloquant. Le rate limiting (quota dépassé / 429) est aussi géré proprement — le panneau affiche un avertissement plutôt qu'une erreur, et vous pouvez basculer sur la saisie URL/ID.

#### En cas de problème

- **« Clé API invalide » / 400 :** copiez à nouveau la clé entière, puis vérifiez que **YouTube Data API v3** est activée dans le même projet Google Cloud que cette clé.
- **La recherche échoue après avoir restreint la clé :** vérifiez l'adresse de site Web autorisée. Elle doit correspondre exactement à celle affichée dans le navigateur, y compris `http`/`https` et le port.
- **Quota dépassé / 403 / 429 :** le quota quotidien du projet Google est atteint. Attendez sa réinitialisation, utilisez un autre projet/une autre clé, ou saisissez une URL/ID YouTube.
- **La recherche échoue en ouvrant directement `index.html` :** démarrez le serveur local décrit à l'étape 2, puis utilisez `http://localhost:8000`. Certains navigateurs bloquent les requêtes API depuis les pages `file://`.

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

---

## 🤖 Comment ce projet a été réalisé

Ce projet a été développé grâce à une collaboration entre plusieurs agents de codage et modèles d'IA, sous la direction de l'auteur :

- **[Zed](https://zed.dev)** — l'agent de codage intégré à l'éditeur Zed
- **[claude-code](https://www.npmjs.com/package/@anthropic-ai/claude-code)** — l'assistant de codage en ligne de commande d'Anthropic
- **[wrapper-scionos](https://www.npmjs.com/package/wrapper-scionos)** — un wrapper utilisé pour orchestrer les appels aux différents agents et modèles

Les modèles qui ont alimenté ces agents :

- **GLM-5.2** (Zhipu AI)
- **Kimi-K3** (Moonshot AI)
- **MiniMax M3** (MiniMax)

Tous les agents et modèles ont été pilotés et coordonnés par l'auteur, qui a défini l'architecture, révisé les résultats et assemblé le code final.

---

## 🙏 Remerciements

Merci à **[RouterLab.ch](https://routerlab.ch/)** pour l'accès aux différents modèles utilisés dans ce projet.

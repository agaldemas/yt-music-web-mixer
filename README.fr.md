# 🎵 YT Music Web Mixer

Application web en HTML + JS pur permettant de charger 2 morceaux YouTube côte à côte (voies **A** et **B**) et de les mixer via un **crossfader** en bas de page.

L'utilisation recommandée passe par le serveur Express local et `yt-dlp` : le serveur extrait et relaie le flux audio, ce qui permet au lecteur d'utiliser le **mode DJ** avec les traitements Web Audio. Un fallback IFrame reste disponible lorsque l'extraction audio est indisponible.

> ⚠️ En **mode IFrame**, le mixage est uniquement un **crossfade de volumes**. En **mode DJ**, le flux audio extrait peut être traité par la Web Audio API (EQ, filtres, analyse et fonctions liées au tempo).

---

## ✨ Fonctionnalités

- **2 voies côte à côte** (A à gauche, B à droite), chacune avec son lecteur et sa barre de recherche.
- **Mode DJ** : backend Express local + extraction `yt-dlp`, relais audio same-origin et traitements Web Audio pour le vrai crossfade audio, l'EQ, les filtres et l'analyse. Si le backend local est indisponible, le lecteur peut utiliser les flux audio des instances Piped lorsque le CORS le permet.
- **Recherche YouTube** par mot-clé **sans clé API** grâce à l'API publique [Piped](https://docs.piped.video/) (frontend YouTube alternatif, CORS activé, pas de quota Google). Plusieurs instances Piped sont essayées en cascade pour la fiabilité. Une clé API YouTube Data reste optionnelle pour des résultats plus pertinents et la pagination officielle. Saisie manuelle d'une URL / ID vidéo également possible.
- **Bouton de bascule de mode de recherche** : quand une clé API est configurée, un bouton 🟢/⚪ permet de forcer la recherche via Piped (préserve le quota Google) ou de revenir à l'API YouTube Data officielle. Le choix est persisté en `localStorage`.
- **Crossfader A↔B** (0 = full A, 100 = full B, 50 = équilibré) avec courbe *equal-power* pour éviter le creux de niveau au milieu.
- **Volume master** global (0–100%).
- **Boutons mute/unmute par voie** (obligatoire pour contourner les politiques d'autoplay des navigateurs).
- **Contrôles de lecture** : *play both* / *pause both*.
- **Sync B → A** : aligner B sur la position de A (ponctuel ou continu).
- **Démutage automatique au changement de vidéo** : la sélection d'un nouveau morceau active le son automatiquement (le clic compte comme geste utilisateur pour les politiques d'autoplay).
- **Affichage séparé des volumes A/B** : la barre de crossfade affiche le pourcentage de volume de chaque voie individuellement.
- **Curseur de crossfade style mixage** : rectangle 15×30px avec curseur `ew-resize`, comme un fader de console matérielle.
- **Persistance** via `localStorage` : clé API, dernières requêtes et derniers videoIds sauvegardés. Les requêtes sont restaurées dans les champs de recherche au reload.
- **Scripts de lancement en un clic** : `start.sh` (macOS/Linux/WSL) et `start.bat` (Windows) démarrent le serveur Express local sur le port 5400 et ouvrent l'app dans le navigateur par défaut.
- **Responsive** : passe en une colonne sur petit écran.

---

## 🚀 Démarrage

### 1. Ouvrir l'application

Double-cliquez sur `index.html` pour l'ouvrir en `file://`. Les lecteurs YouTube fonctionnent dans ce mode.

### 2. (Recommandé) Démarrer le serveur Express local

Le serveur Express est la manière recommandée d'utiliser l'application. Il sert le frontend et fournit l'extraction locale `yt-dlp` nécessaire au **mode DJ**. Installez Node.js, exécutez `npm install`, vérifiez que `yt-dlp` est installé, puis lancez :

```bash
npm install
npm start
```

Ouvrez ensuite <http://localhost:5400> dans votre navigateur. Sans `yt-dlp`, le frontend reste accessible, mais le mode DJ retombe sur Piped/IFrame.

Pour la recherche uniquement, un serveur statique reste possible. L'appel `fetch()` vers l'API YouTube Data peut être bloqué en `file://` (notamment sur Chrome) :

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

Les scripts démarrent le serveur Express et ouvrent automatiquement <http://localhost:5400>.

### 3. Créer et configurer une clé API YouTube Data (optionnel)

La recherche par mot-clé fonctionne **même sans clé** grâce à l'API publique Piped. Une clé API YouTube Data reste **optionnelle** : elle offre des résultats plus pertinents pour la musique, la pagination officielle, et évite la dépendance aux instances Piped (parfois lentes ou indisponibles). Sa création est gratuite et ne demande aucune connaissance en programmation ; Google applique toutefois un quota quotidien d'utilisation.

1. Ouvrez la [Google Cloud Console](https://console.cloud.google.com/) et connectez-vous avec votre compte Google.
2. Créez un projet : cliquez sur le sélecteur de projet en haut de la page → **Nouveau projet** → donnez-lui un nom, par exemple `YT Music Mixer` → **Créer**. Si un projet est déjà sélectionné, vous pouvez aussi l'utiliser.
3. Dans le menu de gauche, ouvrez **API et services** → **Bibliothèque**. Recherchez **YouTube Data API v3**, ouvrez le résultat, puis cliquez sur **Activer**.
4. Ouvrez **API et services** → **Identifiants** → **Créer des identifiants** → **Clé API**. Google affiche alors une nouvelle clé : cliquez sur l'icône de copie.
5. Revenez dans le mixer, ouvrez ⚙️ **Paramètres**, collez la clé puis enregistrez-la. Vous pouvez maintenant rechercher un morceau/artiste par son nom dans les deux voies.

La clé est enregistrée uniquement dans ce navigateur (`localStorage`) et n'est envoyée qu'à Google lors d'une recherche. Ne la partagez pas et ne la publiez jamais dans un dépôt public.

#### Recommandé : restreindre la clé

Dans la Google Cloud Console, ouvrez **API et services** → **Identifiants**, sélectionnez la clé créée, puis choisissez **Restreindre la clé** :

- Sous **Restrictions relatives aux API**, choisissez de restreindre la clé et n'autorisez que **YouTube Data API v3**.
- Si vous hébergez l'application sur un site web, sous **Restrictions liées aux applications**, choisissez **Sites Web** et ajoutez l'adresse de ce site.
- Pour une utilisation locale, ajoutez `http://localhost:5400/*` si vous utilisez le script de lancement fourni ou le serveur Express. Ajoutez l'adresse et le port exacts que vous utilisez : une restriction ne contenant pas l'adresse ouverte dans le navigateur empêchera la recherche de fonctionner.

> Sans clé, l'app fonctionne entièrement : la recherche par mot-clé utilise automatiquement l'API publique Piped (pas de quota Google), et vous pouvez aussi coller une URL YouTube (`youtu.be/...`, `watch?v=...`) ou un ID vidéo brut. Le rate limiting de l'API officielle (quota dépassé / 429) est aussi géré proprement — le panneau affiche un avertissement plutôt qu'une erreur, et vous pouvez basculer sur la saisie URL/ID.
>
> ⚠️ **Fiabilité de Piped** : les instances publiques Piped peuvent être lentes ou indisponibles (elles changent souvent). L'app en essaie plusieurs en cascade, mais si toutes échouent, la recherche ne renvoie rien. Dans ce cas, utilisez une clé API YouTube Data ou collez une URL/ID directement.

#### En cas de problème

- **« Clé API invalide » / 400 :** copiez à nouveau la clé entière, puis vérifiez que **YouTube Data API v3** est activée dans le même projet Google Cloud que cette clé.
- **La recherche échoue après avoir restreint la clé :** vérifiez l'adresse de site Web autorisée. Elle doit correspondre exactement à celle affichée dans le navigateur, y compris `http`/`https` et le port.
- **Quota dépassé / 403 / 429 :** le quota quotidien du projet Google est atteint. Attendez sa réinitialisation, utilisez un autre projet/une autre clé, ou saisissez une URL/ID YouTube.
- **La recherche échoue en ouvrant directement `index.html` :** démarrez le serveur local décrit à l'étape 2, puis utilisez `http://localhost:8000`. Certains navigateurs bloquent les requêtes API depuis les pages `file://`.
- **Piped ne renvoie rien (sans clé API) :** les instances publiques Piped peuvent être toutes indisponibles. Configurez une clé API YouTube Data (étape 3) ou collez directement une URL/ID vidéo.

---

## 🗂️ Architecture

```
yt-music-web-mixer/
├── CLAUDE.md            # Guide des agents (cahier des charges)
├── README.md            # ce fichier
├── index.html           # structure : header, zone A | B, barre de mixage
├── server/
│   └── server.js        # serveur Express, extraction yt-dlp et relais audio same-origin
├── css/
│   └── styles.css       # layout grille 2 colonnes + barre fixe + contrôles DJ
└── js/
    ├── config.js        # constantes, clé API et configuration lecteur
    ├── youtube.js       # wrapper YouTube IFrame API (fallback IFrame)
    ├── piped-streams.js # backend local prioritaire, fallback flux Piped, cache et refresh
    ├── audio-player.js  # lecteur audio du mode DJ
    ├── audio-engine.js  # graphe Web Audio : source, EQ, filtre, gain et analyseur
    ├── search.js        # recherche YouTube Data API + Piped (sans clé) + affichage résultats
    ├── mixer.js         # crossfade (GainNode en mode DJ, volume en mode IFrame)
    └── app.js           # bootstrap, câblage événements, modes et état global
```

**Stack** : frontend HTML + CSS + JS vanilla, avec un serveur local Node/Express optionnel. Aucun bundler ni framework frontend. `file://` convient au lecteur IFrame de base ; `http://localhost:5400` est recommandé pour la recherche, l'extraction locale et le mode DJ.

---

## 🎛️ Utilisation

1. Démarrez le serveur Express pour l'expérience complète, puis dans la **voie A**, recherchez ou collez un morceau → sélectionnez-le → il se charge dans le lecteur A (le son est activé automatiquement).
2. Faites de même pour la **voie B**.
3. (Optionnel) Basculez **🔇 / 🔊** sur une voie pour muter/démuter individuellement.
4. Lancez la lecture (**▶️ Play both**).
5. Bougez le **crossfader** pour passer progressivement de A à B. En mode DJ, il utilise les gains Web Audio ; en mode IFrame, il contrôle le volume des lecteurs.
6. Ajustez le **volume master** si besoin.
7. Optionnel : **Sync B → A** pour aligner B sur la position de A.

---

## ⚠️ Limites connues

- **Limites du mode IFrame.** L'API IFrame YouTube ne donne pas accès au flux audio (cross-origin, pas de CORS). Le mixage se fait **uniquement par contrôle du volume** (`setVolume`) ; l'EQ, les filtres et le tempo sync automatique sont indisponibles.
- **Le mode DJ nécessite le backend local ou un fallback Piped utilisable.** Le serveur Express utilise `yt-dlp` et relaie l'audio en same-origin via `/api/audio/:id`. Si `yt-dlp` est absent ou l'extraction échoue, le lecteur essaie les flux audio Piped ; si cela échoue aussi, il retombe en mode IFrame.
- **Le mode DJ est audio-only.** Le chemin extraction/DSP n'affiche pas la vidéo YouTube ; utilisez le mode IFrame si la vidéo est nécessaire.
- **Lourdeur de la double lecture.** La lecture simultanée de 2 voies peut être lourde (CPU, RAM, réseau). Recommandations :
  - Fermez les autres onglets lourds.
  - Sur machine modeste, préférez une seule voie à la fois.
  - Si la lecture saccade, réduisez la qualité côté YouTube (non contrôlable par l'app).
- **Quotas API YouTube Data.** 10 000 unités/jour par défaut, une recherche = 100 unités. Au-delà, la recherche officielle est bloquée jusqu'au lendemain. Le **mode de recherche Piped** sans clé n'utilise pas ce quota Google, mais les instances Piped publiques peuvent être indisponibles.
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

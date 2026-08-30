# 📋 Plan d'Implémentation : Fix Téléchargements Longs, Moniteur de Progression & Paramètres Serveur

> **Modèle cible / Orchestration :** `mitcheffendi/qwen3.5-hermes-discipline-96k:latest` (Provider : `ollama` local sous Hermes).  
> **Fenêtre de contexte :** 96 000 tokens.  
> **Contrainte d'exécution & Concurrence Ollama :** 
> - **Mode d'exécution actuel recommandé : SÉQUENTIEL (1 tâche à la fois)** en raison de la latence importante d'inférence locale (surtout au démarrage à froid / cold start).
> - **Plafond de parallélisation strict : 2 sessions maximum** si parallélisé (1 sous-session dédiée au côté Serveur / Backend, et 1 sous-session dédiée au côté Client / Frontend). Ne jamais dépasser 2 sessions concurrentes sur le serveur Ollama local pour éviter la saturation VRAM / timeout.

---

## 🤖 Directives d'Exécution Spécifiques au Modèle (96k Tokens Context Budget)

Ce plan est calibré pour être exécuté soit **directement en mode séquentiel par une session utilisant `mitcheffendi/qwen3.5-hermes-discipline-96k:latest`**, soit **piloté par sous-sessions séquentielles (ou max 2 concurrentes)** via `delegate_task`.

### ⚠️ Règles de discipline de contexte & gestion de latence :
1. **Économie de tokens & Lecture ciblée :**
   - **JAMAIS** de lecture complète de gros fichiers. Utiliser systématiquement `read_file(path=..., offset=..., limit=50)`.
   - Ne pas lancer de recherches récursives larges.
2. **Atomicité des tâches (1 tâche = 1 action = 1 vérification) :**
   - Traiter **UNE SEULE sous-tâche** par tour en mode séquentiel.
   - Ne pas tenter d'implémenter le backend et le frontend en un seul coup.
3. **Gestion de la latence Ollama (Cold Start) :**
   - Laisser le temps à la sous-session de charger le modèle sans multiplier les requêtes concurrentes.
4. **Modifications chirurgicales :**
   - Utiliser `patch(mode='replace')` avec un `old_string` court et unique.
   - Vérifier immédiatement la syntaxe ou exécuter le test ciblé de la tâche avant de passer à la suite.
5. **Mise à jour d'état locale :**
   - Cocher `[x]` sur la tâche complétée dans ce fichier `fix-download-monitor.md` dès validation.

---

## 🛠️ Modèle de Délégation par Sous-Session (Séquentiel / Max 2 concurrents)

Pour déléguer chaque sous-tâche à une sous-session autonome sur le modèle Ollama local :

```python
delegate_task(
  goal="Exécuter la Task X.Y du fichier fix-download-monitor.md",
  context="""
  Projet : yt-music-web-mixer (Vanilla JS + Express Node.js).
  Modèle : mitcheffendi/qwen3.5-hermes-discipline-96k:latest (ollama local).
  Mode : Séquentiel (1 tâche à la fois).
  Consignes :
  - Lire uniquement les lignes ciblées du fichier avec read_file.
  - Appliquer le patch minimal avec patch(mode='replace').
  - Valider avec la commande de test fournie.
  - Cocher [x] dans fix-download-monitor.md.
  """
)
```

---

## 🎯 Architecture & Invariants de Sécurité

1. **Serveur local (`server/server.js`)** :
   - Écoute sur `127.0.0.1`.
   - Middleware `requireLocalToken` protégeant les routes `/api/audio/*`, `/api/download/*`, `/api/config` via le header HTTP `X-Local-Token`.
   - Augmentation des limites par défaut : `MAX_TRACK_DURATION_SEC = 14400` (4h) et `YTDLP_BIN_TIMEOUT_MS = 600000` (10 min).
   - Nouveaux endpoints : `GET /api/config` et `POST /api/config`.

2. **Frontend Audio (`js/audio-player.js`, `js/deck-controls.js`)** :
   - Remplacement du fetch monolithique par un `ReadableStream` (`res.body.getReader()`).
   - Calcul de la progression en pourcentage (`loaded / total`) et affichage dans `.np-title-text`.
   - Affichage immédiat des erreurs HTTP (422, 451, 502, etc.) en rouge avec la classe CSS `.np-title-error`.

3. **UI Modale Paramètres (`index.html`, `js/app.js`, `css/styles.css`)** :
   - Deux onglets : **Client** (existant) et **Serveur** (nouveau).
   - Formulaire Serveur : `MAX_TRACK_DURATION_SEC`, `YTDLP_BIN_TIMEOUT_MS`, `SCRATCH_MAX_DURATION_SEC` avec tooltips explicatifs.
   - Appels sécurisés via `window.LocalAPI.fetch()` (qui injecte automatiquement `X-Local-Token`).

---

## 📋 Tâches d'Exécution pas-à-pas (Bite-Sized)

---

### 🟢 Phase 1 : Backend Server & Endpoints Sécurisés

#### Task 1.1 : Assouplir les constantes de durée et timeout par défaut
- **Fichier cible :** `server/server.js` (lignes 63–68)
- **Action :**
  Rendre mutables et augmenter les limites par défaut :
  ```javascript
  let YTDLP_BIN_TIMEOUT_MS = Math.max(10000, Number(process.env.YTDLP_BIN_TIMEOUT_MS) || 600000); // 10 min
  let MAX_TRACK_DURATION_SEC = Math.max(60, Number(process.env.MAX_TRACK_DURATION_SEC) || 14400); // 4h
  let SCRATCH_MAX_DURATION_SEC = Math.max(60, Number(process.env.SCRATCH_MAX_DURATION_SEC) || 600); // 10 min
  ```
- **Vérification :** `node tests/test_server.js`
- [x] Task 1.1 terminée

---

#### Task 1.2 : Ajouter les routes `GET /api/config` et `POST /api/config` avec protection `X-Local-Token`
- **Fichier cible :** `server/server.js` (vers la ligne 840, sous `/api/health`)
- **Action :**
  Ajouter les gestionnaires d'API :
  ```javascript
  app.get('/api/config', (req, res) => {
    res.json({
      maxTrackDurationSec: MAX_TRACK_DURATION_SEC,
      ytdlpBinTimeoutMs: YTDLP_BIN_TIMEOUT_MS,
      scratchMaxDurationSec: SCRATCH_MAX_DURATION_SEC,
      cookiesBrowser: YTDLP_COOKIES_BROWSER
    });
  });

  app.post('/api/config', express.json(), (req, res) => {
    const body = req.body || {};
    if (typeof body.maxTrackDurationSec === 'number') {
      MAX_TRACK_DURATION_SEC = Math.max(60, Math.min(86400, body.maxTrackDurationSec));
    }
    if (typeof body.ytdlpBinTimeoutMs === 'number') {
      YTDLP_BIN_TIMEOUT_MS = Math.max(10000, Math.min(3600000, body.ytdlpBinTimeoutMs));
    }
    if (typeof body.scratchMaxDurationSec === 'number') {
      SCRATCH_MAX_DURATION_SEC = Math.max(60, Math.min(7200, body.scratchMaxDurationSec));
    }
    res.json({
      ok: true,
      maxTrackDurationSec: MAX_TRACK_DURATION_SEC,
      ytdlpBinTimeoutMs: YTDLP_BIN_TIMEOUT_MS,
      scratchMaxDurationSec: SCRATCH_MAX_DURATION_SEC
    });
  });
  ```
  *(Note : la protection `requireLocalToken` sur `/api` s'applique automatiquement).*
- **Vérification :** `node tests/test_server.js`
- [x] Task 1.2 terminée

---

### 🟢 Phase 2 : Frontend Audio — Streaming, Progression & Erreurs

#### Task 2.1 : Lecture en streaming avec `ReadableStream` et notification de progression
- **Fichier cible :** `js/audio-player.js` (fonction `loadDeckArrayBuffer`, lignes ~289-327)
- **Action :**
  - Consommer la réponse via `res.body.getReader()`.
  - Calculer la progression `loaded / total` et notifier `window.DeckTransport.setDownloadProgress(deckId, percent, loaded, total)` avec un throttling à **1 fois par seconde (1000ms)** pour éviter les re-renders excessifs du DOM.
  - En cas d'erreur HTTP (`!res.ok`), lire le corps JSON d'erreur et appeler `window.DeckTransport.setDownloadError(deckId, err.message)`.
- **Vérification :** `node tests/test_audio_player.js`
- [x] Task 2.1 terminée

---

#### Task 2.2 : Affichage du statut et styles d'erreur dans `DeckTransport`
- **Fichiers cibles :** `js/deck-controls.js` (lignes ~238-297) et `css/styles.css`
- **Action :**
  - Implémenter dans `DeckTransport` les méthodes :
    * `setDownloadProgress(deck, percent, loaded, total)` : met à jour le texte du titre avec `⏳ Téléchargement… XX%`.
    * `setDownloadError(deck, msg)` : affiche `⚠️ [Erreur] msg` et ajoute la classe CSS `.np-title-error`.
    * `clearDownloadStatus(deck)` : retire la classe d'erreur et rétablit l'état normal.
  - Ajouter dans `css/styles.css` :
    ```css
    .np-title-text.np-title-error {
      color: #ff4d4d !important;
      font-weight: 600;
    }
    ```
- **Vérification :** `npm run check:syntax`
- [x] Task 2.2 terminée

---

### 🟢 Phase 3 : Modale Paramètres — Onglets Client / Serveur & Tooltips

#### Task 3.1 : Structure HTML des Onglets Client & Serveur
- **Fichier cible :** `index.html` (dans `#settings-modal .modal-content`, lignes ~30-110)
- **Action :**
  - Insérer les boutons d'onglets `.modal-tabs` (Client / Serveur).
  - Regrouper les paramètres client existants dans `<div id="tab-client" class="modal-tab-pane active">`.
  - Ajouter le panneau `<div id="tab-server" class="modal-tab-pane" hidden>` avec les 3 champs (`MAX_TRACK_DURATION_SEC`, `YTDLP_BIN_TIMEOUT_MS`, `SCRATCH_MAX_DURATION_SEC`), leurs tooltips explicatifs, le bouton de sauvegarde et la zone de statut.
- **Vérification :** `npm run check:syntax`
- [x] Task 3.1 terminée

---

#### Task 3.2 : Styles CSS des Onglets et Tooltips
- **Fichier cible :** `css/styles.css`
- **Action :**
  - Styliser `.modal-tabs`, `.modal-tab-btn`, `.modal-tab-pane`.
  - Styliser les infobulles `.tooltip-icon` et `.tooltip-box` au survol / focus.
- **Vérification :** `npm run check:syntax`
- [x] Task 3.2 terminée

---

#### Task 3.3 : Logique JS des Onglets et Enregistrement API
- **Fichier cible :** `js/app.js` (gestion des paramètres)
- **Action :**
  - Gérer l'alternance d'affichage entre `#tab-client` et `#tab-server`.
  - À l'ouverture de l'onglet Serveur : charger la configuration via `window.LocalAPI.fetch('/api/config')` (avec transmission automatique de `X-Local-Token`).
  - Au clic sur enregistrer : envoyer un `POST /api/config` et afficher la confirmation.
- **Vérification :** `npm run check:syntax`
- [x] Task 3.3 terminée

---

### 🟢 Phase 4 : Tests Globaux & Validation

#### Task 4.1 : Enrichir `tests/test_server.js` pour valider `X-Local-Token` et `/api/config`
- **Fichier cible :** `tests/test_server.js`
- **Action :**
  - Ajouter les assertions vérifiant que `/api/config` sans token renvoie `403`.
  - Ajouter les assertions vérifiant qu'avec token, `GET` et `POST` fonctionnent et mettent à jour les bornes.
- **Vérification :** `npm test`
- [x] Task 4.1 terminée

---

## 📌 Résumé de Commande pour le Modèle / Subagent

```bash
# Pour vérifier la syntaxe après une modification :
npm run check:syntax

# Pour exécuter les tests ciblés :
node tests/test_server.js
node tests/test_audio_player.js

# Pour exécuter la suite complète :
npm test
```

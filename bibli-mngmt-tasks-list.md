# 🎵 YT Music Web Mixer — Bibliothèque locale & sauvegarde MP3

## Légende

- `[ ]` À faire
- `[~]` En cours
- `[x]` Terminé
- `[!]` Décision ou validation nécessaire

---

## Objectif

Ajouter à l'application et au serveur local deux fonctionnalités simples et distinctes :

1. **Lire des fichiers audio/vidéo locaux** dans les decks du mixer.
2. **Sauvegarder localement le morceau en cours de lecture** sur le disque de l'utilisateur, via le dialogue de sauvegarde du navigateur.

**Phasage** : on commence par la sauvegarde en **mode DJ uniquement** (l'audio est déjà extrait et mis en cache par `yt-dlp` → simple téléchargement). La sauvegarde en **mode YouTube (IFrame)** viendra dans un second temps (extraction + conversion à la demande).

Le navigateur ne doit jamais choisir ou écrire silencieusement un chemin sur le disque.

## Flux cible

### Mode DJ (Audio / DSP) — immédiat
```text
Résultat YouTube sélectionné
        │
        ├── Charger : /api/streams/:videoId → /api/audio/:videoId → AudioPlayer
        │              (yt-dlp -x + ffmpeg → cache disque cache/audio/<id>.mp3)
        │
        └── Sauvegarder : bouton "Save local" dans le deck
              │
              ▼
        /api/download/:id (nouveau)
        - sert le MP3 déjà en cache → Content-Disposition: attachment
        - nom de fichier = titre YouTube nettoyé + .mp3
              │
              ▼
        dialogue Save File du navigateur
        → l'utilisateur choisit le nom et l'emplacement
```

### Mode YouTube (IFrame) — ultérieur
```text
Résultat YouTube sélectionné
        │
        ├── Charger : IFrame Player (vidéo YouTube)
        │
        └── Sauvegarder en MP3
              │
              ▼
        serveur yt-dlp + ffmpeg (extraction à la demande)
        - extraction audio uniquement
        - conversion MP3 + écriture des tags
              │
              ▼
        réponse audio/mpeg
              │
              ▼
        dialogue Save File du navigateur
        → l'utilisateur choisit le nom et l'emplacement
```

## Principes à respecter

- [x] La sauvegarde ne concerne que la piste audio : aucune piste vidéo ne doit être écrite dans le fichier final.
- [x] **Mode DJ** : le MP3 est déjà extrait et caché sur disque par `yt-dlp` (`cache/audio/<id>.mp3`). La sauvegarde est un simple téléchargement de ce fichier — pas de nouvelle extraction, pas de re-conversion. Les métadonnées YouTube (title, artist/uploader, date, genre…) sont embarquées durant l'extraction (`--embed-metadata`). La pochette YouTube est téléchargée puis ajoutée au MP3 par `ffmpeg` (APIC/ID3) en post-traitement serveur — pas de reliance sur `--embed-thumbnail` de yt-dlp.
- [ ] **Mode YouTube (ultérieur)** : le serveur utilise `yt-dlp` pour récupérer la source et `ffmpeg` pour convertir en MP3 et écrire les métadonnées.
- [ ] Le MP3 n'est pas conservé au-delà de la lecture/du téléchargement : usage du cache disque déjà en place, pas de bibliothèque permanente côté serveur.
- [ ] Le frontend utilise le mécanisme standard de sauvegarde du navigateur (`showSaveFilePicker` quand disponible, avec téléchargement navigateur classique en fallback).
- [ ] Le chemin final est toujours choisi par l'utilisateur; aucun chemin local ne doit être envoyé au serveur.
- [ ] La lecture locale reste dans le navigateur et les fichiers locaux ne sont jamais envoyés au serveur.
- [ ] Les sources locales et YouTube réutilisent le même `AudioPlayer` et le même graphe Web Audio par deck.
- [ ] La bibliothèque locale est un index des fichiers auxquels l'utilisateur a explicitement donné accès, pas un explorateur de disque automatique.

---

## 1. Backend — sauvegarde locale `[~]`

## ⭐ Phase 1 — Mode DJ (Audio / DSP) : prioritaire `[x]`

> **Cas YouTube en mode DJ** : l'audio est déjà sur disque côté serveur (`cache/audio/<id>.mp3`). Le serveur le sert en téléchargement.
> **Cas fichier local (`playerType === 'local'`)** : aucun serveur impliqué — le fichier est déjà sur le disque de l'utilisateur, le bouton « Save local » est désactivé (rien à sauver, voir §2.2).

### 1.1 Endpoint de sauvegarde (Mode DJ, source YouTube uniquement) `[x]`

- [x] Ajouter une route `GET /api/download/:id` qui sert le MP3 déjà en cache.
- [x] Valider strictement l'identifiant YouTube (`RE_VIDEOID`) avant toute opération.
- [x] Si le fichier n'est pas encore en cache, déclencher `extractAudio(id)` (pipeline existant `yt-dlp -x + ffmpeg`), puis le servir une fois prêt. Réutiliser la fonction existante.
- [x] Répondre avec `Content-Type: audio/mpeg` et `Content-Disposition: attachment; filename="<titre nettoyé>.mp3"` (header ASCII + `filename*=UTF-8''` pour les accents).
- [x] Construire le nom de fichier par défaut à partir du titre YouTube (`fetchMeta` existant), nettoyé (caractères interdits, accents conservés), extension `.mp3`.
- [x] En cas de contenu non-MP3 dans le cache (m4a/opus), conserver l'extension réelle du fichier servi (`mimeForExt`/`extOf` existants).
- [x] Ne pas demander au serveur un chemin de sauvegarde : il ne fait que produire et envoyer le fichier.
- [x] Gérer les erreurs simples : id invalide (400), ant-bot (451), vidéo indisponible (404), ffmpeg absent (503), extraction échouée (502).
- [x] Pas de nettoyage de fichier : le cache disque est déjà persistant (comportement existant). Le fichier n'est pas créé spécialement pour la sauvegarde.
- [x] Récupérer le titre via oEmbed (`fetchMeta`) est déjà fait par `/api/streams/:id`; réutiliser ce flux pour éviter un appel yt-dlp supplémentaire.
- [x] **Métadonnées + pochette** : `--embed-metadata` dans `extractAudio` (title, artist/uploader, date, genre…) ; pochette YouTube ajoutée en post-traitement par `embedThumbnail()` (téléchargement `i.ytimg.com/vi/<id>/hqdefault.jpg` + ffmpeg → APIC/ID3). `settleExtracted()` enchaîne l'embed avant de résoudre.

### 1.2 Mode DJ — limites `[x]`

- [x] La sauvegarde DJ n'est possible que si le backend local est actif (HTTP) et si `yt-dlp`/`ffmpeg` ont pu extraire l'audio.
- [x] En fallback Piped ou IFrame, pas d'audio MP3 local → le bouton "Save local" doit être désactivé/absent (voir §2.2).
- [x] Rafraîchissement de la disponibilité du bouton selon `state.playerType[deck]` (`'piped'` = backend local → sauvegardable; `'local'` = fichier déjà local → pas besoin de sauver; `'iframe'` = YouTube IFrame → phase 2 / non disponible en phase 1).
- [x] Avertissement : les MP3 présents dans le cache avant l'ajout des tags n'ont pas la pochette/métadonnées — vidanger `cache/audio/` pour régénérer.

## ⭐ Phase 2 — Mode YouTube (IFrame) : ultérieur

> Pas d'audio extrait côté client. Extraction + conversion à la demande.

### 1.3 Endpoint de sauvegarde (Mode YouTube) `[ ]`

- [ ] Réutiliser la route `/api/download/:id?format=mp3` (ou une variante) pour déclencher `yt-dlp -x + ffmpeg` à la demande, sans cache obligatoire.
- [ ] Utiliser `yt-dlp` avec un format audio uniquement (`ba` ou équivalent); ne jamais télécharger la vidéo pour la sauvegarde finale.
- [ ] Convertir le flux en MP3 avec `ffmpeg`.
- [ ] Renvoyer directement le résultat au navigateur avec `Content-Type: audio/mpeg`.
- [ ] Supprimer tout fichier temporaire après l'envoi ou en cas d'erreur.
- [ ] Arrêter proprement `yt-dlp`/`ffmpeg` si le navigateur annule la requête.
- [ ] Ajouter un timeout et des messages d'erreur simples : `yt-dlp` absent, `ffmpeg` absent, vidéo indisponible, anti-bot, conversion échouée.

### 1.4 Métadonnées MP3 (Mode YouTube) `[ ]`

- [ ] Extraire les métadonnées depuis la réponse `yt-dlp` :
  - `title` → titre (`title`);
  - `uploader` ou `channel` → artiste (`artist`);
  - `album` si disponible;
  - `release_date` ou `upload_date` → année/date si disponible;
  - `genre` si disponible;
  - miniature YouTube si son intégration dans les tags est retenue.
- [ ] Passer ces valeurs à `ffmpeg` lors de la conversion (`-metadata title=...`, `artist=...`, etc.).
- [ ] Échapper correctement les valeurs de métadonnées et ne jamais les concaténer dans une commande shell non contrôlée.
- [ ] Définir un comportement pour les champs absents : laisser le tag vide, sans inventer de valeur.
- [ ] Décider si la miniature doit être embarquée comme pochette MP3; si oui, la télécharger côté serveur, l'ajouter avec `ffmpeg`, puis supprimer le temporaire.
- [ ] Tester la lecture des tags dans un lecteur externe et vérifier les caractères accentués.

### 1.5 Santé et configuration `[ ]`

- [ ] Étendre `/api/health` pour indiquer si `yt-dlp`, `ffmpeg` et la sauvegarde MP3 sont disponibles.
- [ ] Afficher une erreur claire et désactiver le bouton si `ffmpeg` manque, tout en laissant la lecture audio fonctionner.
- [ ] Documenter l'installation de `ffmpeg` dans `README.md`, `README.fr.md`, `start.sh` et `start.bat`.
- [ ] Garder `/api/streams/:id` et `/api/audio/:id` compatibles avec le fonctionnement actuel du player.

---

## 2. Frontend — bouton de sauvegarde dans chaque deck `[~]`

## ⭐ Phase 1 — Mode DJ : bouton "Save local" `[x]`

### 2.1 Placement du bouton dans le DOM `[x]`

- [x] Dans chaque deck, la rangée `.deck-local-row` contient déjà un bouton de chargement `#deck-load-local-a` (deck A) et `#deck-load-local-b` (deck B), renommé `📁 Fichier local` → **`📁 Load local`**.
- [x] Ajouter un bouton `#deck-save-local-a` **à droite de `#deck-load-local-a`**, dans le même `.deck-local-row`.
- [x] Ajouter un bouton `#deck-save-local-b` **à droite de `#deck-load-local-b`**, dans le même `.deck-local-row`.
- [x] Libellé du bouton : `💾 Save local`, disable par défaut.
- [x] CSS : classe `.deck-local-btn` (remplace `.deck-load-local-btn`), `gap` dans `.deck-local-row`, état `:disabled:hover` pour un rendu cohérent.

> Structure cible (deck A, idem B) :
> ```html
> <div class="deck-local-row">
>   <button id="deck-load-local-a" ...>📁 Load local</button>
>   <button id="deck-save-local-a" ...>💾 Save local</button>
> </div>
> ```

### 2.2 États du bouton "Save local" selon le mode `[x]`

- [x] **Mode DJ (`state.playerType[deck] === 'piped'` + backend local actif)** : bouton **actif** si un `videoId` est chargé (`state.videoIds[deck]` non vide). Le bouton déclenche la sauvegarde du MP3 courant.
- [x] **Source locale (`state.playerType[deck] === 'local'`)** : bouton **désactivé** — le fichier est déjà sur le disque de l'utilisateur, rien à sauver, **aucun appel serveur** (aucune requête vers `/api/download/:id`).
- [x] **Mode YouTube IFrame (`state.playerType[deck] === 'iframe'`)** : bouton **désactivé avec état clair** (« disponible en mode DJ » ou outil `title`).
- [x] **Fallback Piped / aucun backend local / IFRAME non disponible** : bouton désactivé.
- [x] Désactiver le bouton pendant la demande (éviter les doubles téléchargements) et le réactiver à la fin/erreur.
- [x] Afficher un état simple : préparation, téléchargement, sauvegarde terminée ou erreur (via `console.warn`/`console.debug` + désactivation).

### 2.3 Module `js/local-save.js` — Phase 1 `[x]`

- [x] Créer un petit module vanilla `window.LocalSave` avec les fonctions suivantes.
- [x] Fonction utilitaire **`buildSaveFilename(title, artist)`** — partagée entre les modes DJ et YouTube :
  - Prend un titre et un artiste, nettoie les caractères interdits en nom de fichier (`/ \ : * ? " < > |`), tronque si > 200 caractères.
  - Format : `"<titre>-<artiste>.mp3"` (si `artist` est vide → `"<titre>.mp3"`).
  - Les accents et caractères Unicode sont conservés (le système de fichiers de l'utilisateur les accepte).
  - Peut être appelée indépendamment de la sauvegarde elle-même.
- [x] Fonction **`saveCurrentDj(deck)`** pour le mode DJ.
- [x] Utiliser `window.showSaveFilePicker()` lorsque l'API est disponible, avec :
  - nom proposé basé sur le titre YouTube (`videoTitle` récupéré via `PipedStreams.getCachedStream(videoId)` ou `fetchMeta`);
  - type `audio/mpeg`;
  - extension `.mp3`.
- [x] Récupérer `/api/download/:id` et écrire la réponse dans le fichier choisi par l'utilisateur.
- [x] Ne jamais stocker le MP3 dans `localStorage`, IndexedDB ou un répertoire serveur.
- [x] Si `showSaveFilePicker` n'est pas disponible, utiliser le téléchargement standard du navigateur : lien `<a download>` pointant vers `/api/download/:id` (le serveur propose le nom de fichier).
- [x] Gérer les cas `Annuler` du dialogue (`AbortError`), erreur HTTP, serveur indisponible et téléchargement interrompu.
- [x] **Branchement** : `updateSaveButtonState(deck)` appelé depuis `app.js` → `updateNowPlaying(deck)` à chaque changement d'état.

> Le dialogue de choix du fichier doit rester l'action de l'utilisateur. Le plan ne prévoit pas de choisir automatiquement un dossier ni de demander un chemin au serveur.

## ⭐ Phase 2 — Mode YouTube : sauvegarde complète (ultérieur) `[ ]`

### 2.4 Interface (Mode YouTube) `[ ]`

- [ ] Réutiliser la fonction utilitaire `buildSaveFilename(title, artist)` (définie en §2.3) pour proposer le nom de fichier lors de la sauvegarde YouTube.
- [ ] Ajouter le bouton de sauvegarde aux résultats YouTube et/ou à la source YouTube actuellement chargée.
- [ ] Séparer clairement `Charger` et `Sauvegarder en MP3`.
- [ ] Masquer ou désactiver la sauvegarde pour une source `local`.
- [ ] Désactiver le bouton pendant la demande pour éviter les doubles téléchargements.
- [ ] Afficher le titre du morceau et rappeler que seule la piste audio sera sauvegardée.
- [ ] Afficher l'état `yt-dlp/ffmpeg indisponible` dans l'interface si le backend le signale.

---

## 3. Sources locales — import et lecture `[ ]`

### 3.1 Import simple `[~]`

- [x] **`js/local-load.js`** : les boutons `📁 Load local` des decks A/B (`#deck-load-local-a/b`) sont déjà câblés — `showOpenFilePicker` (fallback `input[type=file]`), lecture via `AudioPlayer.loadLocalFile(file)`, extraction des métadonnées ID3 (`extractAudioMetadata`) et de la pochette (`extractCoverImage`).
- [ ] Ajouter un bouton `📂 Ouvrir des fichiers locaux` utilisant `<input type="file" multiple accept="audio/*,video/*">`.
- [ ] Ajouter, si utile, un bouton `📁 Ouvrir un dossier` avec `showDirectoryPicker()`; le bouton reste optionnel et ne doit pas bloquer l'import de fichiers.
- [ ] Accepter les fichiers audio et les vidéos lisibles par le navigateur; pour une vidéo, utiliser uniquement sa piste audio dans le mixer.
- [ ] Ne pas scanner le disque sans action explicite de l'utilisateur.
- [ ] Lire les métadonnées disponibles côté navigateur : nom, type MIME, taille et durée.
- [ ] Signaler clairement les formats que le navigateur ne sait pas lire.

### 3.2 Bibliothèque locale `[ ]`

- [ ] Créer `js/local-library.js` pour conserver la liste des fichiers importés et leurs métadonnées.
- [ ] Utiliser IndexedDB uniquement pour l'index et, si supporté, le `FileSystemFileHandle`; ne pas dupliquer inutilement les octets du fichier.
- [ ] Garder les fichiers sélectionnés via `<input type="file">` disponibles pour la session courante.
- [ ] Au rechargement, demander à nouveau la permission ou proposer de réimporter le fichier s'il n'est plus accessible.
- [ ] Ajouter `list`, `search`, `add`, `remove` et `resolveFile` dans le module.
- [ ] La suppression d'une entrée retire uniquement l'index : elle ne supprime jamais le fichier réel.
- [ ] Ajouter une action `Effacer la bibliothèque locale` qui ne touche pas au disque.

---

## 4. Recherche spéciale `local` `[ ]`

### 4.1 Mode de recherche `[ ]`

- [ ] Ajouter un mode de recherche `local` distinct des modes YouTube/Piped.
- [ ] Persister le mode par deck dans `localStorage` si nécessaire.
- [ ] En mode `local`, rechercher uniquement dans la bibliothèque locale; ne faire aucun appel à YouTube, Piped ou `yt-dlp`.
- [ ] Une recherche vide affiche les fichiers locaux importés; une recherche texte filtre le nom et les métadonnées disponibles.
- [ ] Afficher un message spécifique si la bibliothèque est vide ou si une permission doit être renouvelée.

### 4.2 Résultats locaux `[ ]`

- [ ] Afficher pour chaque résultat : icône `LOCAL`, nom/titre, durée, format et taille.
- [ ] Ajouter `Charger dans la voie` et `Retirer de la bibliothèque`.
- [ ] Utiliser le même modèle de résultat que la recherche distante, mais avec `sourceKind: 'local'` au lieu d'un `videoId`.
- [ ] Échapper les noms de fichiers avant affichage.
- [ ] Marquer le fichier actuellement chargé dans le deck.

### 4.3 Intégration recherche/lecteur `[ ]`

- [ ] Adapter `js/search.js` et `js/app.js` pour transmettre une source complète, pas uniquement un `videoId`.
- [ ] Ajouter `loadSource(source)` à `js/audio-player.js` en conservant `loadVideoById()` pour YouTube.
- [ ] Pour un fichier local, utiliser un `URL.createObjectURL(file)` sur l'élément audio déjà branché à `AudioEngine`.
- [ ] Révoquer l'ancien object URL lors du remplacement de la source.
- [ ] Ne pas tenter de rafraîchir une source locale via `PipedStreams`.

---

## 5. Intégration mixer et état `[ ]`

- [ ] Ajouter `sourceKind` et `sourceId` à l'état de chaque deck.
- [ ] Persister les dernières sources locales et YouTube quand c'est possible.
- [ ] Restaurer une source locale uniquement si le fichier ou le handle est encore accessible.
- [ ] Afficher les badges `LOCAL`, `YT-DLP`, `PIPED` et `IFRAME` selon la source réellement utilisée.
- [ ] Vérifier que crossfade, volume master, EQ, filtre, visualizer, seek et play/pause fonctionnent de la même façon avec une source locale audio et une source `yt-dlp`.
- [ ] Ne pas créer un deuxième `MediaElementAudioSourceNode` lors d'un changement de fichier.

---

## 6. UI, documentation et confidentialité `[ ]`

- [ ] Ajouter les boutons d'ouverture de fichiers, de recherche `local` et de sauvegarde MP3.
- [ ] Ajouter les états accessibles `aria-busy`, messages d'erreur et messages de progression.
- [ ] Rappeler dans l'interface que les fichiers locaux restent sur le disque de l'utilisateur.
- [ ] Rappeler que la sauvegarde YouTube produit uniquement un fichier audio MP3.
- [ ] Documenter l'installation de `yt-dlp` et `ffmpeg` et l'utilisation via `http://localhost:5400`.
- [ ] Documenter les limites de compatibilité du dialogue `showSaveFilePicker` et le fallback de téléchargement navigateur.
- [ ] Ajouter une note sur les droits d'utilisation et de conservation des contenus téléchargés.

---

## 7. Tests et validation `[ ]`

### Backend — Phase 1 (Mode DJ) `[~]`

- [x] Charger un morceau en mode DJ → le MP3 est en cache (`cache/audio/<id>.mp3`).
- [x] Cliquer sur `💾 Save local` → le dialogue de sauvegarde s'ouvre avec le bon nom de fichier (`<titre>-<artiste>.mp3`).
- [x] Vérifier le MP3 téléchargé : lisible, durée correcte, audio uniquement.
- [x] Tester `saveCurrentDj` avec `showSaveFilePicker` disponible et indisponible (fallback `<a download>`).
- [x] Annuler le dialogue de sauvegarde → aucune erreur bloquante.
- [x] Vérifier que le bouton est désactivé en mode `local`, en mode `iframe` et en mode fallback Piped.
- [~] Vérifier que la pochette (~chemin hqdefault) est bien embarquée après vidange du cache et nouvelle extraction.

### Backend — Phase 2 (Mode YouTube, ultérieur) `[ ]`

- [ ] Vérifier qu'une vidéo YouTube donne un MP3 lisible contenant uniquement l'audio.
- [ ] Vérifier que le MP3 contient le titre, l'artiste/uploader et les autres tags disponibles.
- [ ] Vérifier le nom de fichier proposé et les caractères accentués/spéciaux.
- [ ] Tester `yt-dlp` absent, `ffmpeg` absent, vidéo indisponible, anti-bot, timeout et annulation.
- [ ] Vérifier qu'aucun MP3 permanent n'est conservé sur le serveur (extraction à la demande, fichier temporaire supprimé).

### Navigateur (tous modes) `[ ]`

- [ ] Importer et rechercher des MP3, M4A, OGG, WAV et vidéos locales supportées.
- [ ] Charger une source locale dans A et une source `yt-dlp` dans B, puis tester le mixage.
- [ ] Vérifier les permissions, les fichiers déplacés/supprimés et la réouverture après rechargement.
- [ ] Vérifier qu'un changement répété de fichiers ne crée pas de fuite d'object URLs ou de nœuds Web Audio.

---

## 8. Ordre d'implémentation recommandé `[ ]`

### Phase 1 — Mode DJ (sauvegarde du MP3 déjà en cache) `[x]`

1. [x] Backend : ajouter `GET /api/download/:id` — sert le MP3 du cache (ou lance `extractAudio` si absent) avec `Content-Disposition: attachment` + nom de fichier nettoyé depuis le titre.
2. [x] Frontend : renommer `📁 Fichier local` → `📁 Load local` dans les deux `.deck-local-row`.
3. [x] Frontend : ajouter les boutons `#deck-save-local-a` et `#deck-save-local-b` à droite des boutons de chargement.
4. [x] Frontend : créer `js/local-save.js` — `localSave.saveCurrentDj(deck)` avec `showSaveFilePicker` + fallback `<a download>`.
5. [x] Frontend : brancher les boutons "Save local" selon `state.playerType[deck]` et `state.videoIds[deck]` (§2.2).
6. [x] Backend : `--embed-metadata` + post-traitement `embedThumbnail()` (pochette YouTube via ffmpeg APIC/ID3) dans `extractAudio`.
7. [~] Tests Phase 1 : sauvegarde DJ, annulation, états des boutons, fallback sans `showSaveFilePicker`, pochette embarquée.

### Phase 2 — Mode YouTube (extraction à la demande + tags) `[ ]`

7. [ ] Backend : adapter `/api/download/:id` pour l'extraction à la demande en mode YouTube (pas de cache obligatoire).
8. [ ] Backend : écriture des métadonnées MP3 via `ffmpeg` (phase 2 spécifique aux tags).
9. [ ] Frontend : activer la sauvegarde en mode YouTube IFrame et ajouter les états UI dédiés.
10. [ ] Tests Phase 2 : flux complet YouTube → MP3 tagué → emplacement choisi par l'utilisateur.

### Indépendant (bibliothèque locale, les deux modes) `[ ]`

11. [ ] Ajouter `loadSource()` et la lecture de fichiers locaux dans le graphe Web Audio.
12. [ ] Ajouter l'index local et l'import explicite de fichiers.
13. [ ] Ajouter le mode de recherche `local` et ses résultats.
14. [ ] Adapter l'état des decks, les badges et la persistance.
15. [ ] Mettre à jour la documentation.

## Notes et limites connues

- **Mode DJ** : la sauvegarde repose sur le cache disque déjà en place (`cache/audio/<id>.mp3`). Le fichier servi est l'audio déjà extrait par `yt-dlp -x + ffmpeg` — pas de nouvelle opération réseau côté serveur, sauf si le cache est vide.
- **Mode YouTube (ultérieur)** : la conversion MP3 et l'écriture fiable des tags nécessitent `ffmpeg` côté serveur.
- Le navigateur ne peut pas imposer un chemin de sauvegarde; le choix appartient à l'utilisateur via son dialogue de fichiers.
- Le serveur ne reçoit jamais le chemin local choisi et ne stocke pas le MP3 au-delà du cache de lecture existant.
- Une vidéo locale peut être lue avec sa piste audio si son format est supporté par le navigateur; sa conversion en MP3 n'est pas demandée dans cette fonctionnalité.
- Le téléchargement et la conservation d'un contenu YouTube doivent respecter les droits d'auteur et les conditions applicables.

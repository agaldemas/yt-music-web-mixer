# Métadonnées du popup dans le MP3 du cache — Plan d'implémentation

> **Pour Hermes :** utiliser le skill subagent-driven-development pour exécuter ce plan tâche par tâche.

**Goal :** Que les informations affichées dans le popup (vues, date de publication ISO, durée, uploader, description complète) soient embarquées dans le MP3 du cache — récupérées UNE seule fois depuis l'upstream, servies ensuite sans requête répétée.

**Architecture :** Le serveur fait déjà l'extraction une seule fois par vidéo (cache disque cache/audio/<id>.mp3). On ajoute un cache disque JSON des métadonnées du popup (cache/meta/<id>.json) écrit une seule fois (TTL 24h), un endpoint unique /api/meta/:id qui ressert ce JSON sans jamais contacter l'upstream, et un enrichissement ffmpeg du MP3 (tags ID3 complémentaires + commentaire JSON) au moment de l'extraction.

**Tech Stack :** Node/Express (existant), yt-dlp (existant), ffmpeg (existant), shell/awk pour la réécriture ID3v2 (SANS node-id3 — 0 dépendance, KISS). JSON à plat = pas besoin de mutagen côté serveur.

---

## Contexte / État des lieux (enquête faite, vérifiée)

1. **Le cache disque MP3 existe déjà** : cache/audio/<id>.mp3, servi par /api/audio/:id et /api/download/:id. `extractAudio()` (server/server.js:200) ne relance yt-dlp QUE si le fichier manque. → Déjà : 1 seule extraction upstream par vidéo, ensuite sendFile direct. **La re-extraction "queue-leu-leu" n'existe pas.**
2. **Le MP3 contient déjà** (vérifié par ffprobe sur cache/audio/0HtyF0jux2Q.mp3) : title, artist, date (année seule), genre, description + synopsis (description yt-dlp du moment), purl + comment (URL watch). → Mais PAS : vues, date de publication ISO complète, uploadDate, durée, uploader séparé fiable.
3. **La description du popup est re-fetchée côté client à chaque popup** : js/search.js:400 `fetchDescription()` et js/deck-controls.js:328 refont un fetch GET /api/description/:id à chaque hover/ouverture. Le serveur a bien un cache mémoire (descCache, TTL 24h/30min, sérialisation, dédup — server/server.js:122-193) **MAIS en mémoire uniquement** : perdu au redémarrage, et si le MP3 est déjà en cache, la description est quand même re-demandée via yt-dlp --skip-download --print description au 1er appel.
4. **Le MP3 sauvé** (local-save.js → /api/download/:id) contient donc déjà title/artist/pochette/description, mais PAS vues / date-ISO / uploadDate / durée.
5. **Le popup affiche** (search.js populatePopup) : vues, date (formatée), badge LIVE, description complète. (deck-controls.js : description seule + titre/uploader dans la barre.)

## Objectifs (utilisateur)

- A. Éviter les requêtes répétées upstream (yt-dlp / oEmbed / Piped) : chaque info récupérée UNE fois, puis servie depuis le cache.
- B. Avoir les infos du popup DANS le MP3 sauvé, dans les limites possibles (≈ 3 ko de commentaire/id3v2 ; champs natifs ID3 + un commentaire JSON compact — **sans le nombre de vues**, inutile dans un fichier audio ; pas de champ ID3 natif "uploadDate" → ISO dans le JSON).
- C. Tout sans nouvelle dépendance npm (KISS/YAGNI ; pas de node-id3 ni mutagen).

---

## Approche proposée

### Nouveau : cache disque JSON des métadonnées

Fichier : `cache/meta/<videoId>.json` (dossier .gitignore déjà couvert par `cache/`).

Contenu (format à plat, compatible Piped-like) :

```json
{
  "id": "0HtyF0jux2Q",
  "title": "Danzel - Pump It Up (OFFICIAL VIDEO)",
  "uploader": "Ultra Records",
  "duration": 231,
  "thumbnailUrl": "https://i.ytimg.com/vi/0HtyF0jux2Q/hqdefault.jpg",
  "views": 48321057,
  "uploadDate": "2008-04-18",
  "uploadDateLabel": "18 avr. 2008",
  "description": "Official Video for \"Pump It Up\" ...",
  "fetchedAt": 1785026836298
}
```

- `uploadDateLabel` : date formatée en français, identique à celle du popup (recalculée côté client par search.js — on stocke la date ISO brute et on laisse le client formater ; le label n'est PAS stocké, YAGNI).
- `views`: nombre brut — utilisé par le POPUP côté client (search.js le formate déjà) et par /api/meta. **Pas embarqué dans le MP3** (l'utilisateur s'en moque dans un fichier audio).

### Source unique de vérité : un endpoint `/api/meta/:id`

- **1re génération** (cache absent) : interroge les sources dans l'ordre :
  1. **oEmbed YouTube** (fast, 0,15 s, sans clé) → title, uploader (+ thumbnail).
  2. **`yt-dlp --skip-download --print "%(view_count)s|%(upload_date)s" --print description`** → views, uploadDate ISO + description complète. NE TÉLÉCHARGE PAS l'audio (--skip-download).
  3. Si tout échoue → réponse 502/404, négatif non caché (30 min max, comme descCache).
- **Toutes les fois suivantes** : lecture disque directe, ZÉRO requête upstream. TTL 24 h ; au-delà, régénération (rare).
- Sérialisation + dédup en vol (comme descCache : `metaFetching` Map + `metaQueue` chaîne) pour ne JAMAIS lancer 2 yt-dlp pour le même id.
- **Réutilise le cache disque MP3** : si `cache/audio/<id>.mp3` existe déjà, on NE relance PAS yt-dlp pour l'audio — la métadonnée seule est régénérée (léger).

### Enrichissement du MP3 au moment de l'extraction

- **yt-dlp a déjà `--embed-metadata`** (title/artist/date/genre/description/synopsis/purl). On conserve ce comportement.
- **POST-traitement ffmpeg** (dans settleExtracted, qui fait déjà embedThumbnail) : quand la métadonnée popup est disponible et le fichier est un .mp3, ajouter (avec `-map_metadata 0` et `-c:a copy`) :
  - `-metadata description=…` (description complète, déjà présente via yt-dlp, on la normalise)
  - `-metadata comment=…` : **un commentaire JSON compact ≤ 3 ko**, limité aux champs utiles dans un fichier audio :
    - `{"id":"0HtyF0jux2Q","title":"Danzel - Pump It Up (OFFICIAL VIDEO)","uploader":"Ultra Records","duration":231,"uploadDate":"2008-04-18"}`
    - id / title / uploader / duration : identification + durée. **Pas de `views`** (l'utilisateur s'en moque dans un MP3), pas de thumbnail (déjà en APIC).
    - Champs jamais présents en ID3 natif (uploadDate ISO, duration, id vidéo) → JSON.
  - Réécriture **ID3v2.3** propre : ffmpeg (`-id3v2_version 3`) ne REPLACE pas les tags existants, il les fusionne — mais un tag `comment` déjà présent (purl/comment de yt-dlp) peut rester en double → **nettoyage des commentaires ID3v2 existants** avant réécriture (fonction `stripId3v2Comments` en awk/shell, voir Risques/Tests).
  - NE PAS régénérer si une métadonnée popup existe déjà (contrôle `hasMetaStamp(file)`).

### Côté frontend (léger)

- **`js/piped-streams.js`** : `buildStreamEntry()` enrichit l'entrée cache avec `views`, `uploadDate`, `uploadDateLabel` (formatage français, champ calculé client), `description` quand présents dans la réponse `/api/streams/:id` — le serveur peut les ajouter à sa réponse JSON.
- **`js/search.js` + `js/deck-controls.js`** : si l'entrée cache contient déjà `views`/`uploadDate`/`description`, le popup les affiche SANS fetch `/api/description/:id` (zéro requête). Sinon comportement actuel (fetch, qui sera servi par le cache disque serveur → quasi instantané et sans yt-dlp).
- **`js/local-save.js`** : inchangé (le MP3 sauvé via /api/download/:id contient déjà tout ce qui précède, puisque c'est le MP3 du cache enrichi).

---

## Étapes

### Tâche 0 — Fuite de contexte ? Non : vérifier l'état git + serveur

**Objective:** S'assurer que le serveur n'est pas en train de tourner et que le repo est dans l'état attendu avant de modifier.

**Files:**
- Check: `git status --short`, `git branch -vv`, `git remote -v`

**Step 1:**
```bash
git status --short && git branch -vv && git remote -v
```
Expected: branche main, pas de remote (ou remote existant), fichiers propres sauf les tests-debug déjà présents.

**Step 2:** Vérifier qu'aucun `node server/server.js` ne tourne (port 5400 libre).

### Tâche 1 — Nettoyage comments ID3v2 avant réécriture (utilitaire shell)

**Objective:** Supprimer les commentaires ID3v2 existants (purl/comment de yt-dlp) d'un MP3 sans toucher au reste des tags, pour éviter les doublons lors de l'ajout du commentaire JSON.

**Files:**
- Create: `server/strip-id3v2-comments.sh`

**Step 1:** Écrire le script (awk + ffmpeg -map_metadata -1 + boucle, ou plus simple : `ffmpeg -i in -map 0:a -c:a copy -metadata:s:v title=Album\ cover ...` ; le plus robuste : extraire les tags existants, retirer les commentaires, les remettre en args).

**Step 2:** Vérifier sur une copie de test :
```bash
cp cache/audio/0HtyF0jux2Q.mp3 /tmp/test-strip.mp3
bash server/strip-id3v2-comments.sh /tmp/test-strip.mp3
ffprobe -show_entries format_tags /tmp/test-strip.mp3
```
Expected: plus aucun TAG:comment, les autres tags (title/artist/...) conservés.

### Tâche 2 — Cache disque JSON des métadonnées + endpoint /api/meta/:id

**Objective:** Générer une fois les métadonnées popup (views, uploadDate, duration, uploader, description) et les servir depuis le disque sans jamais retoucher l'upstream.

**Files:**
- Modify: `server/server.js` (ajout META_DIR, fetchMetaEnriched, cache disque + TTL, route /api/meta/:id)

**Step 1:** Ajouter les constantes (META_DIR, META_OK_TTL_MS=24h, META_ERR_TTL_MS=30min, META_TIMEOUT_MS=25s), mkdirSync(cache/meta).

**Step 2:** Écrire `fetchMetaEnriched(videoId)` :
- Lecture cache disque `cache/meta/<id>.json` (TTL).
- Sinon : oEmbed (fetchMeta existant) → title/uploader/thumbnail ; puis `yt-dlp --skip-download --print "%(view_count)s|%(upload_date)s" --print description` (avec cookies, retry sans cookies comme extractAudio, maxBuffer 2 Mo, timeout 25 s) → views/uploadDate/description.
- Écrit le JSON disque (atomic : écrire .tmp puis rename).
- Sérialisation : `metaFetching` Map + `metaQueue` (copie du pattern descFetching/descQueue existant ligne 128-155).
- Erreurs : négatif caché 30 min.

**Step 3:** Route `GET /api/meta/:id` (validation RE_VIDEOID, CORS déjà en place) → res.json(cache) ; 404/502 comme /api/streams.

**Step 4:** Faire référencer la nouvelle route dans le header du fichier (commentaire, ligne 11-14).

**Step 5:** Vérification manuelle (serveur lancé) :
```bash
curl -s localhost:5400/api/meta/0HtyF0jux2Q | python3 -m json.tool | head -20
# 2e appel : doit être quasi instantané et identique (zéro yt-dlp)
time curl -s localhost:5400/api/meta/0HtyF0jux2Q >/dev/null
```

### Tâche 3 — Enrichissement MP3 du cache (commentaire JSON + nettoyage)

**Objective:** Le MP3 extrait/servi porte les infos utiles dans ses tags (description ID3 native + commentaire JSON ≤ 3 ko avec id/title/uploader/duration/uploadDate — **pas de vues**).

**Files:**
- Modify: `server/server.js` (settleExtracted, embedThumbnail → nouvelle fonction `embedPopupMeta`, hasMetaStamp)

**Step 1:** Écrire `embedPopupMeta(mp3Path, videoId)` :
- Vérifie `hasMetaStamp(file)` (présence d'un commentaire JSON) → skip si présent.
- Récupère `fetchMetaEnriched(videoId)` (cache disque → pas de yt-dlp si déjà généré).
- Construit le JSON compact ≤ 3 ko (tronquer description à ~2000 chars dans le commentaire, la description complète reste en tag ID3).
- `strip-id3v2-comments.sh` sur une copie temp, puis ffmpeg `-map 0:a -c:a copy -id3v2_version 3 -metadata comment=<json>` (+ conserver les autres tags via -map_metadata 0), rename.
- Erreurs non bloquantes (log warn, l'audio reste servi sans commentaire).

- **Step 3:** Modifier `settleExtracted` (ligne 367) pour chaîner `embedThumbnail` PUIS `embedPopupMeta`. `embedPopupMeta` n'embarque **que** le JSON commentaire (id/title/uploader/duration/uploadDate). **Pas de vues** (inutile dans un fichier audio) et pas de thumbnail (déjà en APIC).

**Step 3:** Vérification :
```bash
curl -s localhost:5400/api/audio/0HtyF0jux2Q -o /tmp/test.mp3
ffprobe -show_entries format_tags /tmp/test.mp3 | grep -E "comment|description"
# comment doit contenir le JSON avec views/uploadDate/duration
node -e "const t=require('fs').readFileSync('/tmp/test.mp3'); // vérif taille commentaire <= 3072"
```

### Tâche 4 — Frontend : popup servi par le cache, zéro requête quand dispo

**Objective:** Le popup affiche vues/date/description depuis l'entrée cache (client) sans fetch /api/description/:id quand l'entrée cache les contient.

**Files:**
- Modify: `js/piped-streams.js` (buildStreamEntry : propager views/uploadDate/uploadDateLabel/description)
- Modify: `js/search.js` (populatePopup/fetchDescription : utiliser l'entrée cache si dispo)
- Modify: `server/server.js` (route /api/streams/:id : ajouter meta enrichie quand dispo)

- **Step 2:** Dans `buildStreamEntry` (js/piped-streams.js:414), ajouter :
```js
views: Number(data.views) || 0,
uploadDate: String(data.uploadDate || ''),
uploadDateLabel: data.uploadDate ? formatFrenchDate(data.uploadDate) : '',
description: String(data.description || '').trim(),
```
(formatFrenchDate = fonction utilitaire identique à celle de search.js ; la garder DRY en l'exportant ou en la dupliquant proprement). `views` reste côté client uniquement (popup) — jamais embarqué dans le MP3.

**Step 2:** `js/search.js populatePopup` : si `PipedStreams.getCachedStream(video.id)` a `views`/`uploadDate`/`description`, les afficher directement ; `fetchDescription` ne part que si l'entrée cache n'a pas la description.

**Step 4:** Vérification navigateur : hover sur un résultat → popup instantané sans nouvelle requête réseau (Network tab : 0 requête /api/description), puis clic "!" → même chose (deck-controls.js servira par le cache disque serveur via /api/description, déjà en place — pas de modification nécessaire dans ce fichier).

### Tâche 5 — Le serveur doit répondre /api/streams avec les champs enrichis

**Objective:** Uniformiser : /api/streams/:id renvoie aussi views/uploadDate/description pour que le frontend n'ait jamais à re-demander.

**Files:**
- Modify: `server/server.js` (route /api/streams/:id : ajouter meta enrichie quand dispo)

**Step 1:** Dans la route /api/streams/:id (ligne 444), après fetchMeta, tenter `fetchMetaEnriched(id)` (best-effort, timeout court) ; si dispo, injecter `views`, `uploadDate`, `description` dans la réponse JSON. (`views`/`uploadDate` restent côté client — jamais dans le MP3.)

**Step 2:** Vérification :
```bash
curl -s localhost:5400/api/streams/0HtyF0jux2Q | python3 -m json.tool | grep -E "views|uploadDate|description" | head
```

### Tâche 6 — Nettoyage + validation finale

**Objective:** Vérifier que : aucune nouvelle dépendance, le serveur ne devient pas plus lent, les MP3 existants en cache ne sont PAS ré-extraits, et les nouveaux MP3 portent les tags.

**Files:**
- Check: `package.json` (aucun ajout), `.gitignore` (cache/ déjà ignoré), `cache/` (aucune re-extraction)

**Step 1:** `git diff --stat` : seuls server/server.js, js/piped-streams.js, js/search.js, js/deck-controls.js (+ server/strip-id3v2-comments.sh nouveau) doivent bouger.

**Step 2:** `node --check server/server.js` (syntaxe) + `node --check js/piped-streams.js` + `node --check js/search.js` + `node --check js/deck-controls.js`.

**Step 3:** Lancer le serveur, ouvrir l'app, charger un morceau déjà en cache (0HtyF0jux2Q) :
- Le popup description s'ouvre INSTANTANÉMENT (aucune requête réseau pour /api/description).
- Le MP3 téléchargé par /api/download contient le commentaire JSON (id/title/uploader/duration/uploadDate — pas de vues) + description complète.
- `cache/audio/0HtyF0jux2Q.mp3` : mtime inchangé → pas de re-extraction.

---

## Tests / validation

- **Vérification unitaire (script shell/ffprobe)** : les étapes ci-dessus (ffprobe sur MP3 avec/sans commentaire ; strip script).
- **Vérification réseau** : Network tab DevTools — 0 requête /api/description/:id quand l'entrée cache est riche ; sinon 1 requête servie par le cache disque serveur.
- **Vérification MP3 sauvé** : ffprobe -show_entries format_tags : comment avec JSON ≤ 3 ko, description complète, title/artist/date conservés, pochette APIC conservée.
- **Vérification "aucune re-extraction"** : stat mtime cache/audio/*.mp3 avant/après.
- **Vérification anti-bot** : aucune nouvelle invocation yt-dlp à la 2e demande de /api/meta.

## Risques / compromis / questions ouvertes

- **Taille du commentaire ID3** : ≤ 3 ko (demande utilisateur). La description complète reste en tag ID3 `description`/`synopsis` (yt-dlp la met déjà, taille ~1-2 ko typique, jusqu'à ~8 ko pour les très longues). Le JSON du commentaire est volontairement compact (champs numériques + description tronquée à ~2000 chars si besoin).
- **Réécriture des tags ID3v2 d'un MP3 existant** : ffmpeg ne remplace pas les tags, il fusionne → risque de doublons (comment purl/comment de yt-dlp + notre comment JSON). Le script strip-id3v2-comments.sh (Tâche 1) nettoie avant. C'est le point le plus délicat : à tester sur copie d'abord.
- **Vues/date non récupérables** (oEmbed ne les donne pas) : il faut yt-dlp --skip-download pour view_count/upload_date. C'est un appel léger (~10 s) fait UNE fois, mis en cache disque 24 h. Si yt-dlp absent → vues/date/description absentes (le MP3 garde quand même title/artist/date de l'extraction). **À noter : les vues ne servent qu'au popup ; elles ne sont pas embarquées dans le MP3.**
- **Coût : 1 yt-dlp supplémentaire par nouvelle vidéo** (--skip-download, pas de téléchargement) au 1er /api/meta. Amorti par le cache disque (jamais re-fait sauf TTL 24 h expiré).
- **Compatibilité ID3v2.3** : choisir id3v2_version 3 (comme le code existant) — lu par tout lecteur ; les champs non natifs (views) n'ont pas de tag standard → JSON dans comment. C'est la limite "dans la mesure des limites possibles" demandée.
- **Question ouverte** : faut-il aussi écrire `duration` (durée vidéo) dans le commentaire JSON ? Oui, cohérent avec le popup — voir commentaire compact ci-dessus.
- **Question ouverte** : fallback Piped (sans backend local) — les infos viennent de l'instanciation Piped ; pas de disque serveur, cache client seul. Acceptable (le serveur est le chemin privilégié).
# Plan — Nettoyage du mixer : code mort + déduplication

> **Pour Hermes :** exécuter tâche par tâche, `npm test` doit rester 10/10 après chaque tâche.

**Objectif :** supprimer le code mort confirmé dans le mixer et dédupliquer la logique de crossfade progressif dans `js/mixer.js`. Aucune évolution fonctionnelle.

**Contexte :** analyse du 2026-09-02, tests de référence 10/10 verts (`npm test`). `server/server-yt-dlp.js` est volontairement **hors périmètre** (conservé tel quel).

**Validation :** `npm test` → « ✅ 10/10 fichiers de tests passés » après chaque tâche.

---

## Tâche 1 — mixer.js : dédupliquer le stepping du crossfade

Le bloc `setInterval` de stepping (~20 lignes) existe en double dans
`stepTowardsTarget()` (js/mixer.js:126-177) : branche `autoXf` (l.135-147) et
branche IFrame historique (l.164-176), corps identique au caractère près.

**Fichiers :** `js/mixer.js` uniquement.

**Étapes :**
1. Factoriser en un unique helper `startStepping()` contenant le setInterval
   partagé (dernier palier → cible exacte + `stopStepping()`, sinon incrément
   signé + `applyVolumes()`).
2. Réécrire `stepTowardsTarget()` :
   - `autoXf` armé → stepping si `stepPercent < 100 && stepIntervalMs > 0`,
     sinon saut direct (`appliedCrossfade = crossfade; applyVolumes()`).
   - mode Piped (sans autoXf) → toujours saut direct.
   - mode IFrame → stepping si `stepPercent < 100 && stepIntervalMs > 0`,
     sinon saut direct.
3. Ne pas toucher à `calcVolumes`, `applyVolumes`, `setStepOptions`,
   `setAutoXf`, `setMode`, sync, ni aux exports `window.YTMixer`.

**Vérification :** `npm test` (test_mixer.js couvre setMode ×14, setStepOptions
×5, setAutoXf ×5, autoXf en mode Piped). Comportement strictement identique,
~25 lignes de gagnées.

**Commit :** `refactor(mixer): dedupe crossfade stepping into single helper`

---

## Tâche 2 — mixer.js : supprimer l'export mort `getState`

`YTMixer.getState` (js/mixer.js:316) : défini, exporté, zéro consommateur
(production + tests). Héritage debug.

**Fichiers :** `js/mixer.js`.

**Étapes :**
1. Supprimer l'entrée `getState` dans l'objet `window.YTMixer`.
2. Grep de contrôle : `grep -rn "getState" --include="*.js" js/ tests/ | grep -i mixer` → aucun hit hors commentaire.

**Vérification :** `npm test`.

**Commit :** `refactor(mixer): remove dead getState export`

---

## Tâche 3 — mixer.js : supprimer l'export mort `toggleContinuousSync`

L'export `YTMixer.toggleContinuousSync` (js/mixer.js:313) : zéro usage partout.
La fonction elle-même reste (câblée en interne par `wireUI()` sur
`#resync-toggle`, js/mixer.js:289-293) — seul l'export est mort.

**Fichiers :** `js/mixer.js`.

**Étapes :**
1. Supprimer uniquement la ligne `toggleContinuousSync: toggleContinuousSync,`
   dans l'objet export. Garder la fonction et son câblage `wireUI`.
2. Grep de contrôle : `grep -rn "YTMixer.toggleContinuousSync\|MX.toggleContinuousSync" --include="*.js" .` → vide.

**Vérification :** `npm test`.

**Commit :** `refactor(mixer): drop unused toggleContinuousSync export`

---

## Tâche 4 — audio-engine.js : supprimer `resetPitch`

`AudioEngine.resetPitch` (js/audio-engine.js:423, export l.1014) : défini,
exporté, zéro appel en production comme en tests. La remise à zéro du pitch
passe par d'autres chemins (setPitch('B', 0) etc.).

**Fichiers :** `js/audio-engine.js`.

**Étapes :**
1. Supprimer la fonction `resetPitch` (~15 lignes) et sa ligne d'export.
2. Supprimer la mention correspondante dans l'entête documentaire si présente.
3. Grep de contrôle : `grep -rn "resetPitch" --include="*.js" js/ tests/` → vide.

**Vérification :** `npm test` (test_audio_engine.js doit rester vert).

**Commit :** `refactor(audio-engine): remove unused resetPitch`

---

## Tâche 5 — bpm-detector.js : supprimer l'export `getPlaybackRate`

`BPMDetector.getPlaybackRate` (js/bpm-detector.js:549) : exporte
`currentPlaybackRate` mais zéro consommateur en production comme en tests.

**Fichiers :** `js/bpm-detector.js`.

**Étapes :**
1. Supprimer la ligne d'export `getPlaybackRate: currentPlaybackRate,`.
2. Ne PAS supprimer la variable interne `currentPlaybackRate` (utilisée
   ailleurs dans le module).
3. Grep de contrôle : `grep -rn "getPlaybackRate" --include="*.js" js/ tests/` → vide.

**Vérification :** `npm test`.

**Commit :** `refactor(bpm-detector): remove unused getPlaybackRate export`

---

## Tâche 6 — scratch.js : supprimer les exports sans consommateur

Trois exports de `window.Scratch` (js/scratch.js:733-744) n'ont aucun usage :
`seek`, `isBufferReady`, `STATE`. Les fonctions internes correspondantes
peuvent rester si elles servent en interne ; seuls les exports disparaissent.

**Fichiers :** `js/scratch.js`.

**Étapes :**
1. Retirer `seek: seek,`, `isBufferReady: isBufferReady,`,
   `STATE: { ... }` de l'objet `window.Scratch`.
2. Vérifier avant chaque retrait que la fonction/variable sous-jacente est
   encore référencée en interne — sinon la supprimer aussi (à confirmer au
   moment de l'édition).
3. Grep de contrôle : `grep -rn "Scratch.seek\|Scratch.isBufferReady\|Scratch.STATE" --include="*.js" js/ tests/` → vide.

**Vérification :** `npm test` (test_scratch_release.js, test_scratch_slice.js).

**Commit :** `refactor(scratch): remove unused public exports`

---

## Tâche 7 — Vérification finale

1. `npm run check:syntax` → OK.
2. `npm test` → 10/10.
3. `grep -rn "getState\|toggleContinuousSync: toggleContinuousSync\|resetPitch\|getPlaybackRate" --include="*.js" js/ tests/ | grep -v "function toggleContinuousSync"` → uniquement la fonction interne mixer conservée.
4. Smoke manuel optionnel (si serveur déjà lancé) : bouger le crossfader avec
   « Auto XF » coché et décoché, vérifier la transition par paliers.

---

## Hors périmètre (décidé)

- `server/server-yt-dlp.js` : conservé tel quel (premier jet youtube-only).
- Exports test-only (`YTMixer.getMode/isPipedMode/isAutoXf/syncBtoA/CONST`,
  `PipedStreams.selectBestAudio/buildCorsSafeUrl/clearCache/formatFrenchDate`,
  `AudioPlayer._audioEventToState`) : conservés — consommés par tests/test_mixer.js
  et les autres suites.
- Aucune fusion de modules, aucun remaniement structurel : le découpage
  respecte le SRP documenté dans CLAUDE.md.

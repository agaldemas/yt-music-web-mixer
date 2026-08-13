# Tests — YT Music Web Mixer

Suite de tests Node.js pour les modules JS purs (sans navigateur).
Cible : validation offline des modules Web Audio API et Piped avant
intégration dans l'UI.

## Prérequis

- Node.js ≥ 18 (utilise `fetch`, `AbortSignal.timeout`, top-level await-friendly)
- Connexion Internet pour les tests Piped (interrogent les instances publiques)

## Lancer tous les tests

```bash
node tests/run-all.js
```

## Lancer un test individuel

```bash
# Test du module audio-engine (mock Web Audio API, 92 assertions)
node tests/test_audio_engine.js

# Test du module piped-streams (API Piped réelle)
node tests/test_piped_streams.js

# Test isolation cache + multi-vidéos Piped
node tests/test_multi.js

# Validation phase 0 : container MP4 contient une piste audio (CORS)
node tests/test_audio_track.js
```

## Couverture

| Fichier | Module testé | Dépendances externes |
|---|---|---|
| `test_audio_engine.js` | `js/audio-engine.js` | Aucune (mock Web Audio API) |
| `test_piped_streams.js` | `js/piped-streams.js` + `js/config.js` | 1 instance Piped (`api.piped.private.coffee`) |
| `test_multi.js` | `js/piped-streams.js` | Idem, 3 vidéos différentes |
| `test_audio_track.js` | `js/piped-streams.js` | Idem + téléchargement MP4 (Range request) |

## Notes

- Les tests `test_piped_streams.js`, `test_multi.js` et `test_audio_track.js`
  dépendent de la disponibilité de l'instance Piped publique. Si elle est
  down, les tests échouent. Voir `js/config.js` `PIPED_INSTANCES` pour la
  liste des instances.
- `test_audio_engine.js` n'a aucune dépendance réseau (mock local). Il
  peut être lancé en CI sans connectivité Internet.
- Les chemins sont relatifs (`path.resolve(__dirname, '..')`), donc la
  suite est portable quel que soit le répertoire de travail.
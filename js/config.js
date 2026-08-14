/* config.js — constantes, lecture clé API depuis localStorage */
window.YT_CONFIG = {
  STORAGE_KEYS: {
    API_KEY: 'youtubeApiKey',
    LAST_VIDEO_A: 'lastVideoIdA',
    LAST_VIDEO_B: 'lastVideoIdB',
    LAST_QUERY_A: 'lastSearchQueryA',
    LAST_QUERY_B: 'lastSearchQueryB',
    LAST_SEEK_A: 'lastSeekA',
    LAST_SEEK_B: 'lastSeekB',
    CROSSFADE_STEP_PERCENT: 'crossfadeStepPercent',
    CROSSFADE_STEP_INTERVAL_MS: 'crossfadeStepIntervalMs',
    FORCE_PIPED: 'forcePipedSearch', // forcer la recherche via Piped même si clé API présente
    PLAYER_MODE: 'playerMode', // mode de lecture : 'auto' | 'piped' | 'iframe'
    // Mode Piped DJ (phase 6) : EQ 3 bandes + filtre DJ par voie.
    EQ_LOW_A: 'eqLowA', EQ_MID_A: 'eqMidA', EQ_HIGH_A: 'eqHighA', DJ_FILTER_A: 'djFilterA',
    EQ_LOW_B: 'eqLowB', EQ_MID_B: 'eqMidB', EQ_HIGH_B: 'eqHighB', DJ_FILTER_B: 'djFilterB',
    // Mode Piped DJ (phase 7) : pitch / tempo par voie (en %, -8..+8).
    PITCH_A: 'pitchA', PITCH_B: 'pitchB',
    // Mode Piped DJ (phase 10) : cue points & boucles par voie.
    CUE_A: 'cueA', CUE_B: 'cueB',
    LOOP_IN_A: 'loopInA', LOOP_OUT_A: 'loopOutA',
    LOOP_IN_B: 'loopInB', LOOP_OUT_B: 'loopOutB',
  },
  // Vidéos de test chargées au démarrage (cue, sans lecture auto)
  TEST_VIDEO_A: 'lfmxnzJAbl8',
  TEST_VIDEO_B: 'sBBxnnIQ-Vk',
  // Mode de lecture par défaut quand aucune préférence n'est persistée.
  // 'auto' → Piped Audio (DSP) si reachable, sinon IFrame YouTube (volume-only).
  // Valeurs possibles pour STORAGE_KEYS.PLAYER_MODE : 'auto' | 'piped' | 'iframe'.
  PLAYER_MODE_DEFAULT: 'auto',
  // Crossfade progressif par paliers. La valeur cible du slider est atteinte
  // par incréments de stepPercent toutes les stepIntervalMs ms (via setInterval).
  // Si stepPercent >= 100 ou stepIntervalMs <= 0 → application instantanée.
  CROSSFADE_STEP_PERCENT: 100,
  CROSSFADE_STEP_INTERVAL_MS: 0,
  // Timeout de chargement de l'API IFrame (ms)
  API_LOAD_TIMEOUT_MS: 10000,
  // Pitch / tempo (phase 7) : plage du slider en % autour de 0.
  // ±8% est le standard des sliders pitch DJ physiques (Technics SL-1200).
  PITCH_RANGE_PERCENT: 8,
  // playerVars minimum vital. `origin` est ajouté au runtime par youtube.js
  // uniquement quand on est en http(s) ; en file:// il déclenche l'erreur 153.
  PLAYER_VARS: {
    rel: 0,
    playsinline: 1,
  },
  // ===== Constantes partagées Piped (search.js + piped-streams.js) =====
  //
  // Instances de l'API Piped (frontend YouTube alternatif). CORS activé (*),
  // renvoie du JSON propre. On les essaie en cascade : la première qui répond
  // gagne.
  //
  // ⚠ Au 2026-08-12, sondage multi-instances : seule `api.piped.private.coffee`
  // répond réellement. Les 4 autres de la liste originale (kavin.rocks,
  // reallyaweso.me, leptons.org, adminforge.de) sont HS (502 / fetch failed /
  // 404). On garde une liste courte avec un seul fallback connu — ajouter
  // plus d'instances mortes ne fait que perdre 8s à chaque requête (timeout).
  // À mettre à jour régulièrement (cf. issues GitHub Piped-Instances).
  PIPED_INSTANCES: [
    'api.piped.private.coffee',  // seule instance publique fiable au 2026-08-12
  ],
  // Timeout par tentative d'instance Piped (ms). On reste court pour enchaîner
  // vite sur la suivante si elle ne répond pas.
  PIPED_INSTANCE_TIMEOUT_MS: 8000,
  // Durée de validité estimée d'une URL de flux Piped (avant expiration,
  // après laquelle un re-fetch est requis). Les URLs CDN YouTube expirent
  // généralement au bout de quelques heures ; on reste conservateur à 2h.
  PIPED_STREAM_TTL_MS: 2 * 60 * 60 * 1000,

  // ===== Backend d'extraction local (server/server.js — yt-dlp) =====
  //
  // Contourne le blocage anti-bot YouTube des instances Piped publiques :
  // l'extraction yt-dlp tourne en local, sur l'IP de l'utilisateur. Le
  // serveur Express sert AUSSI le frontend en statique, donc quand l'app
  // est servie par ce backend, app + API sont same-origin (le relais audio
  // /api/audio/:id rend le flux exploitable par Web Audio sans taint).
  //
  // On n'active le backend local QUE si l'app est servie en http(s) —
  // /api/streams/:id est relatif et n'existerait pas en file://.
  //
  // Timeout généreux : yt-dlp peut mettre 20-30s (extraction + résolution
  // anti-bot éventuelle). On reste sous les 45s pour ne pas bloquer l'UI
  // indéfiniment avant de retomber sur la cascade Piped.
  LOCAL_BACKEND_TIMEOUT_MS: 45000,
};
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
  },
  // Vidéos de test chargées au démarrage (cue, sans lecture auto)
  TEST_VIDEO_A: 'lfmxnzJAbl8',
  TEST_VIDEO_B: 'sBBxnnIQ-Vk',
  // Crossfade progressif par paliers. La valeur cible du slider est atteinte
  // par incréments de stepPercent toutes les stepIntervalMs ms (via setInterval).
  // Si stepPercent >= 100 ou stepIntervalMs <= 0 → application instantanée.
  CROSSFADE_STEP_PERCENT: 100,
  CROSSFADE_STEP_INTERVAL_MS: 0,
  // Timeout de chargement de l'API IFrame (ms)
  API_LOAD_TIMEOUT_MS: 10000,
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
  // après quoi un re-fetch est requis). Les URLs CDN YouTube expirent
  // généralement au bout de quelques heures ; on reste conservateur à 2h.
  PIPED_STREAM_TTL_MS: 2 * 60 * 60 * 1000,
};
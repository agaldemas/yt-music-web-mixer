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
  },
  // Vidéos de test chargées au démarrage (cue, sans lecture auto)
  TEST_VIDEO_A: 'lfmxnzJAbl8',
  TEST_VIDEO_B: 'sBBxnnIQ-Vk',
  // Timeout de chargement de l'API IFrame (ms)
  API_LOAD_TIMEOUT_MS: 10000,
  // playerVars minimum vital. `origin` est ajouté au runtime par youtube.js
  // uniquement quand on est en http(s) ; en file:// il déclenche l'erreur 153.
  PLAYER_VARS: {
    rel: 0,
    playsinline: 1,
  },
};

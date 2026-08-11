/* app.js — bootstrap, câblage événements, état global */

(function () {
  const CFG = window.YT_CONFIG;
  const STATE = window.YTWrapper.STATE;
  const SEARCH = window.YTSearch;
  const Mixer = window.YTMixer;

  // État global
  const state = {
    players: { A: null, B: null },
    ready: { A: false, B: false },
    muted: { A: true, B: true },
    videoIds: { A: '', B: '' },
    searches: { A: null, B: null }, // instances YTSearch par voie
  };

  // ===== Helpers UI =====

  function showDeckError(deck, message) {
    const el = document.querySelector('.deck-error[data-deck="' + deck + '"]');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
  }

  function clearDeckError(deck) {
    const el = document.querySelector('.deck-error[data-deck="' + deck + '"]');
    if (!el) return;
    el.textContent = '';
    el.hidden = true;
  }

  function showGlobalError(message) {
    const banner = document.getElementById('api-error-banner');
    if (!banner) return;
    banner.textContent = message;
    banner.hidden = false;
  }

  function hidePlaceholder(deck) {
    const ph = document.querySelector('.player-placeholder[data-deck="' + deck + '"]');
    if (ph) ph.style.display = 'none';
  }

  // Met à jour le bouton mute/unmute selon state.muted[deck]
  function updateMuteButtonUI(deck) {
    var btn = document.querySelector('.deck-mute-btn[data-deck="' + deck + '"]');
    if (!btn) return;
    if (state.muted[deck]) {
      btn.setAttribute('aria-pressed', 'false');
      btn.textContent = '🔇 Activer le son';
    } else {
      btn.setAttribute('aria-pressed', 'true');
      btn.textContent = '🔊 Son activé';
    }
  }

  // Applique l'état mute/unmute sur le lecteur + bouton
  function setDeckMuted(deck, muted) {
    var player = state.players[deck];
    state.muted[deck] = muted;
    if (player && state.ready[deck]) {
      if (muted) {
        player.mute();
      } else {
        player.unMute();
        Mixer.applyVolumes();
      }
    }
    updateMuteButtonUI(deck);
  }

  // ===== Persistance =====

  // Sauvegarde le dernier videoId chargé pour une voie
  function persistVideoId(deck, videoId) {
    const key = (deck === 'A') ? CFG.STORAGE_KEYS.LAST_VIDEO_A : CFG.STORAGE_KEYS.LAST_VIDEO_B;
    try {
      if (videoId) localStorage.setItem(key, videoId);
      else localStorage.removeItem(key);
    } catch (e) { /* ignore */ }
  }

  // ===== Sélection depuis recherche =====

  // Appelé par search.js quand l'utilisateur choisit un résultat
  function onSearchSelect(deck, videoId) {
    state.videoIds[deck] = videoId;
    persistVideoId(deck, videoId);

    // Marque le résultat comme "en cours" dans la grille (si elle est affichée)
    const search = state.searches[deck];
    if (search && typeof search.markActive === 'function') {
      search.markActive(videoId);
    }

    const player = state.players[deck];
    if (!player) return;

    if (!state.ready[deck]) {
      // Lecteur pas encore prêt : on stocke pour appliquer après onReady
      // (c'est rare car createPlayer attend l'API ready, mais defensif)
      return;
    }

    // Charger + lancer la nouvelle vidéo
    player.loadVideoById(videoId);

    // Activer le son systématiquement au changement de vidéo
    setDeckMuted(deck, false);

    hidePlaceholder(deck);
    clearDeckError(deck);
  }

  // ===== Bouton mute/unmute par voie =====

  function wireMuteButton(deck) {
    const btn = document.querySelector('.deck-mute-btn[data-deck="' + deck + '"]');
    if (!btn) return;

    btn.addEventListener('click', function () {
      const player = state.players[deck];
      if (!player || !state.ready[deck]) return;
      setDeckMuted(deck, !state.muted[deck]);
    });
  }

  // ===== Création des lecteurs =====

  function createDeckPlayer(deck, videoId) {
    const playerElId = 'player-' + deck;
    state.players[deck] = window.YTWrapper.createPlayer(playerElId, {
      videoId: videoId || '',
      onReady: function () {
        state.ready[deck] = true;
        const player = state.players[deck];
        player.mute();
        Mixer.applyVolumes();
        hidePlaceholder(deck);
        clearDeckError(deck);
      },
      onStateChange: function () { /* silencieux */ },
      onError: function (err) {
        showDeckError(deck, err.message || 'Erreur de lecture YouTube.');
      },
    });
  }

  // ===== Recherche par voie =====

  function wireSearch(deck) {
    const search = SEARCH.create(deck, {
      onSelect: function (videoId) {
        onSearchSelect(deck, videoId);
      },
      onError: function () { /* déjà affichée dans le panneau */ },
    });
    state.searches[deck] = search;

    // Restaurer la dernière requête dans le champ (sans relancer la recherche)
    const key = (deck === 'A') ? CFG.STORAGE_KEYS.LAST_QUERY_A : CFG.STORAGE_KEYS.LAST_QUERY_B;
    try {
      const last = localStorage.getItem(key);
      const input = document.querySelector('.search-input[data-deck="' + deck + '"]');
      if (last && input) input.value = last;
    } catch (e) { /* ignore */ }
  }

  // ===== Modal Paramètres (clé API) =====

  function initSettingsModal() {
    const btn = document.getElementById('settings-btn');
    const modal = document.getElementById('settings-modal');
    const input = document.getElementById('api-key-input');
    const saveBtn = document.getElementById('api-key-save');
    const clearBtn = document.getElementById('api-key-clear');
    const status = document.getElementById('api-key-status');
    if (!btn || !modal || !input || !saveBtn || !clearBtn || !status) return;

    function updateButtonIndicator() {
      btn.classList.toggle('has-api-key', !!SEARCH.getApiKey());
    }
    updateButtonIndicator();

    function showStatus(message, ok) {
      status.textContent = message;
      status.className = 'modal-status ' + (ok ? 'modal-status-ok' : 'modal-status-err');
      status.hidden = false;
    }
    function hideStatus() {
      status.textContent = '';
      status.className = 'modal-status';
      status.hidden = true;
    }

    function openModal() {
      input.value = SEARCH.getApiKey() || '';
      hideStatus();
      modal.hidden = false;
      // Petit délai pour laisser le focus avant transition
      setTimeout(function () { input.focus(); input.select(); }, 0);
    }

    function closeModal() {
      modal.hidden = true;
      hideStatus();
    }

    btn.addEventListener('click', openModal);

    // Fermeture (backdrop, croix, Escape)
    modal.addEventListener('click', function (e) {
      const t = e.target;
      if (t && t.dataset && t.dataset.closeModal === 'settings') {
        closeModal();
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.hidden) closeModal();
    });

    // Enregistrer
    saveBtn.addEventListener('click', function () {
      const value = input.value.trim();
      // Format basique : commence par AIza (clé publique Google)
      if (value && !/^AIza[0-9A-Za-z_-]{30,}$/.test(value)) {
        showStatus('Format de clé inattendu (devrait commencer par « AIza »). '
          + 'Vérifier la clé sur Google Cloud Console.', false);
        return;
      }
      SEARCH.setApiKey(value);
      updateButtonIndicator();
      if (value) showStatus('Clé enregistrée. Vous pouvez maintenant lancer des recherches.', true);
      else showStatus('Clé supprimée. Seules les URL YouTube sont acceptées dans la recherche.', true);
      // Fermer après un court délai pour laisser lire
      setTimeout(closeModal, 1100);
    });

    // Supprimer
    clearBtn.addEventListener('click', function () {
      input.value = '';
      SEARCH.setApiKey('');
      updateButtonIndicator();
      showStatus('Clé supprimée.', true);
    });

    // Enter dans l'input enregistre
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveBtn.click();
      }
    });
  }

  // ===== Crossfade progressif (paramètres palier / intervalle) =====

  // Lit les réglages depuis localStorage (avec fallback sur config.js)
  function loadStepOptions() {
    var percent = CFG.CROSSFADE_STEP_PERCENT;
    var intervalMs = CFG.CROSSFADE_STEP_INTERVAL_MS;
    try {
      var p = localStorage.getItem(CFG.STORAGE_KEYS.CROSSFADE_STEP_PERCENT);
      var i = localStorage.getItem(CFG.STORAGE_KEYS.CROSSFADE_STEP_INTERVAL_MS);
      if (p !== null) percent = parseInt(p, 10);
      if (i !== null) intervalMs = parseInt(i, 10);
    } catch (e) { /* ignore */ }
    return {
      percent: Math.max(1, Math.min(100, isNaN(percent) ? 100 : percent)),
      intervalMs: Math.max(0, isNaN(intervalMs) ? 0 : intervalMs),
    };
  }

  // Sauvegarde les réglages dans localStorage + pousse vers le mixer
  function saveStepOptions(percent, intervalMs) {
    try {
      localStorage.setItem(CFG.STORAGE_KEYS.CROSSFADE_STEP_PERCENT, String(percent));
      localStorage.setItem(CFG.STORAGE_KEYS.CROSSFADE_STEP_INTERVAL_MS, String(intervalMs));
    } catch (e) { /* ignore */ }
    Mixer.setStepOptions(percent, intervalMs);
  }

  // Câble les 2 paires slider + champ numérique de la modal Paramètres
  function initStepControls() {
    var pSlider = document.getElementById('xf-step-percent');
    var pNum = document.getElementById('xf-step-percent-num');
    var iSlider = document.getElementById('xf-step-interval');
    var iNum = document.getElementById('xf-step-interval-num');
    if (!pSlider || !iSlider) return;

    var opts = loadStepOptions();
    pSlider.value = opts.percent;
    pNum.value = opts.percent;
    iSlider.value = opts.intervalMs;
    iNum.value = opts.intervalMs;
    Mixer.setStepOptions(opts.percent, opts.intervalMs);

    function clampPercent(v) {
      v = parseInt(v, 10);
      if (isNaN(v)) v = 100;
      return Math.max(1, Math.min(100, v));
    }
    function clampInterval(v) {
      v = parseInt(v, 10);
      if (isNaN(v)) v = 0;
      return Math.max(0, Math.min(5000, v));
    }

    // Slider palier → met à jour le champ numérique + persistance
    pSlider.addEventListener('input', function () {
      var percent = clampPercent(pSlider.value);
      var intervalMs = clampInterval(iNum.value);
      pNum.value = percent;
      saveStepOptions(percent, intervalMs);
    });

    // Champ numérique palier → met à jour le slider + persistance
    pNum.addEventListener('input', function () {
      var percent = clampPercent(pNum.value);
      var intervalMs = clampInterval(iNum.value);
      pSlider.value = percent;
      saveStepOptions(percent, intervalMs);
    });
    pNum.addEventListener('blur', function () {
      var percent = clampPercent(pNum.value);
      pNum.value = percent;
      pSlider.value = percent;
    });

    // Slider intervalle → met à jour le champ numérique + persistance
    iSlider.addEventListener('input', function () {
      var intervalMs = clampInterval(iSlider.value);
      var percent = clampPercent(pNum.value);
      iNum.value = intervalMs;
      saveStepOptions(percent, intervalMs);
    });

    // Champ numérique intervalle → met à jour le slider + persistance
    iNum.addEventListener('input', function () {
      var intervalMs = clampInterval(iNum.value);
      var percent = clampPercent(pNum.value);
      iSlider.value = intervalMs;
      saveStepOptions(percent, intervalMs);
    });
    iNum.addEventListener('blur', function () {
      var intervalMs = clampInterval(iNum.value);
      iNum.value = intervalMs;
      iSlider.value = intervalMs;
    });
  }

  // ===== Bootstrap =====

  function init() {
    wireMuteButton('A');
    wireMuteButton('B');
    wireSearch('A');
    wireSearch('B');
    initSettingsModal();
    initStepControls();

    window.YTWrapper.init(function (apiErrorMessage) {
      showGlobalError(apiErrorMessage);
    });

    createDeckPlayer('A', CFG.TEST_VIDEO_A);
    createDeckPlayer('B', CFG.TEST_VIDEO_B);

    Mixer.init(state.players);
  }

  // Exposer pour debug console
  window.state = state;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
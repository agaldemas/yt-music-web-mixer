/* app.js — bootstrap, câblage événements, état global
 *
 * Dual mode (section 4 du plan de migration Piped) :
 *   - Mode Piped Audio (Web Audio DSP) ou IFrame YouTube (volume-only).
 *   - Détection au démarrage : 'auto' → Piped si reachable, sinon IFrame.
 *   - Bascule globale (en-tête) : permute les DEUX decks Piped ↔ IFrame.
 *   - Mode manuel (Paramètres) : auto / Piped / IFrame.
 *   - Fallback runtime : si Piped échoue en lecture, alerte globale proposant
 *     de rebasculer les deux decks en IFrame (jamais de mode hybride).
 *
 * Les deux decks sont TOUJOURS dans le même mode (pas de mode hybride :
 * crossfade/EQ/BPM/visualiseur seraient incohérents entre un deck GainNode
 * et un deck setVolume). PLAYER_MODE global = seule source de vérité.
 */

(function () {
  const CFG = window.YT_CONFIG;
  const STATE = window.YTWrapper.STATE;
  const SEARCH = window.YTSearch;
  const Mixer = window.YTMixer;
  const AudioPlayer = window.AudioPlayer;
  const AudioEngine = window.AudioEngine;
  const PipedStreams = window.PipedStreams;
  const DeckTransport = window.DeckTransport;
  const Visualizer = window.Visualizer;

  // État global
  const state = {
    players: { A: null, B: null },       // wrappers lecteur (Piped ou IFrame)
    playerType: { A: 'iframe', B: 'iframe' }, // 'piped' | 'iframe' (type du wrapper courant)
    ready: { A: false, B: false },
    muted: { A: false, B: false },
    videoIds: { A: '', B: '' },
    searches: { A: null, B: null },      // instances YTSearch par voie
    // Mode de lecture (dual mode)
    playerMode: CFG.PLAYER_MODE_DEFAULT, // 'auto' | 'piped' | 'iframe' (préférence persistée)
    resolvedMode: 'iframe',              // 'piped' | 'iframe' (mode réellement actif)
    pipedAvailable: false,               // Piped reachable au dernier test
    visualizers: { A: null, B: null, master: null }, // instances Visualizer par voie + master
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

  // ===== Visualiseurs (spectre/waveform) — phase 8 =====
  //
  // Crée les canvas par voie + master. Les deck-visualizers ne sont actifs
  // qu'en mode Piped (sinon pas d'AnalyserNode, et on montre la vidéo YT).
  // On attache l'AnalyserNode de chaque voie après onReady (la chaîne Web
  // Audio existe alors → AudioEngine.getAnalyser(deck)). Le master utilise
  // AudioEngine.getMasterAnalyser().
  function attachDeckVisualizer(deck) {
    if (!Visualizer) return;
    if (!state.visualizers[deck]) {
      var canvas = document.querySelector('.deck-visualizer[data-deck="' + deck + '"]');
      if (!canvas) return;
      var palette = (deck === 'A') ? Visualizer.PALETTES.a : Visualizer.PALETTES.b;
      state.visualizers[deck] = Visualizer.create(canvas, null, {
        mode: 'spectrum', palette: palette, barCount: 40,
      });
    }
    // Branche l'AnalyserNode de la voie (existe après createDeckChain → onReady).
    if (AudioEngine && AudioEngine.hasDeck(deck)) {
      state.visualizers[deck].setAnalyser(AudioEngine.getAnalyser(deck));
    }
  }

  function attachMasterVisualizer() {
    if (!Visualizer || state.visualizers.master) return;
    var canvas = document.getElementById('master-visualizer');
    if (!canvas) return;
    state.visualizers.master = Visualizer.create(canvas,
      AudioEngine ? AudioEngine.getMasterAnalyser() : null,
      { mode: 'spectrum', palette: Visualizer.PALETTES.master, barCount: 64 });
  }

  function startVisualizers() {
    if (!Visualizer) return;
    ['A', 'B'].forEach(attachDeckVisualizer);
    attachMasterVisualizer();
    Visualizer.startAll();
  }

  function stopVisualizers() {
    if (Visualizer) Visualizer.stopAll();
  }
  //
  // Calcule les infos à afficher (titre, uploader, miniature, badge de mode)
  // selon le backend actif du deck, puis pousse vers DeckTransport.
  //   - Piped  : PipedStreams.getCachedStream(videoId) → entry {title, uploader,
  //              thumbnailUrl}. Disponible dès que loadVideoById a résolu.
  //   - IFrame : player.getVideoData() → {title, author, video_id}. Miniature
  //              construite depuis i.ytimg.com (format stable YouTube).
  function thumbnailForVideoId(id) {
    if (!id) return '';
    return 'https://i.ytimg.com/vi/' + encodeURIComponent(id) + '/mqdefault.jpg';
  }

  function updateNowPlaying(deck) {
    if (!DeckTransport) return;
    var videoId = state.videoIds[deck];
    var modeLabel = (state.resolvedMode === 'piped') ? 'DJ · DSP' : 'YT IFrame';
    var info = { title: '', uploader: '', thumbnailUrl: '', modeLabel: modeLabel };

    if (state.playerType[deck] === 'piped') {
      var entry = PipedStreams && videoId ? PipedStreams.getCachedStream(videoId) : null;
      if (entry) {
        info.title = entry.title || videoId || '—';
        info.uploader = entry.uploader || '';
        info.thumbnailUrl = entry.thumbnailUrl || thumbnailForVideoId(videoId);
      } else {
        info.title = videoId ? ('Chargement… ' + videoId) : '—';
        info.thumbnailUrl = thumbnailForVideoId(videoId);
      }
    } else {
      var player = state.players[deck];
      if (player && typeof player.getVideoData === 'function') {
        try {
          var vd = player.getVideoData();
          if (vd) {
            info.title = vd.title || videoId || '—';
            info.uploader = vd.author || '';
          }
        } catch (e) { /* ignore */ }
      }
      if (!info.title) info.title = videoId || '—';
      info.thumbnailUrl = thumbnailForVideoId(videoId);
    }

    DeckTransport.setNowPlaying(deck, info);
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

  // Lit le dernier videoId persisté pour une voie (ou '' si absent)
  function getPersistedVideoId(deck) {
    const key = (deck === 'A') ? CFG.STORAGE_KEYS.LAST_VIDEO_A : CFG.STORAGE_KEYS.LAST_VIDEO_B;
    try { return localStorage.getItem(key) || ''; } catch (e) { return ''; }
  }

  // Mode de lecture persisté ('auto' | 'piped' | 'iframe'), défaut CFG.PLAYER_MODE_DEFAULT
  function loadPlayerMode() {
    try {
      var m = localStorage.getItem(CFG.STORAGE_KEYS.PLAYER_MODE);
      if (m === 'auto' || m === 'piped' || m === 'iframe') return m;
    } catch (e) { /* ignore */ }
    return CFG.PLAYER_MODE_DEFAULT || 'auto';
  }

  function persistPlayerMode(mode) {
    try { localStorage.setItem(CFG.STORAGE_KEYS.PLAYER_MODE, mode); } catch (e) { /* ignore */ }
  }

  // ===== Mode de lecture (dual mode) =====

  // Teste l'état de Piped au démarrage. On distingue deux notions :
  //   - reachable : l'instance répond (elle est vivante). Un 500 anti-bot
  //     ("Sign in to confirm you're not a bot") compte comme reachable —
  //     l'instance est UP, c'est juste la vidéo de test que YouTube bloque.
  //   - playable : la vidéo de test renvoie réellement des flux.
  // Le bouton de bascule n'est verrouillé que si Piped n'est PAS reachable.
  // Le mode 'auto' démarre en Piped si playable, sinon en IFrame (sûr).
  function probePiped() {
    if (!PipedStreams) return Promise.resolve({ reachable: false, playable: false });
    return PipedStreams.fetchStreamInfo(CFG.TEST_VIDEO_A)
      .then(function (entry) {
        return { reachable: true, playable: !!(entry && entry.bestAudio) };
      })
      .catch(function (err) {
        // Anti-bot sur la vidéo de test : instance reachable, vidéo bloquée.
        if (err && err.isAntiBot) return { reachable: true, playable: false };
        return { reachable: false, playable: false };
      });
  }

  // Applique la classe de mode sur <body> (hooks CSS pour l'UI DJ future).
  function applyModeBodyClass(mode) {
    document.body.classList.toggle('mode-piped', mode === 'piped');
    document.body.classList.toggle('mode-iframe', mode === 'iframe');
  }

  // Met à jour le bouton global de bascule (libellé + état désactivé).
  // Désactivé quand on est en IFrame ET que Piped est injoignable (bascule
  // impossible vers Piped). En Piped, on peut toujours revenir en IFrame.
  function updateModeButton() {
    var btn = document.getElementById('player-mode-btn');
    if (!btn) return;
    var piped = state.resolvedMode === 'piped';
    btn.textContent = piped ? '🔊 DJ' : '📺 YT IFrame';
    btn.setAttribute('aria-pressed', piped ? 'true' : 'false');
    var blockedFromIframe = (!piped && !state.pipedAvailable);
    btn.disabled = blockedFromIframe;
    btn.title = blockedFromIframe
      ? 'Mode DJ indisponible (instances Piped injoignables).'
      : (piped
        ? 'Mode DJ (DSP audio). Cliquez pour repasser en YT IFrame (vidéo YouTube).'
        : 'Mode YT IFrame (volume uniquement). Cliquez pour le mode DJ (DSP audio).');
  }

  // Synchronise le <select> de la modal Paramètres avec l'état courant.
  function syncSettingsModeSelect() {
    var sel = document.getElementById('player-mode-select');
    if (sel) sel.value = state.playerMode;
  }

  // ===== Alerte fallback Piped → IFrame =====

  function showPipedFallbackAlert() {
    // Ne s'affiche qu'en mode Piped (sinon on est déjà en IFrame).
    if (state.resolvedMode !== 'piped') return;
    var el = document.getElementById('piped-fallback-alert');
    if (el) el.hidden = false;
  }

  function hidePipedFallbackAlert() {
    var el = document.getElementById('piped-fallback-alert');
    if (el) el.hidden = true;
  }

  // ===== Câblage des contrôles de mode =====

  function wireModeButton() {
    var btn = document.getElementById('player-mode-btn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (btn.disabled) return;
      var target = (state.resolvedMode === 'piped') ? 'iframe' : 'piped';
      // La bascule globale persiste un mode CONCRET (surcharge 'auto').
      switchResolvedMode(target).then(function (ok) {
        if (ok) { state.playerMode = target; persistPlayerMode(target); }
        syncSettingsModeSelect();
      });
    });
  }

  function wireSettingsModeSelect() {
    var sel = document.getElementById('player-mode-select');
    var status = document.getElementById('player-mode-status');
    if (!sel) return;

    function showStatus(message, ok) {
      if (!status) return;
      status.textContent = message;
      status.className = 'modal-status ' + (ok ? 'modal-status-ok' : 'modal-status-err');
      status.hidden = !message;
    }

    sel.addEventListener('change', function () {
      var m = sel.value;
      showStatus('', true);
      if (m === 'auto') {
        // 'auto' n'est atteignable que depuis ce menu : on persiste et on
        // résout maintenant (Piped si dispo, sinon IFrame).
        state.playerMode = 'auto';
        persistPlayerMode('auto');
        showStatus('Détection du mode DJ…', true);
        probePiped().then(function (pr) {
          state.pipedAvailable = pr.reachable;
          updateModeButton();
          switchResolvedMode(pr.playable ? 'piped' : 'iframe').then(function () {
            showStatus(pr.playable ? 'Mode Auto : DJ disponible.' : 'Mode Auto : DJ indisponible, YT IFrame actif.', pr.reachable);
          });
        });
      } else {
        switchResolvedMode(m).then(function (ok) {
          if (ok) {
            state.playerMode = m;
            persistPlayerMode(m);
            showStatus('Mode « ' + (m === 'piped' ? 'DJ' : 'YT IFrame') + ' » activé.', true);
          } else {
            showStatus('Bascule impossible : DJ indisponible. Reste en YT IFrame.', false);
          }
          syncSettingsModeSelect();
        });
      }
    });
  }

  function wireFallbackAlert() {
    var switchBtn = document.getElementById('pfa-switch');
    var dismissBtn = document.getElementById('pfa-dismiss');
    if (switchBtn) {
      switchBtn.addEventListener('click', function () {
        hidePipedFallbackAlert();
        switchResolvedMode('iframe').then(function (ok) {
          if (ok) { state.playerMode = 'iframe'; persistPlayerMode('iframe'); }
          syncSettingsModeSelect();
        });
      });
    }
    if (dismissBtn) {
      dismissBtn.addEventListener('click', function () { hidePipedFallbackAlert(); });
    }
  }

  // ===== Création / destruction des lecteurs =====

  // Reconstruit le <div id="player-X"> (YT.Player remplace ce div par un
  // iframe ; avant de recréer un lecteur IFrame, il faut remettre le div).
  function resetPlayerDiv(deck) {
    var id = 'player-' + deck;
    var existing = document.getElementById(id);
    var container = document.querySelector('.deck[data-deck="' + deck + '"] .deck-player');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    if (container) {
      var div = document.createElement('div');
      div.id = id;
      container.appendChild(div);
    }
  }

  // Détruit proprement le lecteur d'une voie (audio Piped ou iframe YouTube).
  // - Piped : déconnecte la chaîne Web Audio + retire l'élément <audio>.
  // - IFrame : retire l'iframe et recrée le div placeholder.
  function teardownPlayer(deck) {
    var p = state.players[deck];
    if (p) {
      try { if (typeof p.pauseVideo === 'function') p.pauseVideo(); } catch (e) { /* ignore */ }
    }
    if (state.playerType[deck] === 'piped') {
      if (AudioEngine && AudioEngine.hasDeck(deck)) AudioEngine.destroyDeckChain(deck);
      if (p && typeof p._getAudioElement === 'function') {
        var audio = p._getAudioElement();
        if (audio && audio.parentNode) audio.parentNode.removeChild(audio);
      }
    } else {
      // IFrame : l'iframe a remplacé le div. On le remet pour le prochain lecteur.
      resetPlayerDiv(deck);
    }
    state.players[deck] = null;
    state.ready[deck] = false;
  }

  // Crée le lecteur d'une voie selon le mode résolu. `restore` (optionnel)
  // permet de reprendre lecture + position après une bascule de mode :
  //   { videoId, currentTime, wasPlaying }
  function createDeckPlayer(deck, videoId, restore) {
    // restore (optionnel) : reprise ONE-SHOT après une bascule de mode. On
    // l'isole dans pendingRestore car l'<audio> Piped réémet onReady à chaque
    // canplay (changement de vidéo) — il ne faut pas réappliquer la position
    // d'origine sur une vidéo nouvellement sélectionnée.
    var pendingRestore = restore
      ? { currentTime: restore.currentTime || 0, wasPlaying: !!restore.wasPlaying }
      : null;
    const playerElId = 'player-' + deck;
    const usePiped = (state.resolvedMode === 'piped');
    state.playerType[deck] = usePiped ? 'piped' : 'iframe';
    if (videoId) state.videoIds[deck] = videoId;

    // Callbacks communs aux deux backends (interface unifiée).
    const callbacks = {
      onReady: function () {
        state.ready[deck] = true;
        const player = state.players[deck];
        // Ré-appliquer l'état mute courant (préservé au-delà du wrapper).
        if (state.muted[deck]) {
          if (player && typeof player.mute === 'function') player.mute();
        } else if (player && typeof player.unMute === 'function') {
          player.unMute();
        }
        Mixer.applyVolumes();
        hidePlaceholder(deck);
        clearDeckError(deck);
        updateNowPlaying(deck);
        // Ré-applique les réglages DJ persistés (EQ + filtre) sur la chaîne
        // (re)créée — les nœuds Web Audio sont neufs, ils repartent à 0.
        restoreDeckDj(deck);
        // (Re)branche le visualiseur de la voie sur son nouvel AnalyserNode.
        attachDeckVisualizer(deck);
        // Reprise one-shot après bascule : restaurer position + lecture, une
        // seule fois (pendingRestore est immédiatement consommé).
        if (pendingRestore) {
          var r = pendingRestore;
          pendingRestore = null;
          if (r.currentTime && player && typeof player.seekTo === 'function') {
            player.seekTo(r.currentTime);
          }
          if (r.wasPlaying && player && typeof player.playVideo === 'function') {
            player.playVideo();
          }
        }
      },
      onStateChange: function (evt) {
        // Notifie l'UI de transport (icône play/pause + spinner de buffering).
        if (DeckTransport) DeckTransport.onStateChange(deck, evt && evt.data);
      },
      onError: function (err) {
        // En mode Piped, une erreur de lecture non récupérable (URL expirée,
        // instances down, CORS) dégrade le mixage : on propose le fallback
        // global vers IFrame (jamais de mode hybride laissé en place).
        if (state.resolvedMode === 'piped') showPipedFallbackAlert();
        showDeckError(deck, (err && err.message) || 'Erreur de lecture.');
      },
    };

    if (usePiped) {
      // Lecteur audio Piped + chaîne Web Audio (createDeckChain appelé dedans).
      state.players[deck] = AudioPlayer.createAudioPlayer(deck, callbacks);
      // createAudioPlayer ne charge pas la vidéo lui-même → on le fait ici.
      if (videoId) state.players[deck].loadVideoById(videoId);
    } else {
      // Lecteur IFrame YouTube (le constructeur cue la videoId fournie).
      state.players[deck] = window.YTWrapper.createPlayer(playerElId, Object.assign(
        { videoId: videoId || '' },
        callbacks
      ));
    }
  }

  // Bascule les DEUX decks vers `target` ('piped' | 'iframe') en préservant
  // vidéo + position + lecture. Aucun mode hybride : les deux decks suivent.
  // Retourne true si la bascule a réussi, false si elle a été abandonnée
  // (Piped injoignable → on reste en IFrame avec un message clair).
  async function switchResolvedMode(target) {
    if (target !== 'piped' && target !== 'iframe') return false;
    if (target === state.resolvedMode) return true;

    // Vers Piped : on vérifie d'abord que Piped est reachable (les instances
    // ont pu tomber depuis le boot). Sinon, bascule abandonnée + message.
    // Un anti-bot sur la vidéo de test ne bloque pas (l'instance est vivante ;
    // la vidéo choisie par l'utilisateur peut très bien passer).
    if (target === 'piped') {
      var pr = await probePiped();
      state.pipedAvailable = pr.reachable;
      updateModeButton();
      if (!pr.reachable) {
        showGlobalError('Instances DJ indisponibles : bascule en mode DJ impossible. Reste en YT IFrame.');
        return false;
      }
    }
    hideGlobalError();

    // Snapshot de l'état des 2 decks avant reconstruction.
    var snapshot = {};
    ['A', 'B'].forEach(function (deck) {
      var p = state.players[deck];
      var ready = state.ready[deck];
      snapshot[deck] = {
        videoId: state.videoIds[deck] || '',
        currentTime: (ready && p && typeof p.getCurrentTime === 'function') ? (p.getCurrentTime() || 0) : 0,
        wasPlaying: (ready && p && typeof p.getPlayerState === 'function'
          && p.getPlayerState() === STATE.PLAYING) || false,
      };
    });

    // Détruit les 2 lecteurs dans l'ancien mode.
    ['A', 'B'].forEach(teardownPlayer);

    // Applique le nouveau mode (mixer + CSS + alerte).
    state.resolvedMode = target;
    Mixer.setMode(target);
    applyModeBodyClass(target);
    hidePipedFallbackAlert();

    // Recrée les 2 lecteurs dans le mode cible (avec restauration).
    ['A', 'B'].forEach(function (deck) {
      createDeckPlayer(deck, snapshot[deck].videoId, snapshot[deck]);
    });

    updateModeButton();
    syncSettingsModeSelect();
    Mixer.applyVolumes();
    // Visualiseurs : démarrés uniquement en mode Piped (besoin d'AnalyserNode).
    if (target === 'piped') startVisualizers(); else stopVisualizers();
    // Le badge de mode (Piped/IFrame) change immédiatement à la bascule : on
    // rafraîchit le now-playing tout de suite (les métadonnées détaillées
    // arriveront au onReady du nouveau lecteur).
    ['A', 'B'].forEach(function (deck) { updateNowPlaying(deck); });
    return true;
  }

  function hideGlobalError() {
    var banner = document.getElementById('api-error-banner');
    if (banner) banner.hidden = true;
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

    // En mode Piped, loadVideoById ne joue pas auto (pendingPlay). On
    // demande explicitement la lecture à la prochaine frame "canplay" via
    // le mécanisme prévu par audio-player (_pendingPlayRequested). En mode
    // IFrame, loadVideoById joue nativement.
    if (state.playerType[deck] === 'piped' && '_pendingPlayRequested' in player) {
      player._pendingPlayRequested = true;
    }
    player.loadVideoById(videoId);

    // Activer le son systématiquement au changement de vidéo
    setDeckMuted(deck, false);

    hidePlaceholder(deck);
    clearDeckError(deck);

    // Rafraîchir le now-playing : en Piped l'entry vient d'être mise en cache
    // par loadVideoById (titre/uploader/miniature) ; en IFrame, la videoData
    // est disponible après ready.
    updateNowPlaying(deck);
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

  // ===== Contrôles DJ par voie (EQ 3 bandes + filtre DJ) — phase 6 =====
  //
  // Visible uniquement en mode Piped (Web Audio DSP). En IFrame, pas de DSP
  // possible → le bloc .deck-dj reste masqué (CSS body.mode-iframe).
  // On câble les faders EQ (low/mid/high, -12..+12 dB) et le knob filtre DJ
  // (-1..+1) vers AudioEngine.setEQ / setDjFilter, avec :
  //   - double-clic = reset à 0 (EQ neutre / filtre bypass)
  //   - persistance localStorage (EQ_*_A/B, DJ_FILTER_A/B)
  //   - restauration au chargement + ré-application après bascule de mode
  //     (l'AudioContext recrée les nœuds, il faut repousser les valeurs).

  var EQ_BANDS = ['low', 'mid', 'high'];

  function eqStorageKey(deck, band) {
    return CFG.STORAGE_KEYS['EQ_' + band.toUpperCase() + '_' + deck];
  }

  function djFilterStorageKey(deck) {
    return CFG.STORAGE_KEYS['DJ_FILTER_' + deck];
  }

  // Lit la valeur persistée d'une bande d'EQ (number, défaut 0).
  function loadEqValue(deck, band) {
    try {
      var v = localStorage.getItem(eqStorageKey(deck, band));
      if (v !== null) return parseFloat(v) || 0;
    } catch (e) { /* ignore */ }
    return 0;
  }

  function loadDjFilterValue(deck) {
    try {
      var v = localStorage.getItem(djFilterStorageKey(deck));
      if (v !== null) return (parseFloat(v) || 0) / 100; // stocké en -100..+100
    } catch (e) { /* ignore */ }
    return 0;
  }

  // Pousse une valeur d'EQ vers l'AudioEngine + met à jour le fader DOM.
  function applyEq(deck, band, value) {
    var fader = document.querySelector(
      '.deck-dj[data-deck="' + deck + '"] .dj-band[data-band="' + band + '"] .dj-fader');
    if (fader) fader.value = value;
    if (AudioEngine && AudioEngine.hasDeck(deck)) {
      try { AudioEngine.setEQ(deck, band, value); } catch (e) { /* deck pas prêt */ }
    }
  }

  function applyDjFilter(deck, position) {
    var knob = document.querySelector('.deck-dj[data-deck="' + deck + '"] .dj-knob');
    if (knob) knob.value = Math.round(position * 100);
    if (AudioEngine && AudioEngine.hasDeck(deck)) {
      try { AudioEngine.setDjFilter(deck, position); } catch (e) { /* deck pas prêt */ }
    }
  }

  // Restore toutes les valeurs DJ persistées d'un deck vers l'AudioEngine.
  // Appelé après création de la chaîne (onReady) et après bascule de mode.
  function restoreDeckDj(deck) {
    EQ_BANDS.forEach(function (band) { applyEq(deck, band, loadEqValue(deck, band)); });
    applyDjFilter(deck, loadDjFilterValue(deck));
  }

  function persistEq(deck, band, value) {
    try { localStorage.setItem(eqStorageKey(deck, band), String(value)); } catch (e) { /* ignore */ }
  }

  function persistDjFilter(deck, position) {
    try { localStorage.setItem(djFilterStorageKey(deck), String(Math.round(position * 100))); } catch (e) { /* ignore */ }
  }

  function wireDeckDj(deck) {
    var root = document.querySelector('.deck-dj[data-deck="' + deck + '"]');
    if (!root) return;

    // --- Faders EQ ---
    EQ_BANDS.forEach(function (band) {
      var fader = root.querySelector('.dj-band[data-band="' + band + '"] .dj-fader');
      if (!fader) return;
      // Valeur initiale depuis le localStorage (cohérence au reload).
      fader.value = loadEqValue(deck, band);

      fader.addEventListener('input', function () {
        var v = parseFloat(fader.value) || 0;
        applyEq(deck, band, v);
        persistEq(deck, band, v);
      });
      // Double-clic = reset à 0 (EQ neutre)
      fader.addEventListener('dblclick', function () {
        fader.value = 0;
        applyEq(deck, band, 0);
        persistEq(deck, band, 0);
      });
    });

    // --- Knob filtre DJ ---
    var knob = root.querySelector('.dj-knob');
    if (knob) {
      knob.value = Math.round(loadDjFilterValue(deck) * 100);
      knob.addEventListener('input', function () {
        var pos = (parseFloat(knob.value) || 0) / 100;
        applyDjFilter(deck, pos);
        persistDjFilter(deck, pos);
      });
      knob.addEventListener('dblclick', function () {
        knob.value = 0;
        applyDjFilter(deck, 0);
        persistDjFilter(deck, 0);
      });
    }
  }

  // ===== UI de transport par voie (deck-controls.js) =====
  //
  // Rattache la barre de transport (play/pause + seek + temps) et le bloc
  // now-playing du deck. Les accesseurs getPlayer/getReady lisent l'état
  // courant (le wrapper change à chaque bascule de mode), donc la même
  // instance de contrôleur reste valide en Piped comme en IFrame.
  function wireDeckTransport(deck) {
    if (!DeckTransport) return;
    DeckTransport.bind(deck, {
      getPlayer: function () { return state.players[deck]; },
      getReady: function () { return !!state.ready[deck]; },
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
      // Le bouton PipedSearch n'est visible que si une clé API est présente.
      syncAllModeButtons();
    }

    // Met à jour l'état des boutons de mode de recherche (visibilité + label)
    // sur les deux voies. Appelé quand la clé API change.
    function syncAllModeButtons() {
      ['A', 'B'].forEach(function (deck) {
        const s = state.searches[deck];
        if (s && typeof s.syncModeButton === 'function') s.syncModeButton();
      });
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
      syncSettingsModeSelect();
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
      else showStatus('Clé supprimée. La recherche par mot-clé est désactivée (mode URL/ID uniquement).', true);
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

  async function init() {
    wireMuteButton('A');
    wireMuteButton('B');
    // Reflète l'état mute par défaut (non muté) sur les boutons au démarrage.
    updateMuteButtonUI('A');
    updateMuteButtonUI('B');
    wireDeckTransport('A');
    wireDeckTransport('B');
    wireDeckDj('A');
    wireDeckDj('B');
    wireSearch('A');
    wireSearch('B');
    initSettingsModal();
    initStepControls();
    wireModeButton();
    wireSettingsModeSelect();
    wireFallbackAlert();

    // L'API IFrame est chargée en arrière-plan (utile si l'utilisateur
    // bascule en IFrame, ou si le mode résolu est IFrame).
    window.YTWrapper.init(function (apiErrorMessage) {
      showGlobalError(apiErrorMessage);
    });

    // Lecture du mode persisté + résolution.
    state.playerMode = loadPlayerMode();
    var resolved = state.playerMode;

    if (resolved === 'auto') {
      const pr = await probePiped();
      state.pipedAvailable = pr.reachable;
      // Vidéo de test bloquée (anti-bot) → on démarre en IFrame (plus sûr :
      // les vidéos de test y jouent). Le bouton reste actif (Piped reachable)
      // pour tenter d'autres titres.
      resolved = pr.playable ? 'piped' : 'iframe';
    } else if (resolved === 'piped') {
      // Mode Piped forcé : si Piped n'est pas reachable au boot, repli IFrame.
      const pr = await probePiped();
      state.pipedAvailable = pr.reachable;
      if (!pr.reachable) {
        showGlobalError('Mode DJ demandé mais instances indisponibles : passage en YT IFrame.');
        resolved = 'iframe';
      }
    } else {
      // Mode IFrame forcé : on sonde Piped en arrière-plan pour mettre à jour
      // l'état du bouton (sans bloquer le démarrage).
      probePiped().then(function (pr) {
        state.pipedAvailable = pr.reachable;
        updateModeButton();
      });
    }

    state.resolvedMode = resolved;
    applyModeBodyClass(resolved);
    Mixer.setMode(resolved);
    Mixer.init(state.players);

    // Restaurer les derniers videoIds depuis localStorage, fallback sur les vidéos de test
    var videoIdA = getPersistedVideoId('A') || CFG.TEST_VIDEO_A;
    var videoIdB = getPersistedVideoId('B') || CFG.TEST_VIDEO_B;
    createDeckPlayer('A', videoIdA);
    createDeckPlayer('B', videoIdB);

    updateModeButton();
    syncSettingsModeSelect();

    // Démarre la boucle de rafraîchissement de la barre de transport (seek +
    // temps) une fois que les joueurs existent. wireDeckTransport a déjà
    // rattaché les contrôleurs ci-dessus.
    if (DeckTransport) DeckTransport.start();

    // Visualiseurs : démarrés en mode Piped (les canvas sont masqués en IFrame).
    if (state.resolvedMode === 'piped') startVisualizers();

    // Recalcule les backing stores des canvas au redimensionnement de fenêtre.
    window.addEventListener('resize', function () {
      if (Visualizer) Visualizer.resizeAll();
    });
  }

  // Exposer pour debug console
  window.state = state;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

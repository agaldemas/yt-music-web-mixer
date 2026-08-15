/* local.js — Binding des boutons d'import de fichiers locaux
 *
 * Branche les boutons « Fichier local » des decks A et B sur le player
 * audio existant (state.players[deck]). Lit le File en mémoire (pas de réseau)
 * → même pipeline que YouTube : ArrayBuffer → Blob (lecture) + décodage scratch.
 *
 * Dépendances : window.state.players[deck] (créés par app.js), window.AudioPlayer.
 */

(function (global) {
  'use strict';

  // Récupère le player d'un deck SANS le recréer. Le player est créé une seule
  // fois par app.js (initDeck). On y accède au moment du clic (les boutons
  // peuvent être câblés avant que state.players soit peuplé).
  function getPlayer(deckId) {
    var s = global.state;
    if (s && s.players && s.players[deckId] && typeof s.players[deckId].loadLocalFile === 'function') {
      return s.players[deckId];
    }
    return null;
  }

  function bindLocalLoadBtn(deckId, btnElement) {
    if (!btnElement) return;

    var existingHandler = btnElement.getAttribute('data-handler');
    if (existingHandler === 'local.js') return;
    btnElement.setAttribute('data-handler', 'local.js');

    btnElement.addEventListener('click', function () {
      // showOpenFilePicker (Chrome 86+) → renvoie un FileSystemFileHandle
      // dont .getFile() donne le File. Sinon, input[type=file] masqué.
      var filePicker = global.showOpenFilePicker || null;
      if (filePicker) {
        filePicker({
          types: [{
            description: 'Audio et vidéo',
            accept: {
              'audio/*': ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'],
              'video/*': ['.mp4', '.webm']
            }
          }],
          multiple: false,
          excludeAcceptAllOption: true
        }).then(function (handlesArray) {
          var handle = handlesArray && handlesArray[0];
          if (!handle) return;
          return handle.getFile();
        }).then(function (file) {
          if (!file) return;
          var player = getPlayer(deckId);
          if (!player) {
            console.warn('local.js: player du deck ' + deckId + ' non disponible (mode IFrame ?)');
            return;
          }
          btnElement.disabled = true;
          player.loadLocalFile(file).then(function () {
            btnElement.disabled = false;
          }, function (err) {
            btnElement.disabled = false;
            console.error('local.js: loadLocalFile échec —', err && err.message || err);
          });
        }).catch(function (err) {
          // Annulé par l'utilisateur ou erreur (AbortError = annulation, sans gravité)
          btnElement.disabled = false;
          if (err && err.name !== 'AbortError') {
            console.warn('local.js: Erreur chargement local - ' + (err.message || err));
          }
        });
      } else {
        // Fallback : input[type=file] masqué (Firefox/Safari < 86)
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = 'audio/*,video/*';
        input.onchange = function () {
          var file = input.files && input.files[0];
          if (!file) return;
          var player = getPlayer(deckId);
          if (!player) {
            console.warn('local.js: player du deck ' + deckId + ' non disponible (mode IFrame ?)');
            return;
          }
          btnElement.disabled = true;
          player.loadLocalFile(file).then(function () {
            btnElement.disabled = false;
          }, function (err) {
            btnElement.disabled = false;
            console.error('local.js: loadLocalFile échec —', err && err.message || err);
          });
        };
        input.click();
      }
    });
  }

  // Câble les boutons dès le chargement du script (ils existent dans le HTML).
  // Si un bouton n'existe pas encore, on réessaie au DOMContentLoaded.
  function wireAll() {
    var btnA = document.getElementById('deck-load-local-a');
    var btnB = document.getElementById('deck-load-local-b');
    if (btnA) bindLocalLoadBtn('A', btnA);
    if (btnB) bindLocalLoadBtn('B', btnB);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireAll);
  } else {
    wireAll();
  }
})(window);

/* local-load.js — Binding des boutons d'import de fichiers locaux
 *
 * Branche les boutons « Fichier local » des decks A et B sur le player
 * audio existant (state.players[deck]). Lit le File en mémoire (pas de réseau)
 * → même pipeline que YouTube : ArrayBuffer → Blob (lecture) + décodage scratch.
 *
 * Dépendances : window.state.players[deck] (créés par app.js), window.AudioPlayer.
 */

(function () {
  'use strict';

  // ===== Fonctions d'extraction de métadonnées ID3 =====

  // Récupère le player d'un deck SANS le recréer. Le player est créé une seule
  // fois par app.js (initDeck). On y accède au moment du clic (les boutons
  // peuvent être câblés avant que state.players soit peuplé).
  function loadFile(deckId, file) {
    if (window.YTMixerApp && typeof window.YTMixerApp.loadLocalFile === 'function') {
      return window.YTMixerApp.loadLocalFile(deckId, file);
    }
    var s = window.state;
    var player = s && s.players && s.players[deckId];
    if (player && typeof player.loadLocalFile === 'function') return player.loadLocalFile(file);
    return Promise.reject(new Error('Lecteur local indisponible.'));
  }

  function bindLocalLoadBtn(deckId, btnElement) {
    if (!btnElement) return;

    var existingHandler = btnElement.getAttribute('data-handler');
    if (existingHandler === 'local-load.js') return;
    btnElement.setAttribute('data-handler', 'local-load.js');

    btnElement.addEventListener('click', function () {
      // showOpenFilePicker (Chrome 86+) → renvoie un FileSystemFileHandle
      // dont .getFile() donne le File. Sinon, input[type=file] masqué.
      var filePicker = window.showOpenFilePicker || null;
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
          btnElement.disabled = true;
          loadFile(deckId, file).then(function () {
            btnElement.disabled = false;
          }, function (err) {
            btnElement.disabled = false;
            console.error('local-load.js: loadLocalFile échec —', err && err.message || err);
          });
        }).catch(function (err) {
          btnElement.disabled = false;
          if (err && err.name !== 'AbortError') console.warn('local-load.js: Erreur chargement local - ' + (err.message || err));
        });
      } else {
        // Fallback : input[type=file] masqué (Firefox/Safari < 86)
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = 'audio/*,video/*';
        input.onchange = function () {
          var file = input.files && input.files[0];
          if (!file) return;
          btnElement.disabled = true;
          loadFile(deckId, file).then(function () {
            btnElement.disabled = false;
          }, function (err) {
            btnElement.disabled = false;
            console.error('local-load.js: loadLocalFile échec —', err && err.message || err);
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
})();

// ===== API publique d'extraction de métadonnées ID3 =====

/**
 * Extraire les métadonnées d'un fichier audio depuis les tags ID3
 * @returns {Object} { title, artist }
 */
function extractAudioMetadata(buf, mime, fileName) {
  if (window.ID3 && typeof window.ID3.metadata === 'function') return window.ID3.metadata(buf, fileName);
  return { title: fileName || '', artist: '' };
}

/**
 * Extraire l'image de cover (ID3 picture frame 'APIC')
 */
function extractCoverImage(buf, mime) {
  if (!window.ID3 || typeof window.ID3.picture !== 'function') return null;
  var picture = window.ID3.picture(buf);
  if (!picture || !picture.bytes || !picture.bytes.length) return null;
  return URL.createObjectURL(new Blob([picture.bytes], { type: picture.mime }));
}

// Exposons les fonctions à window pour utilisation depuis audio-player.js
window.extractAudioMetadata = extractAudioMetadata;
window.extractCoverImage = extractCoverImage;

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
  function getPlayer(deckId) {
    var s = window.state;
    if (s && s.players && s.players[deckId] && typeof s.players[deckId].loadLocalFile === 'function') {
      return s.players[deckId];
    }
    return null;
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
          var player = getPlayer(deckId);
          if (!player) {
            console.warn('local-load.js: player du deck ' + deckId + ' non disponible (mode IFrame ?)');
            return;
          }
          btnElement.disabled = true;
          player.loadLocalFile(file).then(function () {
            btnElement.disabled = false;
          }, function (err) {
            btnElement.disabled = false;
            console.error('local-load.js: loadLocalFile échec —', err && err.message || err);
          });
        }).catch(function (err) {
          // Annulé par l'utilisateur ou erreur (AbortError = annulation, sans gravité)
          btnElement.disabled = false;
          if (err && err.name !== 'AbortError') {
            console.warn('local-load.js: Erreur chargement local - ' + (err.message || err));
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
            console.warn('local-load.js: player du deck ' + deckId + ' non disponible (mode IFrame ?)');
            return;
          }
          btnElement.disabled = true;
          player.loadLocalFile(file).then(function () {
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
  if (!buf) return { title: fileName, artist: '' };
  var data = (buf instanceof Uint8Array) ? buf : new Uint8Array(buf);
  if (data.byteLength < 10) return { title: fileName, artist: '' };

  try {
    if (data[0] !== 0x49 || data[1] !== 0x44 || data[2] !== 0x33) return { title: fileName, artist: '' };

    var pos = 10;
    var result = { title: null, artist: null };

    while (pos + 10 < data.byteLength) {
      var id = String.fromCharCode(data[pos], data[pos+1], data[pos+2], data[pos+3]);
      var size = (data[pos+4] << 24) | (data[pos+5] << 16) | (data[pos+6] << 8) | data[pos+7];

      if (id === 'TIT2') {
        var titleData = data.slice(pos + 10, pos + 10 + size);
        result.title = new TextDecoder('utf-8').decode(titleData).trim();
      } else if (id === 'TPE1') {
        var artistData = data.slice(pos + 10, pos + 10 + size);
        result.artist = new TextDecoder('utf-8').decode(artistData).trim();
      }
      pos += 10 + size;
      if (result.title && result.artist) break;
    }
    return {
      title: result.title || fileName,
      artist: result.artist || ''
    };
  } catch (e) {
    return { title: fileName, artist: '' };
  }
}

/**
 * Extraire l'image de cover (ID3 picture frame 'APIC')
 */
function extractCoverImage(buf, mime) {
  if (!buf) return null;
  var data = (buf instanceof Uint8Array) ? buf : new Uint8Array(buf);
  if (data.byteLength < 10) return null;

  try {
    if (data[0] !== 0x49 || data[1] !== 0x44 || data[2] !== 0x33) return null;

    var pos = 10;
    while (pos + 10 < data.byteLength) {
      var id = String.fromCharCode(data[pos], data[pos+1], data[pos+2], data[pos+3]);
      var size = (data[pos+4] << 24) | (data[pos+5] << 16) | (data[pos+6] << 8) | data[pos+7];

      if (id === 'APIC') {
        var offset = pos + 10;
        // Format APIC: encoding(1), mime(0-30), type(1), description(0-254), data
        var mimePos = offset + 1;
        while (mimePos < data.byteLength && data[mimePos] !== 0) mimePos++;
        var typePos = mimePos + 1;
        var descPos = typePos + 1;
        while (descPos < data.byteLength && data[descPos] !== 0) descPos++;
        var imageDataPos = descPos + 1;
        var imageDataLen = (pos + 10 + size) - imageDataPos;

        if (imageDataLen > 0) {
          var imageData = data.slice(imageDataPos, pos + 10 + size);
          return URL.createObjectURL(new Blob([imageData], { type: 'image/jpeg' }));
        }
      }
      pos += 10 + size;
    }
  } catch (e) {}
  return null;
}

// Exposons les fonctions à window pour utilisation depuis audio-player.js
window.extractAudioMetadata = extractAudioMetadata;
window.extractCoverImage = extractCoverImage;

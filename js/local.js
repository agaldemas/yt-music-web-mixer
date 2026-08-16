/* local.js — Binding des boutons d'import de fichiers locaux
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
    if (existingHandler === 'local.js') return;
    btnElement.setAttribute('data-handler', 'local.js');

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
})();

// ===== API publique d'extraction de métadonnées ID3 =====

/**
 * Extraire le titre d'un fichier audio depuis les tags ID3
 * @param {ArrayBuffer} buf - Buffer du fichier audio
 * @param {string} mime - Type MIME du fichier
 * @param {string} fileName - Nom du fichier (fallback)
 * @returns {string} Titre extrait ou fallback
 */
function extractAudioMetadata(buf, mime, fileName) {
  if (buf.byteLength < 100) return fileName;

  // Recherche du tag ID3v2 en début de fichier
  var id3v2Signature = [0x49, 0x44, 0x33]; // "ID3"
  var positions = [];
  for (var i = 0; i < buf.byteLength - 3; i++) {
    if (buf[i] === 0x49 && buf[i+1] === 0x44 && buf[i+2] === 0x33) {
      // Version major (octet suivant), vérifier ID3v2.3 ou 2.4
      if (i + 4 < buf.byteLength && buf[i+3] >= 0x04 && buf[i+3] <= 0x06) {
        positions.push(i);
      }
    }
  }

  var title = fileName;
  // Si trouvé, tente de lire le titre (frame TIT1 ou TIT2)
  if (positions.length > 0) {
    try {
      var pos = positions[0];
      if (pos + 6 < buf.byteLength) {
        var sizeBuf = buf.subarray(pos + 4, pos + 6);
        var size = (sizeBuf[0] & 0x7F) | ((sizeBuf[1] & 0x7F) << 8);
        if (pos + 6 + size < buf.byteLength && size > 0 && size < 65536) {
          var frameData = buf.subarray(pos + 6, pos + 6 + size);
          // Premier octet = type de frame
          var frameType = frameData[0];
          var frameBytes = frameData.subarray(1);

          if (frameType === 0x54) { // TITX (titre)
            // UTF-16BE ou ISO-8859-1 selon l'octet de langue/encodage (pos 3)
            var encOct = frameBytes[3];
            var isUtf16 = (encOct & 0x80) !== 0;
            // Longueur de la chaîne (pos 4), ignorée, on utilise la taille du frame
            try {
              title = new TextDecoder(isUtf16 ? 'utf-16be' : 'iso-8859-1').decode(frameBytes);
              title = title.trim();
            } catch (e) {
              title = fileName;
            }
          }
        }
      }
    } catch (e) { /* ignore */ }
  }

  // Fallback simple : utiliser le nom du fichier sans extension
  var nameWithoutExt = fileName.replace(/\.[^\.]+$/, '');
  return title || nameWithoutExt;
}

/**
 * Extraire l'image de cover (ID3 picture frame)
 * @param {ArrayBuffer} buf - Buffer du fichier audio
 * @param {string} mime - Type MIME du fichier
 * @returns {string|null} Blob URL de l'image ou null
 */
function extractCoverImage(buf, mime) {
  if (buf.byteLength < 50) return null;

  var id3v2Signature = [0x49, 0x44, 0x33];
  var positions = [];
  for (var i = 0; i <= buf.byteLength - 3; i++) {
    if (buf[i] === 0x49 && buf[i+1] === 0x44 && buf[i+2] === 0x33) {
      if (i + 4 < buf.byteLength && buf[i+3] >= 0x04 && buf[i+3] <= 0x06) {
        positions.push(i);
      }
    }
  }

  if (positions.length === 0) return null;

  try {
    var pos = positions[0];
    if (pos + 10 < buf.byteLength) {
      // Lecture du nombre de frames suivant l'en-tête ID3
      var numFrames = (buf[pos+6] & 0x7F) | ((buf[pos+7] & 0x7F) << 8);
      if (numFrames > 10) return null; // trop de frames, éviter le dépassement

      var frameIdx = 0;
      var offset = pos + 10;
      while (frameIdx < numFrames && offset + 10 <= buf.byteLength) {
        if (buf[offset] === 0x54) { // Frame TITX (titre)
          frameIdx++;
        } else if (buf[offset] === 0xF0) { // Picture frame
          var pictSize = (buf[offset+1] & 0x7F) | ((buf[offset+2] & 0x7F) << 8) |
                         ((buf[offset+3] & 0x7F) << 16) |
                         ((buf[offset+4] & 0x7F) << 24);
          if (pictSize > 0 && pictSize < 1024*1024) {
            var pictureData = buf.subarray(offset + 5, offset + 5 + pictSize);
            // Premier octet = type d'image (1=PNG, 2=JPEG, etc.)
            var imgType = pictureData[0];
            if (imgType === 1 || imgType === 2) { // PNG ou JPEG
              var mimeImg = (imgType === 1) ? 'image/png' : 'image/jpeg';
              var blob = new Blob([pictureData], { type: mimeImg });
              return URL.createObjectURL(blob);
            }
          }
          frameIdx++;
        } else {
          // Skip la taille + type + encodage + langue + copyright + description
          offset += 5 + ((buf[offset+1] & 0x7F) | ((buf[offset+2] & 0x7F) << 8));
        }
      }
    }
  } catch (e) { /* ignore */ }

  return null;
}

// Exposons les fonctions à window pour utilisation depuis audio-player.js
window.extractAudioMetadata = extractAudioMetadata;
window.extractCoverImage = extractCoverImage;

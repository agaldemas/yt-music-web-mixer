/* local-save.js — Sauvegarde locale du MP3 en cours (mode DJ)
 *
 * Fonctions :
 *   LocalSave.buildSaveFilename(title, artist)  → "<titre>-<artiste>.mp3"
 *   LocalSave.saveCurrentDj(deck)               → sauvegarde via showSaveFilePicker ou <a download>
 *   LocalSave.updateSaveButtonState(deck)        → active/désactive le bouton selon l'état du deck
 *
 * Le bouton "Save local" est dans .deck-local-row, à droite de "Load local".
 * État :
 *   - piped + videoId chargé → actif
 *   - local                 → désactivé (fichier déjà local)
 *   - iframe / aucune source → désactivé
 */

(function () {
  'use strict';

  // ===== Fonction utilitaire de nom de fichier =====
  // buildSaveFilename(title, artist) → "<titre>-<artiste>.mp3"
  // Nettoie les caractères interdits en nom de fichier, conserve les accents,
  // remplace les espaces multiples, tronque à 200 caractères.
  // Si artiste est vide, retourne "<titre>.mp3".
  function buildSaveFilename(title, artist) {
    var clean = function (s) {
      return String(s || '')
        .replace(/[/\\:*?"<>|]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200);
    };
    var base = artist ? (clean(title) + '-' + clean(artist)) : clean(title);
    return (base || 'audio') + '.mp3';
  }

  // ===== Récupération des métadonnées du deck =====
  // Lit le cache PipedStreams pour obtenir le titre et l'artiste.
  function getDeckMeta(deck) {
    var s = window.state;
    if (!s) return { videoId: null };
    var videoId = s.videoIds && s.videoIds[deck];
    if (!videoId) return { videoId: null };

    var entry = null;
    if (window.PipedStreams && typeof window.PipedStreams.getCachedStream === 'function') {
      try { entry = window.PipedStreams.getCachedStream(videoId); } catch (e) { /* ignore */ }
    }
    return {
      videoId: videoId,
      title: (entry && entry.title) || '',
      artist: (entry && entry.uploader) || '',
    };
  }

  // ===== Sauvegarde du morceau en cours (mode DJ) =====
  // Utilise showSaveFilePicker quand disponible, sinon <a download>.
  function saveCurrentDj(deck) {
    var s = window.state;
    if (!s) return;
    var meta = getDeckMeta(deck);
    if (!meta.videoId) return;

    var filename = buildSaveFilename(meta.title, meta.artist);
    var url = '/api/download/' + meta.videoId;
    var btn = document.getElementById('deck-save-local-' + deck.toLowerCase());

    if (btn) btn.disabled = true;

    // showSaveFilePicker (Chrome 86+)
    if (window.showSaveFilePicker) {
      window.showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: 'Fichier audio MP3',
          accept: { 'audio/mpeg': ['.mp3'] },
        }],
        excludeAcceptAllOption: false,
      }).then(function (handle) {
        return fetch(url).then(function (resp) {
          if (!resp.ok) throw new Error('Erreur serveur : ' + resp.status);
          return resp.blob();
        }).then(function (blob) {
          return handle.createWritable().then(function (writer) {
            return writer.write(blob).then(function () { return writer.close(); });
          });
        });
      }).then(function () {
        console.debug('[local-save] ✓ Sauvegarde terminée — ' + filename);
      }).catch(function (err) {
        if (err.name !== 'AbortError' && err.name !== 'SecurityError') {
          console.warn('[local-save] Échec sauvegarde :', err.message || err);
        }
      }).finally(function () {
        if (btn) btn.disabled = false;
      });
    } else {
      // Fallback : <a download> classique (Firefox, Safari < 86)
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { document.body.removeChild(a); }, 1000);
    }
  }

  // ===== Mise à jour de l'état du bouton "Save local" =====
  function updateSaveButtonState(deck) {
    var btn = document.getElementById('deck-save-local-' + deck.toLowerCase());
    if (!btn) return;
    var s = window.state;
    if (!s) { btn.disabled = true; return; }

    var pType = s.playerType && s.playerType[deck];
    var videoId = s.videoIds && s.videoIds[deck];

    if (pType === 'piped' && videoId) {
      btn.disabled = false;
      btn.title = 'Sauvegarder le MP3 en cours sur le disque';
    } else {
      btn.disabled = true;
      if (pType === 'local') {
        btn.title = 'Fichier déjà local, rien à sauvegarder';
      } else if (pType === 'iframe') {
        btn.title = 'Sauvegarde YouTube disponible en mode DJ (basculez en mode DJ)';
      } else {
        btn.title = 'Aucune source chargée';
      }
    }
  }

  // ===== Branchement des boutons =====
  function wireAll() {
    var btnA = document.getElementById('deck-save-local-a');
    var btnB = document.getElementById('deck-save-local-b');
    if (btnA) {
      btnA.addEventListener('click', function () { saveCurrentDj('A'); });
      updateSaveButtonState('A');
    }
    if (btnB) {
      btnB.addEventListener('click', function () { saveCurrentDj('B'); });
      updateSaveButtonState('B');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireAll);
  } else {
    wireAll();
  }

  // ===== API publique =====
  window.LocalSave = {
    buildSaveFilename: buildSaveFilename,
    saveCurrentDj: saveCurrentDj,
    updateSaveButtonState: updateSaveButtonState,
  };
})();
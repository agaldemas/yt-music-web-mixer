/* local-save.js — Sauvegarde du MP3 en cache, sans agir sur le lecteur. */

(function () {
  'use strict';



  var checks = {};
  var saving = new Set();

  function saveButton(deck) {
    return document.getElementById('deck-save-local-' + deck.toLowerCase());
  }

  function currentVideoId(deck) {
    var s = window.state;
    if (!s || (s.sourceKind && s.sourceKind[deck] === 'local')) return '';
    return (s.videoIds && s.videoIds[deck]) || '';
  }

  function renderSaveButton(deck) {
    var btn = saveButton(deck);
    if (!btn) return;
    var check = checks[deck];
    var busy = saving.has(deck);
    btn.disabled = busy || !check || !check.ready;
    btn.title = busy ? 'Sauvegarde en cours…'
      : !check ? 'Aucune vidéo YouTube chargée'
      : check.ready ? 'Sauvegarder le MP3 en cache'
      : 'MP3 pas encore disponible dans le cache local';
  }

  function updateSaveButtonState(deck, info, retry) {
    var api = window.LocalAPI;
    var id = api && api.available() ? currentVideoId(deck) : '';
    var check = checks[deck];
    if (!id || !check || check.id !== id) {
      if (check && check.controller) check.controller.abort();
      check = checks[deck] = id ? { id: id, ready: false, controller: null } : null;
    }
    if (check && info && info.id === id) check.info = info;
    renderSaveButton(deck);
    if (!check || check.ready || check.controller || (check.checked && !retry)) return;
    check.checked = true;

    var controller = check.controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, 5000);
    // HEAD vérifie le disque sans télécharger ni lancer une extraction.
    return api.fetch('/api/download-ready/' + encodeURIComponent(id), {
      method: 'HEAD', cache: 'no-store', signal: controller.signal,
    }).then(function (res) {
      check.ready = res.status === 200;
    }).catch(function () {
      check.ready = false;
    }).finally(function () {
      clearTimeout(timeout);
      check.controller = null;
      if (check === checks[deck] && id === currentVideoId(deck)) renderSaveButton(deck);
    });
  }

  function saveCurrent(deck) {
    var check = checks[deck];
    if (!check || !check.ready || currentVideoId(deck) !== check.id || saving.has(deck)) return;

    var info = check.info || {};
    var filename = window.buildMp3Filename(info.title, info.uploader, check.id);
    var url = '/api/download/' + encodeURIComponent(check.id);
    saving.add(deck);
    renderSaveButton(deck);

    function fetchMp3() {
      return window.LocalAPI.fetch(url).then(function (resp) {
        if (!resp.ok) {
          if (resp.status === 404) check.ready = false;
          throw new Error('Erreur serveur : ' + resp.status);
        }
        return resp;
      });
    }

    // Laisse le gestionnaire de téléchargements du navigateur écrire le fichier.
    var download = fetchMp3().then(function (resp) { return resp.blob(); }).then(function (blob) {
      var objectUrl = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = objectUrl; a.download = filename; a.style.display = 'none';
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(objectUrl); a.remove(); }, 1000);
    });
    return download.catch(function (err) {
      if (err.name !== 'AbortError' && err.name !== 'SecurityError') {
        console.warn('[local-save] Échec sauvegarde :', err.message || err);
      }
    }).finally(function () {
      saving.delete(deck);
      renderSaveButton(deck);
    });
  }

  // ===== Branchement des boutons =====
  function wireAll() {
    var decks = ['A', 'B'].filter(function (deck) { return saveButton(deck); });
    decks.forEach(function (deck) {
      saveButton(deck).addEventListener('click', function () { saveCurrent(deck); });
      updateSaveButtonState(deck);
    });
    if (decks.length) setInterval(function () {
      decks.forEach(function (deck) { updateSaveButtonState(deck, null, true); });
    }, 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireAll);
  } else {
    wireAll();
  }

  // ===== API publique =====
  window.LocalSave = {
    saveCurrent: saveCurrent,
    updateSaveButtonState: updateSaveButtonState,
  };
})();
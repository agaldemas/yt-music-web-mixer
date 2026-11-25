// tests/test_search_panel.js — Régressions du panneau de recherche.
//
// 1) Panneau replié (bouton ▲) puis nouvelle recherche : les résultats
//    doivent s'afficher. Avant le fix, `is-collapsed` restait en place et le
//    panneau restait `display:none` → l'utilisateur croyait la recherche
//    bloquée et devait recharger la page.
// 2) API YouTube Data injoignable (réseau / CSP / proxy) : la recherche doit
//    retomber sur Piped au lieu d'afficher une erreur morte.
// 3) Les échecs explicites de l'API (400 clé invalide, 403 quota) restent
//    des erreurs dédiées : pas de repli silencieux.
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
function ok(cond, label) {
  if (cond) { console.log('OK   : ' + label); return; }
  failures += 1;
  console.log('FAIL : ' + label);
}

const DECK_HTML = `
  <div class="deck" data-deck="A">
    <input class="search-input" data-deck="A" />
    <button class="search-btn" data-deck="A">OK</button>
    <div class="deck-results" data-deck="A" data-state="idle"></div>
  </div>`;

// Réponse Piped minimale (2 vidéos, pas de page suivante).
const PIPED_BODY = JSON.stringify({
  items: [
    { url: '/watch?v=AAAAAAAAAAA', title: 'Alpha', uploaderName: 'Chaîne A', duration: 200, thumbnail: 'https://x/1.jpg', isLive: false },
    { url: '/watch?v=BBBBBBBBBBB', title: 'Beta', uploaderName: 'Chaîne B', duration: 180, thumbnail: 'https://x/2.jpg', isLive: false },
  ],
  nextpage: null,
});

function makeDom() {
  const dom = new JSDOM('<!doctype html><html><body>' + DECK_HTML + '</body></html>', {
    url: 'http://127.0.0.1:5400/',
    runScripts: 'outside-only',
  });
  const win = dom.window;
  win.eval(fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8'));
  win.eval(fs.readFileSync(path.join(ROOT, 'js/search.js'), 'utf8'));
  return win;
}

// fetch factice : `behaviour.google` = 'ok' | 'throw' | { code }
function installFetch(win, behaviour) {
  const calls = { google: 0, piped: 0 };
  win.fetch = function (url) {
    url = String(url);
    if (url.indexOf('googleapis.com') !== -1) {
      calls.google += 1;
      if (behaviour.google === 'throw') {
        return Promise.reject(new TypeError('Failed to fetch (simulé)'));
      }
      const code = behaviour.google;
      if (typeof code === 'number') {
        return Promise.resolve({
          ok: false,
          status: code,
          statusText: 'err',
          json: () => Promise.resolve({ error: { code: code, message: 'simulé' } }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          items: [{ id: { videoId: 'GOOGLEVIDEO' }, snippet: { title: 'Google', channelTitle: 'Ch', thumbnails: {} } }],
          nextPageToken: null,
        }),
      });
    }
    calls.piped += 1;
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(JSON.parse(PIPED_BODY)),
    });
  };
  return calls;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async function main() {
  // --- Test 1 : repli puis nouvelle recherche -----------------------------
  {
    const win = makeDom();
    installFetch(win, { google: 'ok' });
    const search = win.YTSearch.create('A', {});
    const panel = win.document.querySelector('.deck-results[data-deck="A"]');

    search.search('bob marley');
    await wait(30);
    ok(panel.querySelectorAll('.search-result').length === 2, 'T1 : 2 résultats Piped affichés');
    ok(panel.dataset.state === 'results', 'T1 : état = results');

    // Replier via le bouton ▲ de la barre d'outils
    const toggle = win.document.querySelector('.deck-results-toolbar[data-deck="A"] .deck-results-toggle');
    ok(!!toggle, 'T1 : bouton de repli présent');
    toggle.click();
    ok(panel.classList.contains('is-collapsed'), 'T1 : panneau replié après clic ▲');

    // Nouvelle recherche : le panneau doit se déplier et se remplir
    search.search('peter tosh');
    await wait(30);
    ok(!panel.classList.contains('is-collapsed'), 'T1 : nouvelle recherche déplie le panneau');
    ok(panel.querySelectorAll('.search-result').length === 2, 'T1 : résultats de la 2e recherche affichés');
    ok(toggle.textContent === '▲', 'T1 : libellé du bouton revenu à ▲');

    // Le repli manuel doit rester possible après une recherche
    toggle.click();
    ok(panel.classList.contains('is-collapsed'), 'T1 : repli manuel encore fonctionnel');
  }

  // --- Test 2 : API YouTube injoignable → repli Piped ---------------------
  {
    const win = makeDom();
    win.localStorage.setItem('youtubeApiKey', 'AIzaSyFAKE');
    const calls = installFetch(win, { google: 'throw' });
    const search = win.YTSearch.create('A', {});
    const panel = win.document.querySelector('.deck-results[data-deck="A"]');

    search.search('burning spear');
    await wait(30);
    ok(calls.google === 1, 'T2 : l\'API YouTube a bien été tentée');
    ok(calls.piped >= 1, 'T2 : repli sur Piped déclenché');
    ok(panel.dataset.state === 'results', 'T2 : état = results (pas d\'erreur bloquante)');
    ok(panel.querySelectorAll('.search-result').length === 2, 'T2 : résultats Piped affichés');
  }

  // --- Test 3 : 400 clé invalide → erreur dédiée, pas de repli ------------
  {
    const win = makeDom();
    win.localStorage.setItem('youtubeApiKey', 'AIzaSyFAKE');
    const calls = installFetch(win, { google: 400 });
    const search = win.YTSearch.create('A', {});
    const panel = win.document.querySelector('.deck-results[data-deck="A"]');

    search.search('bob marley');
    await wait(30);
    ok(calls.piped === 0, 'T3 : pas de repli Piped sur clé invalide');
    ok(panel.dataset.state === 'error', 'T3 : état = error');
    ok(/Clé API invalide/.test(panel.textContent), 'T3 : message « Clé API invalide »');
  }

  // --- Test 4 : 403 quota → warning non bloquant -------------------------
  {
    const win = makeDom();
    win.localStorage.setItem('youtubeApiKey', 'AIzaSyFAKE');
    installFetch(win, { google: 403 });
    const search = win.YTSearch.create('A', {});
    const panel = win.document.querySelector('.deck-results[data-deck="A"]');

    search.search('bob marley');
    await wait(30);
    ok(panel.dataset.state === 'warning', 'T4 : état = warning sur quota');
    ok(/Quota/.test(panel.textContent), 'T4 : message quota affiché');
  }

  console.log(failures ? `\n❌ ${failures} assertion(s) en échec` : '\nSearch panel: OK');
  process.exit(failures ? 1 : 0);
})();

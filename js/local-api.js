/* local-api.js — session et fetch authentifié vers le backend Express local */
(function () {
  'use strict';

  var tokenPromise = null;
  var healthPromise = null;

  function isHttp() {
    try { return window.location.protocol === 'http:' || window.location.protocol === 'https:'; }
    catch (_) { return false; }
  }

  function isLocalApiUrl(url) {
    if (!isHttp()) return false;
    try {
      var parsed = new URL(url, window.location.href);
      return parsed.origin === window.location.origin && parsed.pathname.indexOf('/api/') === 0;
    } catch (_) { return false; }
  }

  function getToken(force) {
    if (!isHttp()) return Promise.reject(new Error('Backend local indisponible en file://'));
    if (force) tokenPromise = null;
    if (!tokenPromise) {
      tokenPromise = window.fetch('/api/session', { cache: 'no-store', credentials: 'same-origin' })
        .then(function (res) {
          if (!res.ok) throw new Error('Session locale HTTP ' + res.status);
          return res.json();
        })
        .then(function (data) {
          if (!data || !data.token) throw new Error('Jeton local absent');
          return String(data.token);
        })
        .catch(function (err) { tokenPromise = null; throw err; });
    }
    return tokenPromise;
  }

  function authorizedFetch(url, options) {
    options = Object.assign({}, options || {});
    if (!isLocalApiUrl(url) || /\/api\/(session|health|ready)(?:\/|$)/.test(new URL(url, window.location.href).pathname)) {
      return window.fetch(url, options);
    }
    return getToken(false).then(function (token) {
      var headers = new Headers(options.headers || {});
      headers.set('X-Local-Token', token);
      options.headers = headers;
      options.credentials = 'same-origin';
      return window.fetch(url, options).then(function (res) {
        if (res.status !== 403) return res;
        return getToken(true).then(function (fresh) {
          headers.set('X-Local-Token', fresh);
          return window.fetch(url, options);
        });
      });
    });
  }

  function getHealth(force) {
    if (!isHttp()) return Promise.resolve({ ok: false, ready: false, capabilities: { metadata: false, audio: false } });
    if (force) healthPromise = null;
    if (!healthPromise) {
      healthPromise = window.fetch('/api/health', { cache: 'no-store', credentials: 'same-origin' })
        .then(function (res) { return res.ok ? res.json() : Promise.reject(new Error('Health HTTP ' + res.status)); })
        .catch(function () { return { ok: false, ready: false, capabilities: { metadata: false, audio: false } }; });
    }
    return healthPromise;
  }

  window.LocalAPI = {
    available: isHttp,
    fetch: authorizedFetch,
    getToken: getToken,
    getHealth: getHealth,
  };
})();

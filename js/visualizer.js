/* visualizer.js — visualisation temps réel via les AnalyserNode du moteur audio
 *
 * Module de rendering canvas. Deux modes :
 *   - 'spectrum' (défaut) : barres verticales colorées (dégradé bleu→rose pour A,
 *     rose→bleu pour B), hauteur proportionnelle à l'amplitude par bande de
 *     fréquence. Le master utilise un dégradé neutre.
 *   - 'waveform' : ligne de forme d'onde (getByteTimeDomainData), utile pour
 *     voir les beats (pics = transitoires/basses).
 *
 * API :
 *   Visualizer.create(canvas, analyser, { mode, palette, mirror })
 *     → { start(), stop(), setMode(), setAnalyser(), destroy() }
 *   Visualizer.startAll() / stopAll()  : pilote tous les visualizers actifs
 *
 * Performance : requestAnimationFrame (pas setInterval), throttling à ~30 FPS
 * (FFT 2048 = suffisant, évite de saturer le thread principal).
 *
 * Conventions : IIFE, vanilla JS, camelCase, window.Visualizer exposé.
 */

(function () {
  // ~30 FPS max : on saute une frame sur deux d'une boucle 60 FPS standard.
  var FRAME_MS = 1000 / 30;
  // Palette par défaut : dégradé bas→haut (graves→aigus).
  var PALETTES = {
    a: ['#3b82f6', '#60a5fa', '#93c5fd'],   // bleu (voie A)
    b: ['#ec4899', '#f472b6', '#f9a8d4'],   // rose (voie B)
    master: ['#22d3ee', '#a78bfa', '#f472b6'] // cyan→violet→rose (master)
  };

  // Tous les visualizers actifs (pour startAll/stopAll + nettoyage global).
  var instances = [];
  var globalRunning = false;

  // Convertit une chaîne couleur hex "#rrggbb" + alpha → "rgba(r,g,b,a)".
  function hexToRgba(hex, alpha) {
    var h = hex.replace('#', '');
    var r = parseInt(h.substring(0, 2), 16);
    var g = parseInt(h.substring(2, 4), 16);
    var b = parseInt(h.substring(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  // Crée un visualizer lié à un canvas + un AnalyserNode.
  //   canvas  : élément <canvas>
  //   analyser: AnalyserNode (peut être null au départ, fixé via setAnalyser)
  //   options : { mode:'spectrum'|'waveform', palette:['#..',..], mirror:bool,
  //               barCount:number }
  function create(canvas, analyser, options) {
    options = options || {};
    var viz = {
      canvas: canvas,
      ctx: canvas ? canvas.getContext('2d') : null,
      analyser: analyser || null,
      mode: options.mode || 'spectrum',
      palette: options.palette || PALETTES.master,
      mirror: !!options.mirror,
      barCount: options.barCount || 48,
      // Buffers alloués paresseusement selon fftSize de l'analyser.
      freq: null,
      wave: null,
      rafId: null,
      lastFrame: 0,
      running: false,
    };

    // Alloue les buffers Uint8Array à la taille attendue par l'analyser.
    function allocBuffers() {
      if (!viz.analyser) return;
      var bins = viz.analyser.frequencyBinCount; // fftSize / 2
      if (!viz.freq || viz.freq.length !== bins) viz.freq = new Uint8Array(bins);
      if (!viz.wave || viz.wave.length !== viz.analyser.fftSize) {
        viz.wave = new Uint8Array(viz.analyser.fftSize);
      }
    }

    // Gère le DPR (high-DPI) et redimensionne le backing store du canvas.
    function resize() {
      if (!viz.canvas || !viz.ctx) return;
      var dpr = window.devicePixelRatio || 1;
      var w = viz.canvas.clientWidth;
      var h = viz.canvas.clientHeight;
      if (w <= 0 || h <= 0) return;
      if (viz.canvas.width !== Math.round(w * dpr) || viz.canvas.height !== Math.round(h * dpr)) {
        viz.canvas.width = Math.round(w * dpr);
        viz.canvas.height = Math.round(h * dpr);
        viz.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    }

    // Dessine le spectre (barres). On agrège les bins en `barCount` bandes
    // (somme logarithmique approximée par une marche linéaire — suffisant
    // visuellement). Couleur interpolée le long de la palette.
    function drawSpectrum() {
      var ctx = viz.ctx;
      var w = viz.canvas.clientWidth, h = viz.canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);

      viz.analyser.getByteFrequencyData(viz.freq);
      var bins = viz.freq.length;
      var bars = viz.barCount;
      // On ignore les tout premiers bins (sub) et on se limite à ~70% du
      // spectre (au-delà, peu de signal musical utile → barres plates).
      var useful = Math.max(8, Math.floor(bins * 0.7));
      var per = useful / bars;
      var barW = w / bars;
      var pal = viz.palette;

      for (var i = 0; i < bars; i++) {
        var from = Math.floor(i * per);
        var to = Math.floor((i + 1) * per);
        var sum = 0;
        for (var j = from; j < to; j++) sum += viz.freq[j];
        var avg = sum / Math.max(1, to - from) / 255; // 0..1
        var barH = Math.max(1, avg * h);
        var t = i / Math.max(1, bars - 1);
        ctx.fillStyle = lerpPalette(pal, t);
        var x = i * barW;
        if (viz.mirror) {
          var bh = barH / 2;
          ctx.fillRect(x + 0.5, (h - bh) / 2, barW - 1, bh);   // haut
          ctx.fillRect(x + 0.5, h / 2, barW - 1, bh);          // bas (miroir)
        } else {
          ctx.fillRect(x + 0.5, h - barH, barW - 1, barH);
        }
      }
    }

    // Dessine la waveform (ligne centrée). Pics = transitoires/basses.
    function drawWaveform() {
      var ctx = viz.ctx;
      var w = viz.canvas.clientWidth, h = viz.canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);

      viz.analyser.getByteTimeDomainData(viz.wave);
      var n = viz.wave.length;
      ctx.lineWidth = 2;
      ctx.strokeStyle = viz.palette[viz.palette.length - 1] || '#93c5fd';
      ctx.beginPath();
      var slice = w / n;
      for (var i = 0; i < n; i++) {
        var v = viz.wave[i] / 128 - 1;       // -1..1 centré
        var y = h / 2 + v * (h / 2) * 0.9;
        var x = i * slice;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Interpolation simple le long d'une palette de couleurs.
    function lerpPalette(pal, t) {
      if (pal.length === 1) return pal[0];
      var scaled = t * (pal.length - 1);
      var i = Math.floor(scaled);
      var f = scaled - i;
      if (i >= pal.length - 1) return pal[pal.length - 1];
      return mixHex(pal[i], pal[i + 1], f);
    }

    function mixHex(a, b, t) {
      var ra = parseInt(a.substring(1, 3), 16), ga = parseInt(a.substring(3, 5), 16), ba = parseInt(a.substring(5, 7), 16);
      var rb = parseInt(b.substring(1, 3), 16), gb = parseInt(b.substring(3, 5), 16), bb = parseInt(b.substring(5, 7), 16);
      var r = Math.round(ra + (rb - ra) * t);
      var g = Math.round(ga + (gb - ga) * t);
      var bl = Math.round(ba + (bb - ba) * t);
      return 'rgb(' + r + ',' + g + ',' + bl + ')';
    }

    // Une frame de rendu.
    function frame(t) {
      if (!viz.running) return;
      viz.rafId = requestAnimationFrame(frame);
      if (t - viz.lastFrame < FRAME_MS) return; // throttle ~30 FPS
      viz.lastFrame = t;
      if (!viz.analyser || !viz.canvas || !viz.ctx) return;
      allocBuffers();
      resize();
      if (viz.mode === 'waveform') drawWaveform();
      else drawSpectrum();
    }

    function start() {
      if (viz.running) return;
      viz.running = true;
      viz.lastFrame = 0;
      viz.rafId = requestAnimationFrame(frame);
    }
    function stop() {
      viz.running = false;
      if (viz.rafId) cancelAnimationFrame(viz.rafId);
      viz.rafId = null;
      // Efface le canvas à l'arrêt (pas de rémanence).
      if (viz.ctx && viz.canvas) viz.ctx.clearRect(0, 0, viz.canvas.clientWidth, viz.canvas.clientHeight);
    }
    function setMode(mode) { viz.mode = (mode === 'waveform') ? 'waveform' : 'spectrum'; }
    function setAnalyser(analyser) { viz.analyser = analyser || null; viz.freq = null; viz.wave = null; }

    function destroy() {
      stop();
      var idx = instances.indexOf(handle);
      if (idx !== -1) instances.splice(idx, 1);
    }

    var handle = {
      start: start, stop: stop, setMode: setMode, setAnalyser: setAnalyser,
      destroy: destroy,
      _viz: viz,
    };
    instances.push(handle);
    return handle;
  }

  // Démarre / arrête tous les visualizers actifs d'un coup.
  function startAll() {
    globalRunning = true;
    for (var i = 0; i < instances.length; i++) instances[i].start();
  }
  function stopAll() {
    globalRunning = false;
    for (var i = 0; i < instances.length; i++) instances[i].stop();
  }

  // Redimensionne tous les backing stores (à appeler sur window resize).
  function resizeAll() {
    for (var i = 0; i < instances.length; i++) {
      var v = instances[i]._viz;
      if (v && v.canvas) {
        // Force le recalcul au prochain frame.
        v.canvas.width = 0;
      }
    }
  }

  window.Visualizer = {
    create: create,
    startAll: startAll,
    stopAll: stopAll,
    resizeAll: resizeAll,
    PALETTES: PALETTES,
  };
})();

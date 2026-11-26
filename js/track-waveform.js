// Tracé SVG partagé par la piste audio du séquenceur et les transports DJ.
(function () {
  'use strict';

  const BARS = 600;

  function render(path, buffer, { halfHeight = 50 } = {}) {
    if (!buffer || !buffer.length) {
      path.removeAttribute('d');
      return;
    }
    const count = Math.min(buffer.length, BARS);
    const peaks = new Float32Array(count);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const samples = buffer.getChannelData(channel);
      for (let bar = 0, from = 0; bar < count; bar++) {
        const to = Math.floor((bar + 1) * samples.length / count);
        let peak = peaks[bar];
        for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(samples[i]));
        peaks[bar] = peak;
        from = to;
      }
    }
    const maxPeak = Math.max(...peaks) || 1;
    const d = Array.from(peaks, (peak, bar) => {
      const x = ((bar + 0.5) * BARS / count).toFixed(2);
      const height = Math.max(0.6, (peak / maxPeak) * halfHeight);
      return `M${x} ${(50 - height).toFixed(2)}V${(50 + height).toFixed(2)}`;
    }).join('');
    path.setAttribute('d', d);
  }

  window.TrackWaveform = { render };
})();

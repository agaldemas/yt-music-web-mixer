# CREDITS

Attributions for third-party assets used in this project. All assets are
either original, public domain, or released under a permissive open license
(CC0 / CC-BY). They are bundled in this repository and may be redistributed.

---

## 🥁 Drum samples (`assets/sounds/drums/`)

All drum samples in `assets/sounds/drums/acoustic/` and
`assets/sounds/drums/electronic/` are sourced from the
[stayves/air-drums](https://github.com/stayves/air-drums) project, which
itself credits two upstream sources:

### Acoustic kit — `acoustic/`

- **Source**: [TidalCycles / Dirt-Samples](https://github.com/tidalcycles/Dirt-Samples) — `gretsch/` subdirectory
- **Original kit**: Gretsch acoustic drum kit (kick, snare, hihat, toms, ride, crash)
- **License**: **CC0 1.0 (public domain dedication)**
- **Files**: `kick.wav`, `snare-hard.wav`, `snare-brush.wav`, `hihat-closed.wav`,
  `hihat-open.wav`, `tom-hi.wav`, `tom-lo.wav`, `tom-mid.wav` (alias of
  `electronic/tom-mid.wav` — see note below), `ride.wav`, `crash.wav`,
  `tom-brush-hi.wav`, `tom-brush-lo.wav`
- **Renaming**: `013_kick.wav` → `kick.wav`, `019_ridecymbal.wav` → `ride.wav`, etc.

### Electronic kit — `electronic/`

- **Source**: [oramics / sampled](https://github.com/oramics/sampled) — `DM/LM-2` subdirectory
- **Original kit**: LM-2 drum machine samples (Classic Roland TR-808-style)
- **License**: **Public Domain**
- **Files**: `kick.wav`, `snare.wav`, `clap.wav`, `hihat-closed.wav`,
  `hihat-open.wav`, `tom-hi.wav`, `tom-mid.wav`, `tom-lo.wav`, `crash.wav`, `ride.wav`
- **Renaming**: `snare-h.wav` → `snare.wav`, `tom-h/m/l` → `tom-hi/mid/lo`, etc.

### Note on `acoustic/tom-mid.wav`

The Gretsch acoustic source does not provide a discrete mid-tom sample (it
ships only `tom-hi.wav` and `tom-lo.wav` plus brush variants). The
`acoustic/tom-mid.wav` file in this repository is a copy of
`electronic/tom-mid.wav` (LM-2 drum machine, public domain) used as a
stand-in so the 9-track sequencer (Kick, Snare, HC, HO, T-Hi, T-Mid,
T-Lo, Crash, Ride) has a distinct mid-tom sample in the acoustic kit.
If you want strict 100% Gretsch samples, replace
`acoustic/tom-mid.wav` with a pitch-shifted version of `tom-hi.wav` or
`tom-lo.wav`.

---

## 🖼️ Drum kit background image (`battery-set-above.jpeg`)

The top-down drum kit view used in `sequencer.html` is a stock
photograph. **Origin not yet attributed.** If you know the original
photographer, please open a PR to add credit here. If this is your
photograph and you want a specific license, please contact the
maintainers.

---

## 🎵 Tone.js (`js/vendor/tone.js`)

- **Source**: https://github.com/Tonejs/Tone.js
- **Version**: 14.7.77
- **License**: MIT
- Vendored locally to comply with the project's Content Security Policy
  (`script-src 'self'` blocks the unpkg.com CDN by design).

---

## 📦 stayves/air-drums

The drum samples in this project were retrieved from
[stayves/air-drums](https://github.com/stayves/air-drums) (see its
`assets/audio/CREDITS.md`), which packaged the original CC0/PD sources
above with renamed files for web use. We thank stayves for that
intermediary work.

---

## 🛠️ Modified or original work

Everything else in this project (the mixer UI, audio engine, server,
sequencer, scratch implementation, ID3/cover embedding, Piped fallback,
CSS themes) is original work by the YT Music Web Mixer contributors and
is part of this project's license.

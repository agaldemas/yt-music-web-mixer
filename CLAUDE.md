# YT Music Web Mixer — Agent Guide

Dual-deck web DJ mixer (HTML/vanilla JS + Express backend) with dual-mode playback:
- **Local Backend Mode (Primary, DSP)**: Audio extracted via local `yt-dlp` (`/api/streams/:id`), relayed same-origin (`/api/audio/:id`), processed in Web Audio API (crossfade, 3-band EQ, DJ filter, spectrum/waveform, BPM, pitch/tempo, cue/loop).
- **Piped Mode (Fallback, DSP)**: Streams from Piped API (`/streams/:id`) via Web Audio API if CORS permits.
- **IFrame Mode (Fallback, Volume-only)**: YouTube IFrame API; crossfade via `setVolume()`. No DSP mixing possible.

## 📋 Coding Principles (KISS, YAGNI, DRY, SRP, ISP)

- **KISS**: Prefer simple working solutions over complex architectures.
- **YAGNI**: Add features only when requested or proven necessary.
- **DRY**: Factor shared logic without premature abstraction.
- **SRP**: One module, one responsibility (player, audio graph, mixer, search).
- **ISP**: Minimal, shared interfaces (`audio-player.js` & `youtube.js` share the same API).

## 🎯 Product Goal

- Two side-by-side decks: **A** (left) and **B** (right), each with player + search bar.
- Bottom toolbar: **crossfader A↔B** (0=A, 50=balanced, 100=B), transport (play/pause, sync, master volume).
- **DSP Mode (Local/Piped)**: 3-band EQ, sweep filter, pitch/tempo, BPM detection, beatmatch, cue points, loops, visualizer.

## 🔴 Technical Constraints

### Common Constraints (IFrame + DSP)
1. **No YouTube audio stream access via IFrame**: IFrame API cannot supply `AudioBuffer` or `MediaElementAudioSourceNode` (cross-origin, no CORS). Web Audio cannot connect to an iframe. IFrame mode uses volume control only.
2. **Crossfade calculation**: Equal-power curve: `vA = cos(p·π/2)*100`, `vB = sin(p·π/2)*100` (where `p = crossfade/100`).
   - IFrame: `player.setVolume(v)`.
   - DSP: `GainNode.gain.setTargetAtTime()` on deck gains.
3. **Autoplay policy**: Players must start `muted`. Provide an explicit "Enable Sound" (unmute) button per deck. In DSP mode, unlock `AudioContext` with `ctx.resume()` on first user gesture.
4. **Search without hardcoded server keys**:
   - Option 1: User-supplied YouTube Data API v3 key stored in `localStorage`.
   - Option 2 (Keyless): Piped search API (`/search?q=…&filter=videos`) via cascade.
   - Option 3: Manual URL or video ID entry.
   - Never hardcode API keys.
5. **No build/bundler on frontend**: Plain HTML + vanilla JS scripts in `js/`.
6. **Hosting**: `file://` supports minimal IFrame mode only. Express backend (`http://127.0.0.1:5400`) is recommended for DSP mode.

### DSP Mode Constraints (Web Audio API)
7. **CORS & Audio Relay**: Same-origin relay `/api/audio/:id` prevents audio canvas/analyser taint. Piped fallback uses proxied stream URLs if available.
8. **MediaElementAudioSourceNode**: Connecting an `<audio>` element routes all sound through the Web Audio graph to `ctx.destination`. Element must have `crossOrigin="anonymous"`.
9. **Node reuse**: An `<audio>` element can only be connected to `createMediaElementSource` once. When changing tracks, update `audio.src` on the existing element; do not recreate the node.
10. **Stream URL expiration**: Local backend auto-refreshes upstream CDN URLs on 403/410. Piped mode must call `PipedStreams.refreshStream(videoId)` on error and restore `currentTime`.
11. **Audio-only in DSP mode**: DSP uses `audioStreams` (no video rendering).
12. **Pitch preservation**: Set `audio.preservesPitch = true` (with vendor prefixes `mozPreservesPitch`, `webkitPreservesPitch`) when changing `playbackRate`.
13. **Dual-mode transparency**: Auto-switch between DSP and IFrame. Display mode badge per deck. Hide DSP-only controls in IFrame mode.

## 📁 File Architecture

```
yt-music-web-mixer/
├── index.html                   # Shell: header, decks A & B, bottom mixer bar
├── package.json                 # Node dependencies (express) & scripts
├── start.sh / start.bat         # Start script (runs Express server on port 5400)
├── css/styles.css               # Two-column layout, fixed mixer bar, DJ UI controls
├── server/server.js             # Express backend: static files + yt-dlp extraction + audio relay
└── js/
    ├── app.js                   # Bootstrap, mode detection, global state, persistence
    ├── config.js                # Constants, API endpoints, Piped instances, audio defaults
    ├── youtube.js               # YouTube IFrame API wrapper (fallback mode)
    ├── audio-player.js          # HTML5 <audio> player + Web Audio integration (DSP mode)
    ├── audio-engine.js          # Web Audio graph: EQ, filter, gain, analyser
    ├── piped-streams.js         # Stream client: local backend priority + Piped fallback cascade
    ├── visualizer.js            # Canvas spectrum & waveform visualizer via AnalyserNode
    ├── bpm-detector.js          # Real-time BPM detection (bass band energy peaks)
    ├── search.js                # YouTube Data API + Piped search & results rendering
    ├── mixer.js                 # Crossfader logic, transport controls, sync engine
    └── local-load.js            # File import binding & local library index
```

### Module Specifications

- **`server/server.js`**: Node/Express local backend on port 5400 (`127.0.0.1`). Endpoints:
  - `GET /api/session`: Session bootstrap / token exchange.
  - `GET /api/health`, `/api/ready`: yt-dlp availability check.
  - `GET /api/streams/:id`: Invokes `yt-dlp -f ba -J`, returns Piped-compatible JSON pointing to `/api/audio/:id`.
  - `GET /api/audio/:id`: Same-origin streaming relay with HTTP Range support.
  - `GET /api/meta/:id`, `GET /api/download/:id`: Metadata & bounded download cache.
- **`audio-engine.js`**: Single shared `AudioContext`.
  - Deck graph: `MediaElementAudioSourceNode -> BiquadFilter(lowshelf 200Hz) -> BiquadFilter(peaking 1kHz) -> BiquadFilter(highshelf 4kHz) -> BiquadFilter(DJ LP/HP filter) -> GainNode(deckGain) -> AnalyserNode(2048) -> GainNode(masterGain) -> destination`.
  - Methods: `applyCrossfade(p)`, `setEQ(deck, band, gainDb)`, `setDjFilter(deck, pos)`, `getAnalyser(deck)`.
- **`audio-player.js`**: Wraps `<audio>` with the same interface as `youtube.js` (`loadVideoById`, `playVideo`, `pauseVideo`, `seekTo`, `setVolume`, `mute`, `unMute`, `getCurrentTime`, `getDuration`, `getPlayerState`).
- **`youtube.js`**: Asynchronously loads YouTube IFrame API (`createPlayer`). Manages loading queue and error callbacks (100, 101, 150).
- **`piped-streams.js`**: Tries local `/api/streams/:id` first when served over HTTP(S), falls back to `PIPED_INSTANCES` cascade. Selects best audio (OPUS > M4A > WEBMA). Manages in-memory cache and expiration.
- **`bpm-detector.js`**: Analyzes 20-150Hz frequency bins, detects beat intervals, computes median BPM (60-200 range, ±2-3 BPM accuracy). `syncBtoA()` adjusts `playbackRate` within ±8%.
- **`mixer.js`**: Crossfader and sync management:
  - **Instant Sync**: Seeks lagging deck to lead deck `currentTime`.
  - **Continuous Sync (optional)**: 1s interval check. Re-seeks if drift > 0.5s (IFrame) or > 0.2s (DSP). Normal residual drift: 200-500ms (IFrame), 50-200ms (DSP).
- **`search.js`**: UI states (`idle`, `loading`, `results`, `error`, `no-results`). Parses search results or direct URLs (`youtu.be`, `watch?v=`, `/shorts/`, `/embed/`, raw ID).
- **`app.js`**: Orchestration, startup auto-detection, and `localStorage` persistence (`youtubeApiKey`, `lastVideoIdA/B`, `lastSeekA/B`, `playerMode`, EQ/filter/pitch/cue/loop settings).

## 📜 Code Conventions

- Vanilla JavaScript, zero frontend dependencies/frameworks.
- Local backend: Node/Express (`server/server.js`), port 5400 (`process.env.PORT`).
- Naming: `camelCase` for variables/functions, `UPPER_SNAKE` for constants.
- State: Single global state in `app.js`; modules receive dependencies via arguments.
- Single shared `AudioContext` for all decks (never create one per deck).
- Comments in French, code/identifiers in English. No `console.log` in production.

## ❌ Forbidden Practices

- ❌ Connecting YouTube iframe to Web Audio API (impossible due to CORS/cross-origin).
- ❌ Attempting DSP processing (EQ, filters, analysis) in IFrame mode.
- ❌ Creating multiple `MediaElementAudioSourceNode` for the same `<audio>` element.
- ❌ Omitting `crossOrigin="anonymous"` on `<audio>` in DSP mode.
- ❌ Hardcoding API keys in source code.
- ❌ Adding frontend bundlers/frameworks (React, Vue, Vite, Webpack).
- ❌ Expanding backend scope beyond extraction, relay, and bounded audio caching.
- ❌ Storing user data anywhere other than `localStorage`.
- ❌ Promising frame-accurate sync or exact integer BPM detection.

## ⚠️ Known UI Limitations

- **IFrame Mode**: Volume crossfade only. No EQ, no visualizer, no tempo sync.
- **DSP Mode**: Full audio mixing features, but audio-only (no video display).
- **Dual Playback Load**: Simultaneous playback is CPU/network intensive; warn users on lower-end devices.
- **YouTube API Quota**: Data API v3 limited to 10,000 units/day (search = 100 units). Piped search avoids this quota.
- **Sync Micro-cuts**: Continuous sync seek causes slight audible buffering interruptions.

## 🔒 Local Backend Security Invariants

- Bind strictly to loopback (`127.0.0.1`); do not expose on `0.0.0.0`.
- Use explicit static allowlist; never use `express.static(ROOT)`.
- No wildcard CORS on `/api`; keep `X-Local-Token` in memory only.
- `createApp()` must remain importable without starting the server; `startServer()` handles startup.
- Browser cookies are opt-in, cache is bounded, DJ tracks limited to 30 min, scratch slices to 10 min.
- See [`SECURITY.md`](SECURITY.md) for the full Content Security Policy rationale, the worker-src / blob: justification (Tone.js clock), local-host enforcement, and the token model.

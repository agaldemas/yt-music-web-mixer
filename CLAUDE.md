# YT Music Web Mixer — Agent Guide

## 📋 Coding Principles (KISS, YAGNI, DRY, SRP, ISP)

- **KISS (Keep It Simple, Stupid)**: Prefer simple solutions over clever ones. A working app > perfect architecture.
- **YAGNI (You Aren't Gonna Need It)**: Don't implement features users don't need yet. Add them only when explicitly requested or proven necessary.
- **DRY (Don't Repeat Yourself)**: Extract shared logic into reusable functions, but avoid premature abstraction.
- **SRP (Single Responsibility Principle)**: Each module does one thing well. One player handles loading; another handles audio graph; mixer handles volume blending.
- **ISP (Interface Segregation)**: Clients depend on minimal interfaces. `audio-player.js` has the same API for YouTube and local files — that's ISP in action.

## 🎯 Product Goal

- Two side-by-side decks: **A** (left) and **B** (right). Each has a player (Piped audio or YouTube IFrame) + search bar.
- User searches in each deck → video loads into the corresponding player.
- Bottom toolbar: **crossfader A↔B** (0=A, 100=B, 50=balanced), playback controls (play/pause, sync, master volume).
- Slider adjusts relative volume of A and B in real-time.
- **Piped only**: Advanced DJ features — 3-band EQ per deck, sweep filter, pitch/tempo, BPM detection, beatmatch, cue points, loops, spectral visualization.

## 🔴 Technical Constraints (READ FIRST)

### Common Constraints (IFrame + Piped)

1. **No YouTube audio stream access via IFrame.** The IFrame API cannot provide `AudioBuffer` / `MediaElementAudioSourceNode` (cross-origin, no CORS on iframe). In **IFrame mode**, you CANNOT do true DSP mixing (EQ, filters, spectral analysis, beatmatch). Mixing is done **only via volume control** (`setVolume`). Don't waste time trying to branch Web Audio API on an iframe — it's documented as impossible.
   - **Exception — extracted audio streams**: The local Express backend uses `yt-dlp`, then relays the stream via `/api/audio/{videoId}` in same-origin. This allows loading into `<audio crossOrigin="anonymous">` and full signal access in Web Audio API (`MediaElementAudioSourceNode`).
   - **Piped Fallback**: Piped instances return audio stream URLs (sometimes direct, sometimes proxied). They are used only after backend local failure.

2. **IFrame Crossfade = Volume Control.** `playerA.setVolume(vA)`, `playerB.setVolume(vB)`. Use amplitude curve (simple linear, or equal-power `sqrt` for professionalism) to avoid the dip in level at mid-point.
   - **Piped Mode = GainNode.** Crossfade via `GainNode.gain.value` per deck in the Web Audio API graph. Equal-power: `gainA = cos(p·π/2)`, `gainB = sin(p·π/2)`. Smooth ramping via `gain.setTargetAtTime()`.

3. **Autoplay / Browser Policy.** A player must be **muted** to start without user gesture. Each deck (A and B) needs its own **mute/unmute button** ("Enable Sound") triggered by click, because browsers treat each player independently. Both players cannot start with sound without interaction. On initialization, start both players in `muted`, then offer explicit unmute per deck.
   - **Piped Mode**: `AudioContext` must be created/resumed after a user gesture (autoplay policy). On first `play()`, call `ctx.resume()`.

4. **YouTube Search Without Server.** YouTube Data API v3 requires a key. Since there's no server to hide the key:
   - **Recommended Option**: User provides their own YouTube Data API key (from Google Cloud Console), stored in `localStorage`. Search via direct `fetch()` to `https://www.googleapis.com/youtube/v3/search`.
   - **Keyless Fallback (Piped)**: Search uses public Piped API (`/search?q=…&filter=videos`), CORS enabled, no Google key, no quota. Multiple Piped instances tried in cascade for reliability. Toggle button to force Piped even with a key configured (preserves Google quota).
   - **No Key + No Piped**: Manual URL or video ID entry per deck (no search).
   - **Never** hardcode a shared API key in source code.

5. **No Build, No Bundler (Frontend).** Frontend remains HTML + vanilla JS (single `index.html` + scripts in `js/`). **Exception**: local Express backend (`server/server.js`) — Node/Express + `yt-dlp` — introduced to bypass YouTube anti-bot blocking Piped instances — see "Local Extraction Backend" below. Requires `npm install`, Node.js 22.12+ or 24 LTS, plus system-wide `yt-dlp` and `ffmpeg` for local YouTube extraction. `start.sh` / `start.bat` handle `npm install` automatically.

6. **Serve the App.** App opens in `file://` (YouTube IFrame players — minimum vital requirement), but search and Piped/Web Audio modes require a local server. **Recommended server is now the Express backend** (`start.sh` / `start.bat` → `node server/server.js` on port 5400), serving frontend as static AND local extraction. In `file://`, backend local is disabled (`/api/*` doesn't exist) and app falls back to Piped cascade (often blocked by anti-bot) then IFrame. ES modules may be blocked in `file://` — use classic scripts (`<script src="js/app.js">`).

### Piped/Web Audio API-Specific Constraints

7. **CORS on audio streams = critical point.** Backend local is priority: `/api/audio/{videoId}` is same-origin and avoids Web Audio taint. On Piped fallback, URLs from `/streams/{videoId}` may be direct (`*.googlevideo.com` — CORS usually blocked) or proxied (`pipedproxy.*` — CORS `*`). `piped-streams.js` preserves already-proxied URLs and builds a URL via `proxyUrl` for direct streams. If backend local and Piped CORS fail, stay in IFrame (volume-only).

8. **`MediaElementAudioSourceNode = Point of No Return`.** Once an `<audio>` element is connected to a `MediaElementAudioSourceNode`, its audio no longer goes directly to speakers — it MUST pass through the Web Audio graph to `ctx.destination`. No hybrid mode (direct audio + DSP in parallel) on the same element. Element must have `crossOrigin="anonymous"`.

9. **One `MediaElementAudioSourceNode` per Element.** An `<audio>` can be connected only once. When changing videos, reuse the same element (change `audio.src`) — node stays valid. Don't recreate the node.

10. **Stream URL Expiration**. CDN URLs expire (a few hours). For backend local, `/api/audio/{videoId}` auto-re-extracts upstream URL on 403/410. On Piped fallback, `audio-player.js` must call `PipedStreams.refreshStream(videoId)`, then restore position (`currentTime`) and resume if needed.

11. **Audio-only in Piped Mode**. Piped uses `audioStreams` (not `videoStreams`). We lose YouTube video. This is an accepted trade-off for a DJ mixer. IFrame remains available as fallback if video is desired.

12. **Piped Fallback**. Public Piped instances can be slow, unavailable, or rate-limited. `piped-streams.js` tries backend local first (when app is served in HTTP(S)), then tries `PIPED_INSTANCES` cascade. If all DSP sources fail, app falls back to IFrame.

13. **`preservesPitch` for Tempo**. `audio.playbackRate` changes speed AND pitch ("chipmunk" effect). To preserve pitch during beatmatch, use `audio.preservesPitch = true` (prefixed: `mozPreservesPitch`, `webkitPreservesPitch`). Feature detection required.

14. **Dual Mode Transparency**. App should transparently switch between Piped and IFrame. Visual indicator (badge per deck) shows active mode. DJ controls (EQ, pitch, BPM, cue/loop) appear only in Piped mode. In IFrame mode, UI reverts to volume-only crossfade.

## 📁 File Architecture

```
yt-music-web-mixer/
├── CLAUDE.md                    # this file — agent guidelines
├── tasks-list.md                # project status (current web app)
├── piped-enhancement-tasks-list.md  # Piped/Web Audio migration plan
├── mobile-app-tasks-list.md     # React Native (WebView) app plan
├── package.json                 # local server deps (express) + start scripts
├── index.html                   # structure: header, A | B zone, mixer bar
├── start.sh / start.bat         # launches Express backend (auto npm install) on port 5400
├── server/
│   └── server.js                # Express backend: static frontend + yt-dlp extraction + same-origin audio relay
├── css/
│   └── styles.css               # grid layout, fixed mixer bar, DJ UI
└── js/
    ├── app.js                   # bootstrap, wiring, mode detection, global state
    ├── config.js                # constants, API key, Piped instances, audio config
    ├── youtube.js               # YouTube IFrame API wrapper (fallback mode)
    ├── audio-player.js          # Piped <audio> + Web Audio API (DSP mode)
    ├── audio-engine.js          # Web Audio graph: source → EQ → filter → gain → analyze
    ├── piped-streams.js         # local backend priority, Piped cascade, cache, expiration
    ├── visualizer.js            # canvas spectrum/waveform via AnalyserNode
    ├── bpm-detector.js          # real-time BPM detection (bass band → peaks → intervals)
    ├── search.js                # YouTube Data API + Piped search + results display
    ├── mixer.js                 # crossfader logic (GainNode for Piped, setVolume for IFrame)
    └── local-load.js              # file import binding + local library index
```

### `server/server.js` — Local Extraction Backend (yt-dlp)

**Node/Express server** introduced to bypass YouTube anti-bot blocking public Piped instances (`SignInConfirmNotBotException`). `yt-dlp` runs **locally**, on the user's IP, where anti-bot doesn't apply (or is resolved via optional PO-Token plugins). Server also serves frontend as static → app + API are **same-origin**, making audio relay exploitable by Web Audio without taint.

API limited **strictly to local extraction and audio relay**:
- `GET /api/streams/:id` → launches `yt-dlp -f ba -J` on the video, returns **Piped-compatible JSON** (`title`, `duration`, `thumbnailUrl`, `uploader`, `audioStreams[].url`). Audio URL points to `/api/audio/:id`.
- `GET /api/audio/:id` → **same-origin relay** of extracted audio stream (bytes in streaming, supports **HTTP Range** for seek, auto-re-extraction if CDN URL expires / 403). This relay is the direct continuation of extraction: without it, a brute `googlevideo.com` URL loaded into cross-origin `<audio>` would be **tainted** (silence) → Web Audio graph mute (no crossfade/EQ/BPM). It only relays (no transcoding, no disk storage, cache URL strictly in-memory).
- `GET /api/health` → yt-dlp presence/version.

Frontend calls `/api/streams/:id` first via `piped-streams.js` when app is served in HTTP(S). On failure, it falls back to configured Piped instances. Backend local is the preferred source for DSP mode; Piped is a fallback.

On startup, server checks yt-dlp (`yt-dlp --version`); if absent, serves frontend as static anyway and app falls back to Piped/IFrame. `start.sh` / `start.bat` handle `npm install` automatically and warn if yt-dlp is missing. Default port **5400** (`process.env.PORT`).

### `youtube.js` — IFrame Player Wrapper (Fallback Mode)
- Loads YouTube IFrame API asynchronously (script tag to `https://www.youtube.com/iframe_api`).
- Exposes `createPlayer(elementId, { onReady, onStateChange, onError })` returning a player object.
- **Methods used**: `loadVideoById(id)` (or `cueVideoById(id)` + `playVideo()`), `playVideo()`, `pauseVideo()`, `seekTo(sec)`, `setVolume(0-100)`, `mute()`, `unMute()`, `getCurrentTime()`, `getDuration()`, `getPlayerState()`.
  - `loadVideoById` preferred (loads AND plays automatically); `cueVideoById` loads without playing.
- **Reader state constants** (via `getPlayerState()`):
  - `-1` = UNSTARTED, `0` = ENDED, `1` = PLAYING, `2` = PAUSED, `3` = BUFFERING, `5` = CUED.
- **Recommended `playerVars`** on creation: `{ rel: 0, playsinline: 1, origin: window.location.origin }` to avoid suggested videos after playback, force inline playback, and fix origin.
- **YouTube IFrame error handling**: listen to `onError` callback (code 100 = deleted/private video, 101 = integration rejected, 150 = age-restricted content). Display clear message in affected deck.
- Maintain a **loading queue**: API not ready immediately, cache calls before `onYouTubeIframeAPIReady`.
- This module is the **fallback** when Piped is unavailable. Exposes same interface as `audio-player.js` for dual mode.

### `audio-player.js` — Piped Audio Player (DSP Mode)
- Creates `<audio crossOrigin="anonymous" preload="auto">` and branches into Web Audio graph via `AudioEngine.createDeckChain(deckId)`.
- **Same API as `youtube.js`**: `loadVideoById`, `cueVideoById`, `playVideo`, `pauseVideo`, `seekTo`, `setVolume` (no-op — volume handled by `GainNode`), `mute`/`unMute` (via mute `GainNode`), `getCurrentTime`, `getDuration`, `getPlayerState`.
- `loadVideoById(id)` → calls `PipedStreams.fetchStreamInfo(id)` → selects audio stream → `audio.src = streamUrl` → `audio.load()`.
- **State mapping** `<audio>` → `YTWrapper.STATE`: `playing`→PLAYING, `pause`→PAUSED, `waiting`→BUFFERING, `ended`→ENDED, `canplay`→CUED, `loadstart`→UNSTARTED.
- **Expiration handling**: if `audio.error` → re-fetch via `PipedStreams.refreshStream`, restore position, resume if playing.
- `playVideo()` must call `AudioEngine.resume()` (unlock `AudioContext` after user gesture).

### `audio-engine.js` — Web Audio API Engine
- Single `AudioContext`, created on first user gesture.
- **Per-deck graph** (A and B):
  ```
  MediaElementAudioSourceNode → BiquadFilter(lowshelf, 200Hz)
    → BiquadFilter(peaking, 1000Hz, Q=1) → BiquadFilter(highshelf, 4000Hz)
    → BiquadFilter(DJ filter: lowpass↔highpass) → GainNode(deckGain)
    → AnalyserNode(fftSize=2048) → GainNode(masterGain) → ctx.destination
  ```
- `applyCrossfade(p)`：sets deck gains in equal-power (`cos`/`sin`). Smooth ramping via `setTargetAtTime`.
- `setEQ(deck, band, gainDb)`: sets gain of a `BiquadFilterNode` (low/mid/high). Range ±12dB.
- `setDjFilter(deck, position)`: position `-1..0..+1` → lowpass (left), bypass (center), highpass (right).
- `getAnalyser(deck)`: returns the `AnalyserNode` for visualizer.
- **`MediaElementAudioSourceNode` reuse**: an element can be connected only once. Changing `audio.src` keeps node valid.

### `piped-streams.js` — Local Backend + Piped Fallback Client
- `fetchStreamInfo(videoId, signal)`: checks cache, calls `/api/streams/{videoId}` first if app is in HTTP(S), then tries `GET /streams/{videoId}` on `PIPED_INSTANCES` cascade.
- `callLocalStreams()`: consumes JSON response from Express backend; relative `/api/audio/:id` URLs remain same-origin.
- `selectBestAudio(audioStreams, videoStreams)`: prefers audio-only stream and selects by format/bitrate (OPUS > M4A > WEBMA), with fallback to muxed video stream readable by `<audio>`.
- **CORS-safe URL construction**: preserves local and already-proxied URLs; for direct Piped streams (`googlevideo.com`), uses `proxyUrl` if available.
- **In-memory cache**: `{ videoId → { audioStreams, bestAudio, instance, fetchedAt, expiresAt } }`, with `instance: 'local'` for Express backend.
- `refreshStream(videoId, signal)`: invalidates cache and retries with backend local first, then Piped cascade.
- `classifyError(err)`: distinguishes invalid ID, anti-bot, unavailable backend/instances, network errors.

### `visualizer.js` — Visualization
- `createVisualizer(canvas, analyser, options)`: `requestAnimationFrame` loop that draws spectrum (`getByteFrequencyData`) or waveform (`getByteTimeDomainData`).
- One canvas per deck (in `.deck`) + one master canvas in mixer bar.
- Performance: `fftSize=2048`, limit to 30 FPS if needed.

### `bpm-detector.js` — BPM Detection
- Retrieves `analyser.getByteFrequencyData()` at regular intervals (~50ms).
- Isolates bass band (20-150Hz), detects energy peaks (beats).
- Calculates inter-beat intervals → median → `bpm = 60000 / intervalAverage`.
- Filters in 60-200 BPM range. Approximate (±2-3 BPM).
- `syncBtoA()`: adjusts `audioB.playbackRate` to match A's BPM (limited to ±8%).

### `search.js` — Search
- If API key present: `GET https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&q=<query>&key=<key>` (`videoCategoryId=10` = Music). Display thumbnail + title + duration (if available).
- **Keyless search via Piped**: `GET /search?q=…&filter=videos` on `PIPED_INSTANCES` cascade. CORS enabled, no Google key, no quota. Toggle button to force Piped even with a key (preserves quota).
- **Required error handling for search**:
  - **403/429** (quota exceeded) → message "API quota exceeded, try again later" + propose manual URL fallback or Piped.
  - **400** (invalid key) → message "Invalid API key, check settings".
  - **Network/CORS failure** → message "Cannot contact YouTube API. Use keyless mode (manual URL entry) or Piped."
  - **No results** → adapted message, not empty table.
- **UI panel states**: `idle` (empty field), `loading` (spinner), `results` (grid), `error` (error message), `no-results`.
- Selecting a result → returns `videoId` to the corresponding deck player (A or B).
- Keyless fallback: field accepts URL (`youtu.be/...`, `watch?v=...`, `/shorts/...`, `/embed/...`) or raw ID → extract `videoId`.

### `mixer.js` — Crossfader
- State: `crossfade` (0–100), `masterVolume` (0–100), `isPlayingA/B`.
- **Piped Mode**: crossfade via `AudioEngine.applyCrossfade(crossfade / 100)` + `AudioEngine.applyMasterVolume(master)`. Smooth ramping via `GainNode.gain.setTargetAtTime()` (replaces progressive crossfade with `setInterval` intervals).
- **IFrame Mode**: `playerA.setVolume(vA * master/100)` (same for B), equal-power `cos`/`sin`. Progressive crossfade retained via `setInterval`.
- Equal-power calculation (shared): `vA = Math.cos(p*Math.PI/2)*100`, `vB = Math.sin(p*Math.PI/2)*100`.
- Buttons: play/pause per deck + play both / pause both, sync B on A, resync.
- **Sync B→A — Detailed Contract**:
  - **Instant Sync (on click)**: seek B to A's `currentTime` and start B if A is playing. This is the basic behavior.
  - **Continuous Sync (optional, user-enabled)**: launch `setInterval(~1s)` comparing `currentTime` of both players. If gap exceeds 0.5s (IFrame) or 0.2s (Piped, more precise), re-seek lagging player. Disable with "resync off" button.
  - **Important**: continuous sync is never perfect — seek + buffering creates an audible micro-cut. Document in UI.
  - **Drift (IFrame)**: YouTube players not frame-synced. Even with continuous sync, residual drift of 200-500ms is normal.
  - **Drift (Piped)**: HTML5 `<audio>` elements more precise. Residual drift lower (typically 50-200ms). Re-seek threshold can be raised to 0.2s.
- Keyboard-accessible slider, displayed values.

### `app.js` — Bootstrap
- Initializes two players (A, B), two search modules, mixer.
- **Mode detection** on startup: tries `PipedStreams.fetchStreamInfo` on test videos. Success → Piped mode (Web Audio API, DJ UI). Failure → IFrame fallback (volume-only, simplified UI). Manual mode via Settings (auto / piped / iframe).
- Manages global state (player ready, API key, current videoIds, active mode per deck).
- **`localStorage` persistence strategy**:
  - `youtubeApiKey`: YouTube Data API key.
  - `lastVideoIdA`, `lastVideoIdB`: last loaded video IDs.
  - `lastSearchQueryA`, `lastSearchQueryB`: last search queries.
  - `lastSeekA`, `lastSeekB`: `currentTime` at stop (for resumption at same position).
  - `playerMode`: player mode (auto / piped / iframe).
  - **Piped DJ**: `eqLowA/MidA/HighA` (same for B), `djFilterA/B`, `pitchA/B`, `cueA/B`, `loopInA/OutA` (same for B).
  - On reload: if `lastSeekA` exists, call `seekTo(sec)` after `loadVideoById` to resume at previous position (not just reload from start).
  - **Limit**: if browser clears `localStorage` or user is in private browsing, persistence lost. This is normal.
- **Global error handling**:
  - If YouTube API fails (timeout after 10s), display "Cannot load YouTube. Check connection or ad blockers."
  - If a player fails, display message in its deck, not entire app.
  - If API key invalid, report in settings UI, not just console.
  - **Piped Mode**: if CORS blocked (AnalyserNode = silence after 1s) → switch deck to IFrame. If all Piped instances down → global IFrame fallback.

## 📝 Implementation Order

### Phase 1 — IFrame Web App (Complete, see `tasks-list.md`)

1. **HTML/CSS Skeleton**: responsive 2-column grid + fixed bottom bar. Visual playback correct before any logic.
2. **IFrame API Load + 2 Players**: display two test videos (hardcoded IDs), verify `playVideo`/`setVolume`.
3. **Crossfader**: slider linked to both player volumes. Core functionality — validate early.
4. **Search**: field + results per deck (with user-provided API key via UI).
5. **Advanced Controls**: sync, play/pause both, master volume, persistence.
6. **Polish**: responsive, keyboard shortcuts, visual deck state.

### Phase 2 — Piped/Web Audio Migration (see `piped-enhancement-tasks-list.md`)

1. **CORS Validation** (critical): verify Piped audio streams work with Web Audio API.
2. **Piped Streams Client**: `piped-streams.js` — fetch `/streams/{videoId}`, stream selection, cache, expiration.
3. **Audio Engine**: `audio-engine.js` — `AudioContext`, per-deck graph (source → EQ → filter → gain → analyze).
4. **Piped Audio Player**: `audio-player.js` — `<audio>` + `MediaElementAudioSourceNode`, same interface as `youtube.js`.
5. **Web Audio Crossfade**: replace `setVolume` with `GainNode` (smooth ramping).
6. **Dual Mode Abstraction**: transparent Piped ↔ IFrame switching, auto fallback.
7. **EQ + DJ Filter**: 3-band `BiquadFilterNode` + LP↔HP sweep.
8. **Visualization**: canvas spectrum/waveform via `AnalyserNode`.
9. **BPM & Beatmatch**: real-time tempo detection, pitch slider, BPM sync.
10. **Cue & Loop**: markers, loops, N-beat looping.
11. **DJ UI/UX**: layout, knobs/faders, waveforms, mode badges.

## 📜 Code Conventions

- Vanilla JS, **no external dependencies** (no React, no jQuery). **Exception**: `server/server.js` (Node/Express backend) depends on `express` (declared in `package.json`).
- **Local Backend**: `server/server.js` (Node/Express + yt-dlp), port **5400** (`process.env.PORT`). API exposes `/api/session`, `/api/health`, `/api/ready`, `/api/streams/:id`, `/api/meta/:id`, `/api/audio/:id`, and `/api/download/:id`. Expensive routes require `X-Local-Token`; the disk audio cache is bounded. The app remains usable without this server: `piped-streams.js` falls back to Piped then IFrame.
- `camelCase` for variables, `UPPER_SNAKE` for constants.
- Single global state in `app.js` (`state` object), modules receive dependencies as parameters (no circular imports).
- Short comments in French, English variable names.
- No `console.log` in production (except critical errors).
- **Web Audio API**: use a single shared `AudioContext`. Never create one per deck. Nodes (`BiquadFilterNode`, `GainNode`, `AnalyserNode`) created per deck but connected to same `masterGain → destination`.
- **Piped Instances**: `PIPED_INSTANCES` list and timeout `PIPED_INSTANCE_TIMEOUT_MS` shared between `search.js` and `piped-streams.js` (defined in `config.js`).

## ❌ Never Do This

- ❌ Branch YouTube iframe into Web Audio API (impossible, cross-origin, no CORS on iframe).
- ❌ In IFrame mode, attempt DSP mixing (EQ, filters, analysis) — impossible by construction.
- ❌ Create more than one `MediaElementAudioSourceNode` for the same `<audio>` element (Piped mode). Reuse the same element by changing `src`.
- ❌ Forget `crossOrigin="anonymous"` on `<audio>` in Piped mode — audio becomes "tainted" and `AnalyserNode` receives silence.
- ❌ Hardcode an API key in source code.
- ❌ Introduce a bundler/framework for **frontend** (React, Vue, jQuery…). Backend Node/Express (`server/server.js`) is the only exception.
- ❌ Extend backend API beyond extraction and local audio relay (`server.js` does ONLY `/api/streams/:id` + `/api/audio/:id` + `/api/health` — no search, no YouTube Data metadata, no video proxy, no permanent storage).
- ❌ Store user data anywhere other than `localStorage`.
- ❌ Call YouTube Data API without a user-provided key (unless Piped search which needs no key).
- ❌ Promise perfect sync — residual drift of 200-500ms (IFrame) or 50-200ms (Piped) is normal. No frame-accurate sync possible on YouTube.
- ❌ Promise BPM precise to the unit — detection is approximate (±2-3 BPM).

## ⚠️ Known UI Limits (Document in Interface)

- **IFrame Mode**: "mixing" is a **volume crossfade**, not DSP mixing. No EQ, no auto tempo sync.
- **Local Backend / Piped Mode**: mixing is a **true audio crossfade** via `GainNode`, with EQ, filters, spectral analysis and BPM. Local backend uses `yt-dlp` + same-origin relay; Piped fallback depends on public instance reliability/CORS. In both cases, DSP mode is **audio-only** (no video).
- **CORS (Piped Mode)**: if Piped instances don't return CORS `*` on audio streams, DSP mode is impossible. App falls back to IFrame.
- **⚠️ ATTENTION — Heavy Double Playback**: Simultaneous playback of 2 videos (IFrame) or 2 audio streams (Piped) can be very heavy (CPU, RAM, network). Recommendations to display:
  - Close other heavy tabs.
  - Reduce video quality (YouTube setting, not controllable by app) — IFrame mode only.
  - On modest machines, prefer single deck at a time.
  - If playback stutters, lower system interface volume.
- YouTube Data API key subject to **Google quotas** (10,000 units/day by default, one search = 100 units). Beyond that, search blocked until tomorrow. Piped search not subject to this quota.
- **Local Backend + Piped Instances**: Local backend depends on presence/functionality of `yt-dlp`. If unavailable, app tries Piped instances cascade. These can be slow, unavailable, or rate-limited; if all DSP sources fail, fallback IFrame or manual URL/ID entry.
- **Continuous sync never perfect**: residual drift 200-500ms (IFrame) or 50-200ms (Piped) is normal. No frame-accurate sync possible.
- **Detected BPM is approximate** (±2-3 BPM). Transitions, builds and breaks can falsify detection. Beatmatch not perfect.
- **Persistence limited**: if browser clears cache or user in private mode, saved data (`localStorage`) lost. This is normal.
- **`localStorage` in mobile WebView**: may be purged by system (iOS especially). Do not guarantee persistence in mobile browsing.

## Local backend security invariants (August 2026)

- Loopback-only listener (`127.0.0.1`); do not restore `0.0.0.0`.
- Never replace the static allowlist with `express.static(ROOT)`.
- No wildcard CORS on `/api`; keep `X-Local-Token` in memory only.
- `createApp()` must remain importable without starting the server; `startServer()` is the entry-point operation.
- Browser cookies are opt-in, cache/extraction work is bounded, DJ tracks are limited to 30 minutes, and full scratch to 10 minutes.

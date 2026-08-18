# 🎵 YT Music Web Mixer

A web app built with plain HTML + JS that lets you load 2 YouTube tracks side by side (decks **A** and **B**) and mix them via a **crossfader** at the bottom of the page.

The recommended setup uses the local Express server and `yt-dlp`: the server extracts and relays the audio, allowing the player to use the **DJ mode** with Web Audio DSP. An IFrame fallback remains available when audio extraction is unavailable.

> ⚠️ In **IFrame mode**, mixing is a **volume crossfade** only. In **DJ mode**, the extracted audio can be processed with the Web Audio API (EQ, filters, analysis and tempo-related features).

---

## ✨ Features

- **2 side-by-side decks** (A on the left, B on the right), each with its own player and search bar.
- **DJ mode**: local Express backend + `yt-dlp` extraction, same-origin audio relay and Web Audio processing for real audio crossfading, EQ, filters and analysis. If the local backend is unavailable, the player can fall back to audio streams from Piped instances when CORS allows it.
- **YouTube search** by keyword **without any API key** thanks to the public [Piped](https://docs.piped.video/) API (alternative YouTube frontend, CORS-enabled, no Google quota). Multiple Piped instances are tried in cascade for reliability. A YouTube Data API key remains optional for more relevant results and official pagination. Manual entry of a URL / video ID is also supported.
- **Search mode toggle button**: when an API key is configured, a 🟢/⚪ button lets you force search via Piped (preserves Google quota) or switch back to the official YouTube Data API. The choice is persisted in `localStorage`.
- **A↔B crossfader** (0 = full A, 100 = full B, 50 = balanced) with an *equal-power* curve to avoid the level dip in the middle.
- **Global master volume** (0–100%).
- **Per-deck mute/unmute buttons** (required to work around browser autoplay policies).
- **Playback controls**: *play both* / *pause both*, plus per-deck play/pause.
- **Sync B → A**: align B to A's position (one-shot or continuous).
- **Auto-unmute on track change**: selecting a new track automatically enables sound (the click counts as a user gesture for autoplay policies).
- **Separate A/B volume readout**: the crossfade bar shows individual volume percentages for each deck.
- **Mixer-style crossfade thumb**: rectangular 15×30px handle with `ew-resize` cursor, like a hardware mixer fader.
- **DJ controls (Piped/DSP mode only)**:
  - **3-band EQ** (Low / Mid / High, ±12 dB) per deck with double-click reset.
  - **DJ filter** sweep (lowpass ↔ highpass, log-scale knob) per deck, double-click = bypass.
  - **Pitch / tempo** slider (±8%) per deck with `preservesPitch` (tempo change without pitch shift), double-click reset, BPM readout shows the *effective* BPM (`bpm × playbackRate`).
  - **RAZ (reset) buttons** (↺) next to each vertical DJ slider for one-click reset to neutral.
  - **Real-time BPM detection** per deck (spectral-flux onset + histogram of inter-beat intervals, locking after stable cycles). Three visual states: **red** during acquisition (`idle`/`detecting`), **orange** as soon as a provisional BPM is available (~2-3 s, `estimating` state), **green** when the value is locked (`locked`). The provisional BPM is computed by median of intervals and shown early, while the histogram keeps refining in the background until locking. The **RAZ** (↺) button under the value stays visible at all times to restart detection. The locked value only updates on a real change (>3%) to avoid flicker.
  - **SYNC button** to match deck B's tempo to deck A (clamped to ±8%, reflects on the pitch slider).
  - **Spectrum/waveform visualizers** per deck and a master spectrum in the mixer bar (via `AnalyserNode`, 30+ FPS).
- **Persistence** via `localStorage`: API key, last queries, last video IDs, EQ, DJ filter, pitch per deck are saved and restored on reload and on mode switch.
- **One-click launch scripts**: `start.sh` (macOS/Linux/WSL) and `start.bat` (Windows) start the local Express server on port 5400 and open the app in your default browser.
- **Responsive**: collapses to a single column on small screens.

---

## 🚀 Getting started

### 1. Open the app

Double-click `index.html` to open it via `file://`. The YouTube players work in this mode.

### 2. (Recommended) Start the local Express server

The Express server is the recommended way to run the application. It serves the frontend and provides the local `yt-dlp` extraction required by **DJ mode**. Install Node.js, run `npm install`, make sure `yt-dlp` is installed, then start:

```bash
npm install
npm start
```

Open <http://localhost:5400> in your browser. Without `yt-dlp`, the frontend still starts, but DJ mode falls back to Piped/IFrame.

> 🎛️ **How DJ mode works now (file-cache extraction)** — instead of relaying YouTube's fragile CDN URLs (which get blocked by 403 on open Range requests and throttled to ~30 KB/s), the server **downloads the full audio once** via `yt-dlp -x` (which handles YouTube's throttling/signatures internally), extracts it to an MP3 with **ffmpeg**, and caches it on disk (`cache/audio/<videoId>.mp3`). The client then streams this local file with native HTTP Range support (`206` on `bytes=0-` → the Web Audio tee and scratch work flawlessly). Track metadata (title, thumbnail, uploader) comes from YouTube's fast **oEmbed** endpoint (`/api/streams/:id` answers in ~0.15 s, no `yt-dlp` involved), and `yt-dlp` is **only** invoked on the first `/api/audio/:id` of a track — the server boot no longer waits on it.
>
> ⚠️ **`yt-dlp` version matters** — the **stable** Homebrew release (`2026.07.04`) is known to be **broken for DJ mode**: with `-x` it fails to download (`HTTP Error 403`, the `c=ANDROID_VR` client it selects is non-replayable). A `brew upgrade yt-dlp` can silently break the app this way. The fix is to install the **nightly** build of `yt-dlp` (≥ `2026.08.18`), which uses the `visionos` client and downloads fine.
>
> Install the nightly on macOS (place it before the brew binary in your PATH):
> ```bash
> sudo curl -L https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp_macos -o /usr/local/bin/yt-dlp
> sudo chmod +x /usr/local/bin/yt-dlp
> sudo mv /opt/homebrew/bin/yt-dlp /opt/homebrew/bin/yt-dlp.brew   # so the nightly wins
> hash -r
> yt-dlp --version   # should show 2026.08.x (not 2026.07.04)
> ```
> `ffmpeg` is also required for the audio extraction (`yt-dlp -x`). It is checked at server boot.
>
> **Note on load time**: the first time a track is loaded, extraction (`yt-dlp -x` + ffmpeg) takes ~10–15 s while the full file is downloaded and converted. This cost is paid **once per track** — the resulting MP3 is cached on disk and served instantly on every subsequent load (and survives server restarts). The HTML and metadata are fast to load: the server no longer runs the slow `yt-dlp --version` check at startup, and `/api/streams/:id` uses oEmbed (~0.15 s) instead of a full `yt-dlp -J` extraction.

For search only, a static server is also possible. The `fetch()` call to the YouTube Data API can be blocked under `file://` (notably on Chrome):

**Option A — Python (built-in)**

```bash
python3 -m http.server 8000
```

**Option B — Node.js (via npx)**

```bash
npx serve -p 8000
```

Then open <http://localhost:8000> in your browser.

**Option C — One-click launch script**

Start the server and open the browser in a single command:

- macOS / Linux / WSL: `./start.sh`
- Windows: double-click `start.bat` (or run it in a terminal)

The scripts start the Express server and open <http://localhost:5400> automatically.

### 3. Configure the YouTube Data API key (optional)

Keyword search works **even without a key** thanks to the public Piped API. A YouTube Data API key remains **optional**: it provides more relevant music results, official pagination, and avoids relying on Piped instances (which can be slow or unavailable). It is free to create, but Google applies a daily usage quota. No programming knowledge is required:

1. Open [Google Cloud Console](https://console.cloud.google.com/) and sign in with your Google account.
2. Create a project: use the project selector at the top of the page → **New project** → give it any name (for example, `YT Music Mixer`) → **Create**. If you already have a project selected, you can use it instead.
3. In the left menu, open **APIs & Services** → **Library**. Search for **YouTube Data API v3**, open it, then click **Enable**.
4. Open **APIs & Services** → **Credentials** → **Create credentials** → **API key**. Google displays a new key: click the copy button.
5. Return to the mixer, open ⚙️ **Settings**, paste the key, and save. You can now search by text/track name in either deck.

The key is stored only in this browser (`localStorage`) and is sent only to Google when the app performs a search. Do not share it or commit it to a public repository.

#### Recommended: restrict the key

In Google Cloud Console, open **APIs & Services** → **Credentials**, select the key you created, and choose **Restrict key**:

- Under **API restrictions**, select **Restrict key** and allow only **YouTube Data API v3**.
- If you host the app on a website, under **Application restrictions** choose **Websites** and add that site's address.
- For local use, add `http://localhost:5400/*` if you use the included launch script or the Express server. Add the exact address and port you actually use. Restrictions that omit the address in use will make search fail.

> Without a key, the app works fully: keyword search automatically uses the public Piped API (no Google quota), and you can also paste a YouTube URL (`youtu.be/...`, `watch?v=...`) or a raw video ID. Rate-limiting of the official API (quota exceeded / 429) is also handled gracefully — the panel shows a warning instead of an error, and you can fall back to URL/ID entry.
>
> ⚠️ **Piped reliability**: public Piped instances can be slow or unavailable (they change often). The app tries several in cascade, but if all fail, search returns nothing. In that case, use a YouTube Data API key or paste a URL/ID directly.

---

## 🗂️ Architecture

```
yt-music-web-mixer/
├── CLAUDE.md            # Agent guide (specification)
├── README.md            # this file
├── index.html           # structure: header, A | B zone, mixer bar
├── server/
│   └── server.js        # Express server, yt-dlp extraction and same-origin audio relay
├── css/
│   └── styles.css       # 2-column grid layout + fixed bottom bar + DJ controls
└── js/
    ├── config.js        # constants, API key and player configuration
    ├── youtube.js       # YouTube IFrame API wrapper (IFrame fallback)
    ├── piped-streams.js # local backend first, Piped stream fallback, cache and refresh
    ├── audio-player.js  # audio player used by DJ mode (autoplay-safe, optimistic play/pause)
    ├── audio-engine.js  # Web Audio graph: source, EQ, filter, gain, analyser and pitch
    ├── visualizer.js    # canvas spectrum/waveform via AnalyserNode
    ├── bpm-detector.js  # real-time BPM detection (spectral flux + histogram, provisional BPM then locking, states idle/detecting/estimating/locked)
    ├── deck-controls.js # per-deck transport buttons (optimistic play/pause)
    ├── search.js        # YouTube Data API + Piped (keyless) search + results display
    ├── mixer.js         # crossfade logic (GainNode in DJ mode, volume in IFrame mode)
    └── app.js           # bootstrap, event wiring, mode and global state
```

**Stack**: HTML + CSS + vanilla JS frontend, with an optional Node/Express local server. No bundler and no frontend framework. `file://` is suitable for the basic IFrame player; `http://localhost:5400` is recommended for search, local extraction and DJ mode.

---

## 🎛️ Usage

1. Start the Express server for the full experience, then in **deck A**, search for or paste a track → select it → it loads into player A (sound is enabled automatically).
2. Do the same for **deck B**.
3. (Optional) Toggle **🔇 / 🔊** on a deck to mute/unmute individually.
4. Start playback (**▶️ Play both**), or use the per-deck play/pause button.
5. Move the **crossfader** to gradually transition from A to B. In DJ mode this uses Web Audio gain nodes; in IFrame mode it controls player volumes.
6. Adjust the **master volume** as needed.
7. **DJ mode only**: tweak the per-deck **EQ** (Low/Mid/High), **DJ filter**, **pitch/tempo** slider, and watch the **BPM** badge (red during acquisition, **orange** as soon as a provisional BPM appears, **green** when locked). The **RAZ** (↺) button under the BPM value restarts detection at any time. The **RAZ** buttons next to the vertical DJ sliders reset each slider to neutral. Press **SYNC** to match deck B's tempo to deck A.
8. Optional: **Sync B → A** to align B to A's position.

---

## ⚠️ Known limitations

- **IFrame mode limitations.** The YouTube IFrame API does not expose the audio stream (cross-origin, no CORS). Mixing is done **only via volume control** (`setVolume`); EQ, filters and automatic tempo sync are unavailable.
- **DJ mode requires the local backend or a usable Piped fallback.** The Express server uses `yt-dlp` and relays audio same-origin through `/api/audio/:id`. If `yt-dlp` is unavailable or extraction fails, the player tries Piped audio streams; if that also fails, it falls back to IFrame mode.
- **DJ mode is audio-only.** The extracted/DSP path does not display the YouTube video; use IFrame mode when video playback is needed.
- **Dual playback is resource-heavy.** Playing 2 decks simultaneously can be demanding (CPU, RAM, network). Recommendations:
  - Close other heavy tabs.
  - On a modest machine, prefer a single deck at a time.
  - If playback stutters, lower the quality on YouTube's side (not controllable by the app).
- **YouTube Data API quotas.** 10,000 units/day by default, one search = 100 units. Beyond that, official search is blocked until the next day. The keyless **Piped search mode** does not use this Google quota, but public Piped instances can be unavailable.
- **Continuous sync is imperfect.** A residual offset of 200–500 ms is normal (seeking + buffering causes a micro-gap). No *frame-accurate* sync is possible on YouTube.
- **BPM detection is approximate** (±2–3 BPM). Transitions, builds and breaks can fool the detector. A **provisional BPM** (orange) appears after ~2-3 s so the readout isn't empty, then the histogram refines in the background until locking (green). The locked value is only refreshed on a real change (>3%) to avoid flicker. The **RAZ** (↺) button restarts detection on demand.
- **DJ controls are Piped/DSP-only.** EQ, filter, pitch, BPM and visualizers require the local backend (or a CORS-usable Piped fallback). They are hidden in IFrame mode.
- **Limited persistence.** In private browsing or after clearing the cache, `localStorage` data is lost.
- **Autoplay.** Players start `muted` on initial page load. Sound is automatically enabled when you select a new track (the selection click counts as a user gesture). In DJ mode, playback also auto-starts after the audio stream is ready; the first play/pause click on a deck updates the button immediately (optimistic) and is confirmed/corrected by the player state.

---

## 📜 License

Personal/educational project. Use in accordance with YouTube's terms of service.

---

## 🤖 How this project was built

This project was developed as a collaboration between several coding agents and AI models, directed by the author:

- **[Zed](https://zed.dev)** editor's built-in coding agent
- **[claude-code](https://www.npmjs.com/package/@anthropic-ai/claude-code)** — Anthropic's CLI coding assistant
- **[wrapper-scionos](https://www.npmjs.com/package/wrapper-scionos)** — a wrapper used to orchestrate calls to various agents or models

The models that powered these agents:

- **GLM-5.2** (Zhipu AI)
- **Kimi-K3** (Moonshot AI)
- **MiniMax M3** (MiniMax)

All agents and models were piloted and coordinated by the author, who defined the architecture, reviewed the output, and assembled the final code.

---

## 🙏 Thanks

Thanks to **[RouterLab.ch](https://routerlab.ch/)** for providing access to the various models used in this project.

# 🎵 YT Music Web Mixer

A **serverless** web app (plain HTML + JS) that lets you load 2 YouTube tracks side by side (decks **A** and **B**) and mix them via a **crossfader** at the bottom of the page.

> ⚠️ The "mixing" here is a **volume crossfade**: we control the relative volume of each YouTube player. No DSP processing (EQ, filters, beatmatching) is possible on YouTube audio — see [Known limitations](#-known-limitations).

---

## ✨ Features

- **2 side-by-side decks** (A on the left, B on the right), each with its own YouTube player and search bar.
- **YouTube search** by keyword **without any API key** thanks to the public [Piped](https://docs.piped.video/) API (alternative YouTube frontend, CORS-enabled, no Google quota). Multiple Piped instances are tried in cascade for reliability. A YouTube Data API key remains optional for more relevant results and official pagination. Manual entry of a URL / video ID is also supported.
- **Search mode toggle button**: when an API key is configured, a 🟢/⚪ button lets you force search via Piped (preserves Google quota) or switch back to the official YouTube Data API. The choice is persisted in `localStorage`.
- **A↔B crossfader** (0 = full A, 100 = full B, 50 = balanced) with an *equal-power* curve to avoid the level dip in the middle.
- **Global master volume** (0–100%).
- **Per-deck mute/unmute buttons** (required to work around browser autoplay policies).
- **Playback controls**: *play both* / *pause both*.
- **Sync B → A**: align B to A's position (one-shot or continuous).
- **Auto-unmute on track change**: selecting a new track automatically enables sound (the click counts as a user gesture for autoplay policies).
- **Separate A/B volume readout**: the crossfade bar shows individual volume percentages for each deck.
- **Mixer-style crossfade thumb**: rectangular 15×30px handle with `ew-resize` cursor, like a hardware mixer fader.
- **Persistence** via `localStorage`: API key, last queries, and last video IDs are saved. Queries are restored in the search fields on reload.
- **One-click launch scripts**: `start.sh` (macOS/Linux/WSL) and `start.bat` (Windows) start a local server on port 8000 and open the app in your default browser.
- **Responsive**: collapses to a single column on small screens.

---

## 🚀 Getting started

### 1. Open the app

Double-click `index.html` to open it via `file://`. The YouTube players work in this mode.

### 2. (Recommended) Serve locally for search

The `fetch()` call to the YouTube Data API can be blocked under `file://` (notably on Chrome). To enable search, start a static server:

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

The script uses Python's built-in server and opens <http://localhost:8000> automatically.

### 3. Configure the YouTube Data API key (optional)

You only need a key for **keyword search**. It is free to create, but Google applies a daily usage quota. No programming knowledge is required:

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
- For local use, add `http://localhost:8000/*` if you use the included launch script or the commands above. Add the exact address and port you actually use. Restrictions that omit the address in use will make search fail.

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
├── css/
│   └── styles.css       # 2-column grid layout + fixed bottom bar
└── js/
    ├── config.js        # constants, read API key from localStorage
    ├── youtube.js       # YouTube IFrame API wrapper (loading, A/B players)
    ├── search.js        # YouTube Data API search + results display
    ├── mixer.js         # crossfade logic (slider → A/B volumes)
    └── app.js           # bootstrap, event wiring, global state
```

**Stack**: HTML + CSS + vanilla JS. No dependencies, no bundler, no framework. Works under `file://` (players) or via a static server (search).

---

## 🎛️ Usage

1. In **deck A**, search for or paste a track → select it → it loads into player A (sound is enabled automatically).
2. Do the same for **deck B**.
3. (Optional) Toggle **🔇 / 🔊** on a deck to mute/unmute individually.
4. Start playback (**▶️ Play both**).
5. Move the **crossfader** to gradually transition from A to B.
6. Adjust the **master volume** as needed.
7. Optional: **Sync B → A** to align B to A's position.

---

## ⚠️ Known limitations

- **No real DSP mixing.** The YouTube IFrame API does not expose the audio stream (cross-origin, no CORS). Mixing is done **only via volume control** (`setVolume`). No EQ, no automatic tempo sync.
- **Dual playback is resource-heavy.** Playing 2 YouTube videos simultaneously can be demanding (CPU, RAM, network). Recommendations:
  - Close other heavy tabs.
  - On a modest machine, prefer a single deck at a time.
  - If playback stutters, lower the quality on YouTube's side (not controllable by the app).
- **YouTube Data API quotas.** 10,000 units/day by default, one search = 100 units. Beyond that, search is blocked until the next day.
- **Continuous sync is imperfect.** A residual offset of 200–500 ms is normal (seeking + buffering causes a micro-gap). No *frame-accurate* sync is possible on YouTube.
- **Limited persistence.** In private browsing or after clearing the cache, `localStorage` data is lost.
- **Autoplay.** Players start `muted` on initial page load. Sound is automatically enabled when you select a new track (the selection click counts as a user gesture). You can still mute/unmute per deck at any time.

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

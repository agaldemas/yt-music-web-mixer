# 🎵 YT Music Web Mixer

A web app built with plain HTML + JS that lets you load 2 YouTube tracks side by side (decks **A** and **B**) and mix them via a **crossfader** at the bottom of the page.

The recommended setup uses the local Express server and `yt-dlp`: the server extracts and relays the audio, allowing the player to use the **DJ mode** with Web Audio DSP. An IFrame fallback remains available when audio extraction is unavailable.

> ⚠️ In **IFrame mode**, mixing is a **volume crossfade** only. In **DJ mode**, the extracted audio can be processed with the Web Audio API (EQ, filters, analysis and tempo-related features).

---

## ✨ Features

- **2 side-by-side decks** (A on the left, B on the right), each with its own player and search bar.
- **DJ mode**: local Express backend + `yt-dlp` extraction, same-origin audio relay and Web Audio processing for real audio crossfading, EQ, per-deck gain trim, filters, analysis and scratch. If the local backend is unavailable, the player can fall back to audio streams from Piped instances when CORS allows it.
- **YouTube search** by keyword **without any API key** thanks to the public [Piped](https://docs.piped.video/) API (alternative YouTube frontend, CORS-enabled, no Google quota). Multiple Piped instances are tried in cascade for reliability. A YouTube Data API key remains optional for more relevant results and official pagination. Manual entry of a URL / video ID is also supported.
- **Search mode toggle button**: when an API key is configured, a 🟢/⚪ button lets you force search via Piped (preserves Google quota) or switch back to the official YouTube Data API. The choice is persisted in `localStorage`.
- **Search results panel**: previous/next pagination controls plus a `▲`/`▼` toggle in the pagination toolbar to collapse or expand results without clearing their content. The existing `✕` button still clears the query and results.
- **Hover information popup**: after ~500 ms over a result card, a tooltip shows views, a validated publication date (relative for recent videos, exact date for older videos) and the complete YouTube description (the content revealed by YouTube's “more”/details: tracklists, links and credits). The description is fetched first from the local backend (`/api/description/:id`, `yt-dlp --print description`, server-side 24-hour cache), then YouTube Data API, then Piped. The popup stays visible for **4 seconds** after leaving the card, and hovering the popup cancels the closing timer so its text can be selected/copied. A click outside closes it immediately. A 500 ms debounce prevents request bursts while moving across the grid.
- **Live stream detection**: live results show a **🔴 LIVE** badge instead of duration. Clicking a live result asks for confirmation because a live stream has no known end and server extraction may run indefinitely.
- **YouTube link per result**: each card includes a compact red YouTube play icon (~18×13 px). It shows the video ID in its tooltip, asks for confirmation, then opens the video on YouTube in a new tab without loading it into the deck.
- **Enriched now-playing bar**: the current track bar (`.deck-nowplaying`) shows two right-aligned buttons — the **YouTube ▶ button** (same look as the result-card icon: full `https://www.youtube.com/watch?v=<id>` link, confirmation before opening) and an **info “!” button** that opens the **full track description** in an overlay popup. The popup is attached to `<body>` (`position: fixed`, `z-index: 1000`) so it always renders on top (above the scratch platter and the analyser), is capped at **500 px tall** (scrollable body), and closes via the **✕** button at top-right or **Escape**. The description is fetched **once per track** (in-memory cache) through `/api/description/:id` (same pipeline as the search popup), and the popup is cleanly rebuilt on every track change (no duplicates between decks A/B or between successive tracks).
- **Search robustness**: result IDs are strictly validated at normalization, selection and startup restoration. Lowercase 11-character search terms such as `groundation` cannot be mistaken for video IDs and sent to `/api/streams/:id`.
- **Per-deck gain trim** (±10 dB, neutral at 0 dB) before the crossfader, with live dB readout, persistence, double-click reset and a dedicated `↺` reset button.
- **Scratch / platter** in DJ mode: lazy full-track buffer decoding, bidirectional scratch playback, position-preserving release and reduced debug logging (important engage/release milestones remain visible).
- **Save current track locally (`💾 Save local`)**: each deck has a `💾 Save local` button (right of `📁 Load local`) that saves the current MP3 to your disk. The suggested filename is `<title>-<artist>.mp3` and the file includes YouTube metadata (title, artist, album, date, genre…) **plus the cover art** (APIC/ID3, written server-side) **and a compact ID3 comment** (`YTWM:` JSON with the video ID, duration and ISO upload date — view counts are intentionally NOT embedded, they are of no use inside an audio file). Works in **DJ mode** on a YouTube source; disabled for local files (already on disk).
- **Cached popup metadata**: the popup info shown on hover (views, publication date, full description) comes from a disk cache (`cache/meta/<id>.json`). The server fetches each piece of information **once** (fast oEmbed + a lightweight `yt-dlp --skip-download` for views/date/description), then serves it straight from disk — no repeated upstream requests, no `yt-dlp` on every hover. `/api/streams/:id` also returns these fields so the client can display the popup with **zero extra network request** once a track is loaded.
- **A↔B crossfader** (0 = full A, 100 = full B, 50 = balanced) with an *equal-power* curve to avoid the level dip in the middle.
- **Global master volume** (0–100%).
- **Per-deck mute/unmute buttons** (required to work around browser autoplay policies).
- **Playback controls**: *play both* / *pause both*, plus per-deck play/pause.
- **Sync B → A**: align B to A's position (one-shot or continuous).
- **Auto-unmute on track change**: selecting a new track automatically enables sound (the click counts as a user gesture for autoplay policies).
- **Separate A/B volume readout**: the crossfade bar shows individual volume percentages for each deck.
- **Mixer-style crossfade thumb**: rectangular 15×30px handle with `ew-resize` cursor, like a hardware mixer fader.
- **DJ controls (Piped/DSP mode only)**:
  - **3-band EQ** (Low / Mid / High, ±12 dB) per deck with live dB readout, double-click reset and a dedicated `↺` reset button.
  - **DJ filter** sweep (lowpass ↔ highpass, log-scale knob) per deck with live `LP x%` / `HP x%` / `OFF` readout and reset to bypass.
  - **Pitch / tempo** slider (±8%) per deck with `preservesPitch` (tempo change without pitch shift), double-click reset, BPM readout shows the *effective* BPM (`bpm × playbackRate`).
  - **RAZ (reset) buttons** (↺) next to each vertical DJ slider for one-click reset to neutral.
  - **Real-time BPM detection** per deck (spectral-flux onset + histogram of inter-beat intervals, locking after stable cycles). Three visual states: **red** during acquisition (`idle`/`detecting`), **orange** as soon as a provisional BPM is available (~2-3 s, `estimating` state), **green** when the value is locked (`locked`). The provisional BPM is computed by median of intervals and shown early, while the histogram keeps refining in the background until locking. The **RAZ** (↺) button under the value stays visible at all times to restart detection. The locked value only updates on a real change (>3%) to avoid flicker.
  - **SYNC button** to match deck B's tempo to deck A (clamped to ±8%, reflects on the pitch slider).
  - **Spectrum/waveform visualizers** per deck and a master spectrum in the mixer bar (via `AnalyserNode`, 30+ FPS).
- **Persistence** via `localStorage`: API key, last queries, last video IDs, gain trim, EQ, DJ filter, pitch per deck are saved and restored on reload and on mode switch.
- **One-click launch scripts**: `start.sh` (macOS/Linux/WSL) and `start.bat` (Windows) start the local Express server on port 5400 and open the app in your default browser.
- **Windows install script (`install.bat`)**: double-click it after the `git clone` to automatically install **Git, Node.js LTS, yt-dlp nightly, ffmpeg/ffprobe** and the project's npm dependencies (via `winget` or PowerShell as a fallback).
- **Step Sequencer & Drum Machine**: standalone page at `/sequencer` with a 9-track × 16-step programming matrix and an interactive top-down drum kit. Each track has its own **Volume / Mute / Solo** controls; **🗑 Clear** wipes the grid, **🎲 Randomize** generates a musical pattern (deterministic — same seed every click), **🎵 Presets** loads hand-coded Rock 4/4, House/Electro, Trap/Hip-hop, Funk/Disco or Reggae/Dub (one-drop), and the **Rythmes** menu offers 20 patterns from Musicca (Pop rock, Jazz, Funk, Disco, Hip-hop, Heavy metal) with BPM + swing applied automatically. Charleston pedal toggles the open/closed state without playing a sound on the pedal itself. See [Sequencer User Guide](sequencer-use.md).
- **Responsive**: collapses to a single column on small screens.

---

## 🚀 Getting started

### 1. Installation

> 🚀 **On Windows?** The easiest way is to **double-click `install.bat`** (at the project root, after the `git clone`): it installs **Git, Node.js LTS, yt-dlp nightly and ffmpeg/ffprobe** automatically (via `winget` or PowerShell as a fallback), then runs `npm install`. Once `install.bat` is done, run `start.bat` to start the app. Everything below (subsections 1.1 → 1.5) is the **detailed / manual** version: useful to understand what `install.bat` does under the hood, or if you want to install dependencies one by one (e.g. on macOS/Linux, or if `install.bat` does not fit your environment).

This section describes how to **fetch the source code** and **install the dependencies** (Node.js, `yt-dlp`, `ffmpeg`) — the focus is **Windows**, where none of these tools are preinstalled. On macOS or Linux, just ignore the Windows-specific subsections.

#### 1.1 Get the project (Git)

The recommended way is to clone the repo with **Git**: you can then pull updates with a simple `git pull`. If you don't have Git yet, see “Install Git” below.

```bash
git clone https://github.com/agaldemas/yt-music-web-mixer.git
cd yt-music-web-mixer
```

> 💡 You don't need a GitHub account — the clone above is **read-only**, no authentication required.

##### Install Git

**Windows** — install **Git for Windows** (provides Git Bash, the Explorer context menu and `git` on the command line):

1. Download the installer from <https://git-scm.com/download/win>.
2. Run the downloaded `.exe`. Keep the default options (add to PATH, Explorer integration, LF/CRLF auto-conversion — important if you edit code).
3. Open a new `PowerShell` or `Git Bash` window and check:

    ```powershell
    git --version
    ```

    Must print `git version 2.x`. If Windows asks you to confirm adding it to the PATH, say yes.

**macOS** — Xcode Command Line Tools are enough:

```bash
xcode-select --install   # one-off
git --version
```

**Linux (Debian/Ubuntu)**:

```bash
sudo apt update && sudo apt install -y git
git --version
```

#### 1.2 Install Node.js (Windows) — only to run this project

> The project requires **Node.js 22.12+** or **24 LTS** (see `package.json` → `engines.node`). You do **not** install Node *via* npm — npm is bundled with Node, so installing Node brings npm along automatically.

**Recommended method: official Windows installer (.msi)**

1. Go to <https://nodejs.org/en/download> and download the **Windows Installer (.msi)** for the **LTS** branch (recommended) or **Current** (≥ 22.12) if you know what you're doing.
2. Run the `.msi`. On the **Custom Setup** screen, make sure **“Add to PATH”** and **“npm package manager”** are checked, then click **Next → Install**.
3. At the end, leave **“Install additional tools for native modules”** checked if offered (optional but useful).

**Alternative (no installer, for advanced users) — winget / Chocolatey / Scoop**

```powershell
# winget (built into recent Windows 10/11)
winget install -e --id OpenJS.NodeJS.LTS

# Chocolatey (admin PowerShell)
choco install nodejs-lts

# Scoop
scoop install nodejs-lts
```

##### Verification

**Open a new PowerShell window** (PATH changes only apply to new shells), then:

```powershell
node --version    # should print v22.12.x or v24.x.x
npm --version     # should print a version ≥ 10
where.exe node    # should print the binary path
```

> ⚠️ If `node` is not recognized, close **all** open PowerShell/VS Code/Explorer windows and reopen — modified PATH values only propagate to the next login shell.

> ⚠️ **Important for this project**: do **not** install Node from the Microsoft Store on Windows (the PATH is virtual, some extensions can't find it, and the project refuses to start). Prefer the `.msi` installer, `choco`, `scoop` or `winget` as shown above.

##### For macOS / Linux (quick reminder)

- **macOS**: `brew install node` (Homebrew installs Node LTS + npm).
- **Linux (Debian/Ubuntu)**: `sudo apt install -y nodejs npm`, or Nodesource (recommended for a recent version):

    ```bash
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt install -y nodejs
    ```

#### 1.3 Install `yt-dlp` and `ffmpeg`

These two binaries are **required for DJ mode** (audio extraction + conversion).

##### Windows

**Recommended option — `winget`** (simplest, auto-updates):

```powershell
winget install -e --id yt-dlp.yt-dlp
winget install -e --id Gyan.FFmpeg
```

**Manual install for `yt-dlp`**:

1. Download `yt-dlp.exe` from the **Windows (exe)** asset: <https://github.com/yt-dlp/yt-dlp/releases/latest> (or the nightly: <https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest>).
2. Place the executable in a folder already on your `PATH` (easiest: `C:\Users\<you>\bin\`) **or** add its folder to your user-level `PATH`:
    - Control Panel → System → Advanced system settings → **Environment Variables** → `Path` (user) → **Edit** → **New** → paste the folder path.
3. Open a **new** PowerShell and check:

    ```powershell
    yt-dlp --version
    ```

    Must print `2026.08.x` (nightly) or newer. **Important**: the Homebrew/Chocolatey stable `2026.07.04` is broken for this project (see warning below) — use the **nightly**, or let winget keep it up to date.

**Manual install for `ffmpeg`**:

1. Go to the **Windows builds** page: <https://www.gyan.dev/ffmpeg/builds/> and download the **release full** build (`ffmpeg-release-essentials.zip` is enough for this project).
2. Unzip the archive and copy the contents of the `bin/` folder (at least `ffmpeg.exe`, `ffprobe.exe`) into the same folder as `yt-dlp.exe` above.
3. Verify:

    ```powershell
    ffmpeg -version
    ffprobe -version
    ```

##### macOS

```bash
brew install yt-dlp ffmpeg
```

Then install the **nightly** `yt-dlp` on top (the stable Homebrew version is broken for this project, see warning):

```bash
sudo curl -L https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp_macos -o /usr/local/bin/yt-dlp
sudo chmod +x /usr/local/bin/yt-dlp
sudo mv /opt/homebrew/bin/yt-dlp /opt/homebrew/bin/yt-dlp.brew   # so the nightly wins
hash -r
yt-dlp --version   # should print 2026.08.x (not 2026.07.04)
```

##### Linux (Debian/Ubuntu)

```bash
sudo apt update
sudo apt install -y ffmpeg
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod +x /usr/local/bin/yt-dlp
yt-dlp --version
```

#### 1.4 Install the project's Node dependencies

Once the repo is cloned and Node is installed:

```bash
cd yt-music-web-mixer
npm install
```

This downloads `express` and `jsdom` (see `package.json`). No compilation, no build step — it's plain JavaScript.

> 🛡️ **If `npm install` fails behind a corporate proxy**, configure npm:
> ```bash
> npm config set proxy http://proxy.company:8080
> npm config set https-proxy http://proxy.company:8080
> ```

#### 1.5 Preflight check (all-in-one)

Before going any further, run this small diagnostic. It checks in a single command that **Git**, **Node.js**, **npm**, **`yt-dlp`**, **`ffmpeg`** and **`ffprobe`** are all present and at the right version. If a line is missing or in error, jump back to the matching subsection (1.1, 1.2 or 1.3) — **do not move on to step 2 until every line is green**.

##### Windows (PowerShell)

```powershell
# Run this in a PowerShell window OPENED AFTER the installations
# (otherwise the new PATH entries are not visible yet).

Write-Host "--- System tools ---"
Write-Host ("git      : {0}" -f ((& git --version) 2>$null  -join ' '))
Write-Host ("node     : {0}" -f ((& node --version) 2>$null  -join ' '))
Write-Host ("npm      : {0}" -f ((& npm --version)  2>$null  -join ' '))
Write-Host ("yt-dlp   : {0}" -f ((& yt-dlp --version) 2>$null -join ' '))
Write-Host ("ffmpeg   : {0}" -f ((& ffmpeg -version) 2>$null  -join ' '))
Write-Host ("ffprobe  : {0}" -f ((& ffprobe --version) 2>$null -join ' '))

Write-Host ""
Write-Host "--- Node dependencies (npm) ---"
if (Test-Path .\package.json) {
    Write-Host ("package.json : present (Node {0} required)" -f (node -p "require('./package.json').engines.node"))
} else {
    Write-Host "package.json : MISSING — are you inside the yt-music-web-mixer folder?"
}

Write-Host ""
Write-Host "--- Ports / connectivity ---"
Test-NetConnection -ComputerName 127.0.0.1 -Port 5400 -InformationLevel Quiet -WarningAction SilentlyContinue `
    | ForEach-Object { Write-Host ("port 5400 (free={0})" -f $_) }
```

##### macOS / Linux (bash)

```bash
# Run this in a terminal OPENED AFTER the installations.

echo "--- System tools ---"
printf 'git      : %s\n' "$(git --version 2>&1)"
printf 'node     : %s\n' "$(node --version 2>&1)"
printf 'npm      : %s\n' "$(npm --version 2>&1)"
printf 'yt-dlp   : %s\n' "$(yt-dlp --version 2>&1)"
printf 'ffmpeg   : %s\n' "$(ffmpeg -version 2>&1 | head -n1)"
printf 'ffprobe  : %s\n' "$(ffprobe -version 2>&1 | head -n1)"

echo
echo "--- Node dependencies (npm) ---"
if [ -f package.json ]; then
  echo "package.json : present (Node $(node -p "require('./package.json').engines.node") required)"
else
  echo "package.json : MISSING — are you inside the yt-music-web-mixer folder?"
fi

echo
echo "--- Port 5400 (used by the Express server) ---"
if command -v lsof >/dev/null 2>&1; then
  lsof -iTCP:5400 -sTCP:LISTEN 2>/dev/null && echo "⚠️  port 5400 already in use" || echo "port 5400 : free ✓"
elif command -v ss >/dev/null 2>&1; then
  ss -ltn 'sport = :5400' 2>/dev/null | tail -n +2 | grep -q . && echo "⚠️  port 5400 already in use" || echo "port 5400 : free ✓"
else
  echo "(install 'lsof' or 'ss' to enable this check)"
fi
```

##### Expected output

Every line must show up (no error message, no `command not found`, no `is not recognized`):

| Tool       | Expected version                             | Note |
|------------|----------------------------------------------|------|
| `git`      | `git version 2.x`                            | Anything ≥ 2.0 |
| `node`     | `v22.12.x` or `v24.x` or newer               | **Must** be ≥ 22.12 (see `engines.node` in `package.json`) |
| `npm`      | `10.x` or newer                              | Bundled with Node |
| `yt-dlp`   | `2026.08.x` or newer                         | ⚠️ **Avoid `2026.07.04`** (broken for this project: non-replayable `ANDROID_VR` client) |
| `ffmpeg`   | `ffmpeg version 4.x` to `7.x`                | Any recent build |
| `ffprobe`  | same version as `ffmpeg`                     | Must come with `ffmpeg` |
| `port 5400`| `free ✓`                                     | If already taken, step 3 (`npm start`) will refuse to start |

##### Quick diagnostics

- **`'git' is not recognized` (Windows)**: close all shells and reopen a fresh PowerShell (PATH not yet propagated). If it persists: `where.exe git` should return a path; if not, Git was not installed → go back to 1.1.
- **`'node' is not recognized`**: same reflex — reopen a shell. Otherwise Node was not added to the PATH during the `.msi` install → reinstall and tick "Add to PATH".
- **`yt-dlp` too old (`2026.07.04`)**: pip / winget / chocolatey can reinstall it on top; otherwise grab the nightly from <https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest>.
- **`'ffmpeg'/'ffprobe' not found`**: the folder containing the `.exe` files is not in `PATH` → see Environment Variables, point 1.3.
- **`port 5400: already in use`**: another server is on that port (or a forgotten `npm start`). On Windows: `netstat -ano | findstr :5400` then `taskkill /PID <pid> /F`. On macOS/Linux: `lsof -iTCP:5400 -sTCP:LISTEN` then `kill <pid>`.

> ✅ If everything is green, you can jump to [step 2 “Open the app”](#2-open-the-app) or, better, directly to [step 3 “Start the local Express server”](#3-recommended-start-the-local-express-server) for the full DJ mode.

### 2. Open the app

Double-click `index.html` to open it via `file://`. The YouTube players work in this mode.

### 3. (Recommended) Start the local Express server

The Express server is the recommended way to run the application. It serves the frontend and provides the local `yt-dlp` extraction required by **DJ mode**. Install Node.js, run `npm install`, make sure `yt-dlp` is installed, then start:

```bash
npm install
npm start
```

Open <http://127.0.0.1:5400>. Without `yt-dlp` or `ffmpeg`, auto mode starts cleanly in IFrame mode without triggering audio extraction. Local file import remains available and activates the Web Audio engine automatically.

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

The scripts start the loopback-only Express server and open <http://127.0.0.1:5400> automatically.

### 4. Configure the YouTube Data API key (optional)

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
- For local use, add `http://127.0.0.1:5400/*` if you use the included launch script or the Express server. Add the exact address and port you actually use. Restrictions that omit the address in use will make search fail.

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
│   ├── server.js        # Express factory/startup, protected routes and extraction
│   ├── task-queue.js    # bounded extraction queue
│   └── cache-manager.js # audio cache quota and eviction
├── css/
│   └── styles.css       # 2-column grid layout + fixed bottom bar + DJ controls
└── js/
    ├── config.js        # constants, API key and media limits
    ├── local-api.js     # in-memory local session and authenticated API fetch
    ├── id3.js           # shared ID3v2.3/v2.4 parser
    ├── youtube.js       # YouTube IFrame API wrapper (IFrame fallback)
    ├── piped-streams.js # local backend first, Piped stream fallback, cache and refresh
    ├── local-load.js    # local audio/video file import (knowledge "Load local" buttons, ID3 metadata extraction)
    ├── local-save.js    # save current MP3 (knowledge "Save local" buttons, <title>-<artist>.mp3, showSaveFilePicker)
    ├── audio-player.js  # audio player used by DJ mode (autoplay-safe, optimistic play/pause)
    ├── audio-engine.js  # Web Audio graph: source, trim, EQ, filter, gain, analyser and pitch
    ├── visualizer.js    # canvas spectrum/waveform via AnalyserNode
    ├── bpm-detector.js  # real-time BPM detection (spectral flux + histogram, provisional BPM then locking, states idle/detecting/estimating/locked)
    ├── deck-controls.js # per-deck transport buttons (optimistic play/pause)
    ├── search.js        # YouTube Data API + Piped (keyless) search + result panel and pagination/collapse controls
    ├── mixer.js         # crossfade logic (GainNode in DJ mode, volume in IFrame mode)
    └── app.js           # bootstrap, event wiring, mode and global state
```

**Stack**: HTML + CSS + vanilla JS frontend, with an optional Node/Express local server. No bundler and no frontend framework. `file://` is suitable for the basic IFrame player; `http://127.0.0.1:5400` is recommended for search, local extraction and DJ mode.

---

## 📐 Program Structure

![Program Structure](program-structure.jpeg)

---

## 🎛️ Usage

1. Start the Express server for the full experience, then in **deck A**, search for or paste a track → select it → it loads into player A (sound is enabled automatically).
2. Do the same for **deck B**.
3. (Optional) Toggle **🔇 / 🔊** on a deck to mute/unmute individually.
4. Start playback (**▶️ Play both**), or use the per-deck play/pause button.
5. Move the **crossfader** to gradually transition from A to B. In DJ mode this uses Web Audio gain nodes; in IFrame mode it controls player volumes.
6. Adjust the **master volume** as needed.
7. **DJ mode only**: use the **GAIN** trim first to balance track levels, then tweak the per-deck **EQ** (Low/Mid/High), **DJ filter**, and **pitch/tempo** slider. Every DJ control shows its live value below the slider and has a nearby **↺** reset button. Watch the **BPM** badge (red during acquisition, **orange** as soon as a provisional BPM appears, **green** when locked). The **RAZ** (↺) button under the BPM value restarts detection at any time. Press **SYNC** to match deck B's tempo to deck A.
8. The search results panel can be browsed with `‹` / `›`, collapsed with `▲`, and reopened with `▼`; collapsing preserves the result cards and does not clear the search. Use `✕` to clear the query and results.
9. Optional: **Sync B → A** to align B to A's position.
10. **Drum sequencer (optional)**: open `http://127.0.0.1:5400/sequencer` (or click 🥁 in the app header). Click any step in the 9×16 grid to toggle it (orange = on, blue = playhead), then press **▶️ Play** to loop at the chosen BPM. Each track has its own **Volume / Mute / Solo** controls on the left. Use **🗑 Clear** to wipe the grid, **🎲 Randomize** to generate a musical pattern, **🎵 Presets** for Rock 4/4 / House / Trap / Funk / Reggae, or **Rythmes** for the 20 Musicca patterns. The hi-hat pedal only toggles the open/closed memory state (no sound on the pedal itself) — the sound is produced only when you hit the hi-hat cymbal.

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

## 🔐 Security, limits, and maintenance

- The server listens only on `127.0.0.1` and rejects non-local Host headers.
- Extraction routes require a same-origin session token kept only in memory.
- Browser-cookie access is disabled by default. Opt in explicitly with `YTDLP_COOKIES_BROWSER=chrome` (or another supported browser).
- The audio cache defaults to **2 GB or 100 tracks**, with LRU eviction.
- At most two extractions run concurrently and the waiting queue is bounded.
- Lives, unknown durations, and tracks over **30 minutes** are rejected by the local DJ backend.
- Full PCM scratch is limited to tracks up to **10 minutes**.
- First launch uses empty decks. The explicit demo is available with `?demo=1`.

### Verification

```bash
npm ci
npm run check:syntax
npm test
npm audit --omit=dev
# Public-network checks are opt-in:
npm run test:network
```

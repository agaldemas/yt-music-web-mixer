# Security Policy

## Scope

This document describes the security model of **YT Music Web Mixer**, a
local-first dual-deck DJ application. The server (`server/server.js`) is
intentionally bound to `127.0.0.1` and is **not** designed to be exposed
on a public network. Threat modeling below assumes a single trusted
operator on the loopback interface.

The CSP and related headers are enforced by the `securityHeaders`
middleware in `server/server.js` (around line 844) and apply to every
response, including `index.html`, `sequencer.html`, static assets, and
API endpoints.

---

## Content Security Policy (CSP)

The full CSP currently in effect:

```
default-src 'self';
base-uri 'self';
object-src 'none';
script-src 'self' https://www.youtube.com https://s.ytimg.com;
style-src 'self' 'unsafe-inline';
worker-src 'self' blob:;
img-src 'self' data: blob: https://*.ytimg.com
       https://*.googleusercontent.com https://*.private.coffee;
media-src 'self' blob: https:;
frame-src https://www.youtube.com https://www.youtube-nocookie.com;
connect-src 'self' blob: data: https://www.youtube.com
            https://*.private.coffee;
form-action 'self';
```

### Why these directives exist

- `default-src 'self'` — Hard baseline: only same-origin resources are
  allowed unless a more specific directive overrides.
- `base-uri 'self'` — Prevents `<base>` tag injection that could redirect
  relative URL resolution to an attacker-controlled origin.
- `object-src 'none'` — Disables legacy `<object>`, `<embed>`, `<applet>`.
  Defense in depth against Flash/Java-style plugin exploits.
- `script-src 'self' https://www.youtube.com https://s.ytimg.com` —
  Scripts may only load from:
  - the local server (`'self'`), so third-party CDNs like `unpkg.com`,
    `cdnjs`, or `jsdelivr` are **automatically rejected** at parse time
    (this is intentional, see "Why Tone.js is bundled locally" below),
  - `https://www.youtube.com` and `https://s.ytimg.com`, the two
    origins required by the YouTube IFrame Player API in fallback mode
    (IFrame fallback path only — when the local DJ mode is unavailable).
- `style-src 'self' 'unsafe-inline'` — Inline styles are tolerated
  because some UI controls set computed `style` properties at runtime
  (sliders, playhead, pad hit-flash). No external stylesheet is needed.
- `worker-src 'self' blob:` — See "Worker policy" below.
- `img-src 'self' data: blob: https://*.ytimg.com
  https://*.googleusercontent.com https://*.private.coffee` — Thumbnails
  and cover art are loaded from YouTube's image CDN and from `private.coffee`
  (Piped image proxy). `data:` and `blob:` allow canvas-generated and
  locally-decoded images.
- `media-src 'self' blob: https:` — Audio and video media can come from
  the local cache and from any HTTPS origin (YouTube audio relays,
  Piped fallbacks). `blob:` allows Web Audio decoded buffers to be played.
- `frame-src https://www.youtube.com https://www.youtube-nocookie.com` —
  The YouTube IFrame Player may be embedded. The `nocookie` variant is
  the privacy-enhanced mode.
- `connect-src 'self' blob: data: https://www.youtube.com
  https://*.private.coffee` — `fetch` / `XHR` / WebSocket / WebRTC
  connections are restricted to local server, blob URLs (Web Audio
  internals), data URLs, YouTube, and Piped.
- `form-action 'self'` — Forms can only POST to the local server. This
  prevents injected `<form>` elements from exfiltrating data to remote
  hosts.

### Why Tone.js is bundled locally

The original `sequencer.html` loaded Tone.js from `https://unpkg.com/tone`
via a `<script src="...">` tag. This **violated `script-src`** at parse
time and the browser refused to execute the script, leaving the
sequencer UI visible but non-functional (no `Tone` global).

Fix: the Tone.js bundle is now vendored under `js/vendor/tone.js` and
served by `app.use('/js', express.static(...))`. Because the resource
origin is the local server, it satisfies `'self'`. No relaxation of
`script-src` was needed and no external CDN is reachable for scripts.

This is the correct trade-off: a one-time ~350 KB vendoring cost in
exchange for a strict, auditable script allowlist.

### Worker policy (`worker-src 'self' blob:`)

Web Workers created via `new Worker(url)` are subject to CSP. When a CSP
declares `script-src` but **not** `worker-src`, browsers fall back to
using `script-src` as the source for workers — which means inline
(`blob:`) workers are rejected because `script-src` does not list `blob:`.

Tone.js internally creates a `Worker` from a `blob:` URL to drive its
audio clock (`Tone.Clock`). Without an explicit `worker-src` directive,
the sequencer fails to start and the user sees a console violation of
the form:

> Creating a worker from 'blob:...' violates the following Content
> Security Policy directive: "script-src 'self' ...". Note that
> 'worker-src' was not explicitly set, so 'script-src' is used as a
> fallback. The action has been blocked.

The fix is to declare `worker-src 'self' blob:` explicitly. This is
narrower than `'unsafe-inline'` and is the standard recommendation
(MDN, OWASP) for libraries that create inline workers.

#### Why this is safe

- `'self'` permits workers loaded from the local server only — the
  mixer and sequencer never host a worker script file, so this part is
  currently unused but kept as a defensive default.
- `blob:` permits **inline** workers created by code already running
  on the local origin. An attacker who wanted to instantiate a `blob:`
  worker would first need to be able to execute arbitrary JavaScript on
  the page, in which case the CSP has already been bypassed and the
  worker permission is moot.
- No external origin is allowed for workers. Even if a malicious
  library attempted to spawn a worker pointing at a remote URL, the
  browser would block it.
- `connect-src` remains restricted to `'self' blob: data:` plus the
  YouTube and Piped origins. A rogue worker cannot exfiltrate data to
  an arbitrary endpoint.

#### Alternatives considered and rejected

1. **Pre-serve Tone.js's worker as a static file** — Tone.js generates
   the worker source dynamically from its own internal state. The
   library does not expose a stable URL for the worker. Attempting to
   extract and pre-serve it would couple the project to a specific
   Tone.js version and break on every library upgrade.
2. **Patch Tone.js to skip the worker clock** — Tone.js's scheduling
   architecture depends on the worker for sample-accurate timing. A
   patch would degrade sequencer accuracy and is high-maintenance.
3. **Use `'unsafe-inline'` or `'unsafe-eval'` in `worker-src`** — would
   open workers to any inline script, which is strictly worse than the
   current `'self' blob:` allowlist.

---

## Other security headers

Beyond CSP, the `securityHeaders` middleware also sets:

- `X-Content-Type-Options: nosniff` — prevents MIME-sniffing attacks
  where the browser guesses a content type different from the declared
  one.
- `Referrer-Policy: no-referrer` — outgoing requests carry no
  `Referer` header. Prevents leaking internal paths (including video
  IDs) to third parties.
- `Permissions-Policy: camera=(), microphone=(), geolocation=()` —
  explicitly disables these APIs. Microphone is not used by the app
  (the audio engine reads files and streams only), so we deny it
  preemptively to limit attack surface if a future XSS is introduced.
- `Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges`
  — required for the `<audio>` element to perform HTTP Range requests
  on `/api/audio/:id` and `/api/scratch/:id`.

## Local-host enforcement

A `validateLocalHost` middleware runs **before** any other handler. It
rejects every request whose `Host` header is not one of `localhost`,
`127.0.0.1`, or `[::1]`, returning HTTP 421 (Misdirected Request).
This prevents DNS rebinding attacks where a malicious website tricks
the browser into sending requests to the local server under an
attacker-controlled hostname.

## Local token (`X-Local-Token`)

Every `/api/*` route other than `/api/session`, `/api/health`, and
`/api/ready` requires a header `X-Local-Token` matching a 64-character
hex secret generated at process start (`crypto.randomBytes(32)`). The
secret is held in process memory and rotated on every server restart.

The frontend obtains the token from `GET /api/session` and attaches it
to subsequent API calls. This is **defense in depth** — it does not
replace network isolation (the server is loopback-only), but it raises
the cost of attacking a misconfigured deployment.

## Scope discipline

The server is a **single-purpose relay and extractor**. It is not a
general-purpose web server. The frontend allowlist (`app.get(...)`) is
explicit and small. There is no `express.static(ROOT)` — every served
file is enumerated in the source.

Forbidden in this codebase:

- No hardcoded API keys, cookies, or third-party credentials.
- No `0.0.0.0` binding. The default is `127.0.0.1`. Setting `HOST` to
  anything else requires explicit operator action and is documented as
  unsafe.
- No persistent storage of user data outside `localStorage` on the
  client. The disk cache only holds extracted audio and metadata
  associated with YouTube video IDs.
- No telemetry, no remote logging, no analytics endpoints.

## Reporting

This is a personal/local project. If you discover a vulnerability,
open a private issue or contact the maintainer directly. Do not file a
public issue with exploit details.

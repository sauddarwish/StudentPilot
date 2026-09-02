# Cram 🎓

A deeply customizable AI study workspace. Zero build step, zero dependencies — just
static HTML, CSS and ES modules, so it drops straight onto GitHub Pages.

**Live:** https://cram.averon.club

Right now it runs in **demo mode**: the whole frontend works and assembles real
requests, but the network call returns a scripted stub. Point it at an endpoint and
flip Live mode to make it real.

---

## Customization

The design principle: **every visual decision in the app is a CSS custom property.**
The settings drawer does nothing but write to those tokens at runtime, so anything
the UI can produce is also reachable by hand from `:root` — or from the Custom CSS
box, which is injected live.

### Theme
Light / dark / follow-system · 7 palette presets (Default, Paper, Midnight, Forest,
Rose, Terminal, Mono) · accent colour + separate gradient end stop, or flat ·
background texture (none / dots / grid / accent glow / stripes) · **per-mode manual
overrides for all 10 palette slots** — background, three surface layers, three text
weights, two border weights and your own bubble colour, each independently
resettable to the preset.

### Layout
Density presets (compact / comfortable / spacious) · message style (cards, plain
text, solid accent, outline) · alignment (all-left or you-on-the-right) · avatars
(emoji / initials / hidden) · sliders for message gap, column width, bubble padding
X and Y, avatar size, sidebar width, corner rounding, border thickness, shadow
depth and animation speed · sidebar on the left or right · animation kill-switch.

### Type
Five font presets plus a custom stack field · separate code-font stack · size,
line height, letter spacing and bold weight.

### Branding
Rename the whole thing — app name, logo emoji (it becomes the favicon), tagline,
welcome heading and subheading, send-button label, composer placeholder.

### Behaviour
Enter-to-send · live word count · timestamps · hover actions · auto-scroll ·
streaming cursor · auto-titling · delete confirmation · default pilot · demo typing
speed.

### Pilots
Saved personas, each with its own emoji, accent colour, description, system prompt,
opening line, starter questions, and optional model / temperature / max-token
overrides. Reorder, duplicate, delete. Six ship by default: Socratic tutor, essay
coach, exam drill, code mentor, reading digest, general.

### Prompts
A tagged library — type `/` in the composer to search it. `{{placeholders}}` are
selected automatically after insertion, so you can type straight over the first one.
Reorder and duplicate.

### Connections
Multiple named endpoint profiles, each with its own provider preset, base URL, model
ID, optional key and **arbitrary custom headers**. Radio-select the active one and
hit **Test** to verify it before switching Live mode on.

### Everything else
Multi-chat with full-text search, retry, edit-and-resend, per-message delete, stop
mid-stream, Markdown export · JSON export/import of the entire config *or* the theme
alone · reset-the-look-only vs. reset-everything · `🎲 Surprise me` randomises the
whole appearance.

**Shortcuts** — `⌘K` new chat · `⌘/` settings · `⌘B` sidebar · `⌘⇧L` shuffle look ·
`Esc` close / stop · `Tab` accept first prompt suggestion.

---

## Connecting a real model

**Settings → Model → Connections.** Add a connection, then:

| Field | What to put |
| --- | --- |
| Preset | `Anthropic`, `OpenAI-compatible`, or `Custom endpoint` |
| Base URL | Your endpoint, e.g. `https://your-proxy.example.com/v1` |
| Model ID | e.g. `claude-sonnet-5` |
| API key | Leave **empty** if your proxy holds the key — that's the right setup |
| Headers | Any extras your proxy wants (auth, tenant id, …) |

Then set generation defaults below it (system prompt, temperature, top-p, max
tokens, history depth, stop sequences, streaming) and turn on **Live mode**.

`assets/js/api.js` is the only file that knows about providers. It already builds
both the Anthropic (`/messages`) and OpenAI-compatible (`/chat/completions`) request
shapes and parses SSE streams from either.

### Self-hosting behind a password

`server/` is a zero-dependency Node server that does the two things a static host
can't: **enforce access** and **hold a secret**.

```bash
git clone https://github.com/sauddarwish/StudentPilot.git /opt/cram
cd /opt/cram/server
cp .env.example .env
node set-password.js          # prints a password, stores only its scrypt hash
$EDITOR .env                  # add ANTHROPIC_API_KEY
sudo cp cram.service /etc/systemd/system/
sudo systemctl enable --now cram
```

Then put nginx in front of `127.0.0.1:$PORT` with `proxy_buffering off` (streaming
breaks without it) and run `certbot --nginx`.

**The gate is server-side.** A request without a valid session never receives
`index.html`, the JS or the CSS — it gets a 302 to `/login`, and `/api/*` gets a 401.
Sessions are HMAC-signed cookies (`HttpOnly; Secure; SameSite=Lax`), passwords are
stored as a scrypt hash, and login is rate-limited per IP (8 attempts / 15 min,
failing closed — a correct password is refused while locked). Static serving is
allowlisted to `index.html` and `assets/`, so `server/.env`, `.git` and everything
else return 404.

**The key stays on the server.** Point a connection's Base URL at
`https://your-host/api/v1` and leave the key field empty. The browser posts to
`/api/v1/messages` on your own origin; the server attaches `ANTHROPIC_API_KEY` from
`.env` and streams the response straight back, so SSE still works and the key is
never shipped to the client.

Rotate the password any time with `node set-password.js` followed by
`sudo systemctl restart cram`.

### About keys in the browser

The API-key field exists for local experiments, and it never leaves your browser —
but a static site can't keep a secret. Anything you paste there is readable by anyone
with access to that browser profile, and calling a provider directly from a page also
means CORS is up to that provider. **The intended setup is a small proxy of your own**
that holds the key server-side; set Base URL to the proxy and leave the key field empty.

---

## Running locally

The app uses ES modules, so it needs to be served over HTTP rather than opened as a
`file://` path:

```bash
cd Cram
python3 -m http.server 8000
# → http://localhost:8000
```

## Layout

```
index.html            app shell and the settings drawer markup
assets/css/app.css    all styling; every token lives at the top of :root
assets/js/store.js    defaults, theme/layout presets, localStorage persistence
assets/js/markdown.js small escape-first Markdown renderer
assets/js/api.js      provider adapters + demo stream — swap this to change backends
assets/js/app.js      rendering and event wiring
```

## License

MIT

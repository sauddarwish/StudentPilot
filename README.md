# StudentPilot 🎓

A deeply customizable AI study workspace. Zero build step, zero dependencies — just
static HTML, CSS and ES modules, so it drops straight onto GitHub Pages.

**Live:** https://sauddarwish.github.io/StudentPilot/

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
cd StudentPilot
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

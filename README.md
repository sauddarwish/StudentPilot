# StudentPilot 🎓

A customizable AI study workspace. Zero build step, zero dependencies — just static
HTML, CSS and ES modules, so it drops straight onto GitHub Pages.

**Live:** https://sauddarwish.github.io/StudentPilot/

Right now it runs in **demo mode**: the whole frontend works and assembles real
requests, but the network call returns a scripted stub. Point it at an endpoint and
flip Live mode to make it real.

---

## What's in it

**Pilots** — saved personas, each with its own system prompt, opening line, and
optional model/temperature override. Six ship by default (Socratic tutor, essay
coach, exam drill, code mentor, reading digest, general). Add, edit, or delete your
own in Settings → Pilots.

**Prompt library** — type `/` in the composer to search saved prompts. `{{placeholders}}`
get selected automatically after insertion so you can tab straight into them.

**Appearance** — theme (light/dark/system), accent colour, font family, text size,
message spacing, reading-column width, corner rounding, card vs. plain message style.
Every one of these is a CSS custom property written at runtime; the whole look is
driven from `:root`.

**Model controls** — provider preset, base URL, model ID, optional API key, system
prompt, temperature, top-p, max tokens, history depth, streaming toggle.

**Chats** — multiple conversations, full-text search, retry, edit-and-resend, stop
mid-stream, Markdown export.

**Data** — everything lives in `localStorage` under one key. Export/import the whole
config as JSON, or reset to defaults.

**Shortcuts** — `⌘K` new chat · `⌘/` settings · `⌘B` sidebar · `Esc` close / stop ·
`Tab` accept first prompt suggestion.

---

## Connecting a real model

Open **Settings → Model**:

| Field | What to put |
| --- | --- |
| Preset | `Anthropic`, `OpenAI-compatible`, or `Custom endpoint` |
| Base URL | Your endpoint, e.g. `https://your-proxy.example.com/v1` |
| Model ID | e.g. `claude-sonnet-5` |
| API key | Leave **empty** if your proxy holds the key — that's the right setup |
| Live mode | On |

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
index.html            app shell and settings drawer markup
assets/css/app.css    all styling; the theme tokens live at the top
assets/js/store.js    defaults, localStorage persistence, chat/pilot helpers
assets/js/markdown.js small escape-first Markdown renderer
assets/js/api.js      provider adapters + demo stream — swap this to change backends
assets/js/app.js      rendering and event wiring
```

## License

MIT

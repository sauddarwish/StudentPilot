# Cram 🎓

A deeply customizable AI study workspace. Zero build step, zero dependencies, just
static HTML, CSS and ES modules, so it drops straight onto GitHub Pages.

**Live:** https://cram.averon.club

Right now it runs in **demo mode**: the whole frontend works and assembles real
requests, but the network call returns a scripted stub. Point it at an endpoint and
flip Live mode to make it real.

---

## Customization

The design principle: **every visual decision in the app is a CSS custom property.**
The settings drawer does nothing but write to those tokens at runtime, so anything
the UI can produce is also reachable by hand from `:root`, or from the Custom CSS
box, which is injected live.

### Theme
Light / dark / follow-system · 9 palette presets (Book, Vellum, Slate, Ink, Midnight,
Forest, Rose, Terminal, Mono) · accent colour + separate gradient end stop, or flat ·
background texture (none / dots / grid / accent glow / stripes) · **per-mode manual
overrides for all 10 palette slots**, background, three surface layers, three text
weights, two border weights and your own bubble colour, each independently
resettable to the preset.

### Layout
Density presets (compact / comfortable / spacious) · message style (cards, plain
text, solid accent, outline) · alignment (all-left or you-on-the-right) · avatars
(emoji / initials / hidden) · sliders for message gap, column width, bubble padding
X and Y, avatar size, sidebar width, corner rounding, border thickness, shadow
depth and animation speed · sidebar on the left or right · animation kill-switch.

### Type
Size, line height, letter spacing and bold weight. The typeface itself is fixed.

### Fixed identity
The name, logo, tagline, welcome copy and typeface are constants in `store.js`, not
state. They are never persisted, never included in an export, and are stripped from
anything imported, so a hand-edited `localStorage` entry or a shared config file
cannot rebrand the app. The font tokens are written as `!important` inline styles so
the Custom CSS box cannot repoint them either.

### Behaviour
Enter-to-send · live word count · timestamps · hover actions · auto-scroll ·
streaming cursor · auto-titling · delete confirmation · demo typing speed.

### Prompts
A tagged library, type `/` in the composer to search it. `{{placeholders}}` are
selected automatically after insertion, so you can type straight over the first one.
Reorder and duplicate.

### Code
Fenced blocks get a header with the language and a copy button. The system prompt asks
for a language tag on every block so the label is meaningful.

### Everything else
Multi-chat with full-text search, retry, edit-and-resend, per-message delete, stop
mid-stream, Markdown export · JSON export/import of the entire config *or* the theme
alone · reset-the-look-only vs. reset-everything · `🎲 Surprise me` randomises the
whole appearance.

**Shortcuts**, `⌘K` new chat · `⌘/` settings · `⌘B` sidebar · `⌘⇧L` shuffle look ·
`Esc` close / stop · `Tab` accept first prompt suggestion.

---

## Models

Pick a provider and model under **Settings → Model**. The list was checked against
each provider's own docs on 2 September 2026.

| Provider | Models | Images | Reasoning |
| --- | --- | --- | --- |
| Claude | `claude-opus-5`, `claude-fable-5-1`, `claude-sonnet-5`, `claude-haiku-4-5`, plus 4.8 / 4.6 as legacy | yes | `output_config.effort`: low, medium, high, xhigh, max |
| ChatGPT | `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` | yes | `reasoning_effort`: none, low, medium, high, max |
| DeepSeek | `deepseek-v4-pro`, `deepseek-v4-flash` | no | thinking on by default, streamed as `reasoning_content` |

**Images.** The paperclip appears only for models that accept them, and the whole
attachment path is skipped for DeepSeek. Attach by button, paste, or drag onto the
composer; up to five per message. Each one is downscaled to a 1568px longest edge in
a canvas before encoding, because a raw phone photo would blow the request limit.
Claude receives base64 `image` blocks, OpenAI receives `image_url` data URLs.

**Thinking.** Where a model reasons before answering, the reasoning is streamed into
a collapsible block above the reply that closes itself once the answer starts and
reports how long it took. Turn it off under Settings → Model.

**Conversations** are multi-turn: the last N turns (Settings → Model → history) are
resent with every message, so the model can refer back. Even the offline demo replies
track the conversation so you can see this working without a key.

`assets/js/api.js` is the only file that knows about providers. It already builds
both the Anthropic (`/messages`) and OpenAI-compatible (`/chat/completions`) request
shapes and parses SSE streams from either.

### Self-hosting with accounts

`server/` is a zero-dependency Node server that adds the two things a static host
can't: **accounts** and **an optional server-held key**.

```bash
git clone https://github.com/sauddarwish/StudentPilot.git /opt/cram
cd /opt/cram/server
cp .env.example .env
node gen-secrets.js           # generates SESSION_SECRET and ENCRYPTION_KEY
sudo cp cram.service /etc/systemd/system/
sudo systemctl enable --now cram
```

Then put nginx in front of `127.0.0.1:$PORT` with `proxy_buffering off` (streaming
breaks without it) and run `certbot --nginx`.

**Accounts.** Users sign up at `/signup` with an email and password, no
verification code. Accounts live in `server/users.json` (mode 600) with passwords
stored as scrypt hashes; a missing email and a wrong password take the same time to
reject, so the endpoint doesn't leak which addresses are registered. Set
`ALLOW_SIGNUP=false` to close registration; existing accounts keep working. Seed or
add accounts from the CLI:

```bash
node add-user.js someone@example.com     # generates and prints a password
node add-user.js --list
```

**The gate is server-side.** A request without a valid session never receives
`index.html`, the JS or the CSS, it gets a 302 to `/login`, and `/api/*` gets a 401.
Sessions are HMAC-signed cookies (`HttpOnly; Secure; SameSite=Lax`) carrying the
user id, revalidated against the store on every request, so deleting an account
kills its sessions immediately. Login and signup share a per-IP rate limit
(10 attempts / 15 min). Static serving is allowlisted to `index.html` and `assets/`,
so `server/.env`, `users.json` and `.git` all return 404.

### How secrets are stored

**Passwords are hashed, not encrypted**, deliberately. Encryption implies a key that
can reverse it; there must be no way to turn a stored password back into the
original. They go through scrypt (N=65536, r=8, p=1, 16-byte random salt, 64-byte
output) with the cost parameters written into the hash, so they can be raised later
without invalidating existing accounts. A login with an older, cheaper hash silently
re-hashes at current cost.

**API keys are encrypted**, because unlike a password the server has to be able to
read one back to call the provider. Users can store a key against their account under
**Settings → Account**; it's sealed with AES-256-GCM under `ENCRYPTION_KEY` (random
12-byte IV per key, authenticated so tampering fails closed) and decrypted in memory
only for the duration of that user's own request. `GET /api/keys` returns nothing but
a masked hint like `sk-ant…9f2c`. Losing or changing `ENCRYPTION_KEY` makes stored
keys undecryptable: they would need to be re-entered.

The browser-held alternative only applies to the **standalone static build** (Pages,
`file://`, `python -m http.server`), where there is no server to relay through. There
a key typed into Settings → Model stays in `localStorage` and calls the provider
directly. Hosted, that path is switched off entirely.

**The server makes every provider call.** On a hosted deployment the browser never
holds a key and never contacts Anthropic or OpenAI. A user stores their key under
**Settings → Account**; it is encrypted at rest, and on each message the server
decrypts it in memory, calls the provider, and streams the response back. The
Connections editor collapses to a single choice, which stored key to relay through 
because there is nothing else left to configure. `/api/config` reports
`serverMode: true` and the frontend switches to this behaviour automatically.

Optionally the operator can also put a key in `.env` as a fallback for users who
haven't added their own; `FORCE_MODEL` and `MAX_TOKENS_CAP` apply as spend guards to
that key only.

Settings, pilots and chats are kept per account in `localStorage`, so two people
sharing a browser keep separate workspaces.

### Input handling

There is no SQL anywhere in Cram, the user store is a JSON file, so there is no
query language to inject into. What the server does enforce:

- **Static paths** are collapsed with `path.posix.normalize` *before* the
  `index.html` / `assets/` allowlist is applied, so `..` and its percent-encoded
  forms resolve to a path the allowlist doesn't match. A resolve-and-contain check
  under the site root runs as a second layer.
- **JSON endpoints** require an actual JSON object, arrays, strings, numbers and
  `null` are refused, and read each field as a length-capped string, so an
  object-valued field can't be smuggled through where a string is expected.
- **Config import** drops `__proto__`, `constructor` and `prototype` keys and bounds
  merge depth, so an imported file can't reshape the state object's prototype.
- **Provider names** are matched against an allowlist before they are ever used as
  an object index.
- **Model output** is HTML-escaped before any Markdown rendering, and links are
  restricted to `http(s)`, so nothing a model returns becomes markup.
- **Logged values** have control characters stripped and are length-capped, so a
  crafted email can't forge log entries.
- **Bodies** are size-capped (256 KB for chat, 16 KB for forms) and answered with 413.
- **Responses** carry a CSP whose `connect-src 'self'` means the page cannot reach a
  provider directly even if its code tried, plus `frame-ancestors 'none'`,
  `nosniff`, `X-Frame-Options: DENY` and a restrictive `Permissions-Policy`.

### About keys in the browser

The API-key field exists for local experiments, and it never leaves your browser 
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
assets/js/api.js      provider adapters + demo stream, swap this to change backends
assets/js/app.js      rendering and event wiring
server/server.js      accounts, session gating, optional model proxy
server/users.js       JSON-file user store (scrypt hashes, atomic writes)
server/secretbox.js   AES-256-GCM helper for secrets held at rest
server/add-user.js    CLI to create or list accounts
server/gen-secrets.js CLI to generate SESSION_SECRET and ENCRYPTION_KEY
```

## License

MIT

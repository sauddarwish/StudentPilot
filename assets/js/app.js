/* ==========================================================================
   app.js, wiring. Renders from `state`, writes back to `state`, saves.
   ========================================================================== */

import {
  state, save, replaceState, resetState, uid, move,
  ACCENTS, THEME_PRESETS, LAYOUT_PRESETS, FONT_STACKS, DEFAULTS, storageKey, useAccount,
  PROVIDERS, modelInfo, supportsImages, supportsThinking, BRAND, UI_FONT, CODE_FONT,
  activeChat, activeConnection, newChat, deleteChat, titleFrom,
} from "./store.js";
import { render as md } from "./markdown.js";
import { streamReply, testConnection } from "./api.js";

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const dom = {
  app: $("#app"),
  root: document.documentElement,
  chatList: $("#chatList"),
  chatSearch: $("#chatSearch"),
  messages: $("#messages"),
  welcome: $("#welcome"),
  transcript: $("#transcript"),
  input: $("#input"),
  composer: $("#composer"),
  chips: $("#composerChips"),
  sendBtn: $("#sendBtn"),
  stopBtn: $("#stopBtn"),
  chatTitle: $("#chatTitle"),
  chatMeta: $("#chatMeta"),
  modelHint: $("#modelHint"),
  countHint: $("#countHint"),
  connBadge: $("#connBadge"),
  drawer: $("#drawer"),
  scrim: $("#scrim"),
  toast: $("#toast"),
  userCss: $("#userCss"),
  attachments: $("#attachments"),
  imageInput: $("#imageInput"),
};

/* images staged on the composer, cleared when the message is sent */
let pendingImages = [];

let abortController = null;
let streaming = false;

/* Set when the page is served by the Cram server and a session is active.
   Served statically (Pages, file://, python -m http.server) there are no
   accounts, this stays null, and the app works exactly as before. */
let account = null;        // { id, email }
let sharedEndpoint = null; // { available, provider, model, maxTokens, url }
let serverMode = false;    // served by the Cram server: it relays every request
let encryptionOn = false;  // server can encrypt stored keys
let savedKeys = {};        // { anthropic: { hint, savedAt }, … }, masked only

async function loadServerConfig() {
  try {
    const res = await fetch("/api/config", { credentials: "same-origin" });
    if (!res.ok) return;
    const cfg = await res.json();
    account = cfg?.user ?? null;
    sharedEndpoint = cfg?.sharedEndpoint ?? null;
    serverMode = Boolean(cfg?.serverMode);
    encryptionOn = Boolean(cfg?.encryption);
    savedKeys = cfg?.savedKeys ?? {};
  } catch {
    /* not served by the Cram server, no accounts, no shared endpoint */
  }
}

/* ==========================================================================
   Appearance
   ========================================================================== */

const media = window.matchMedia("(prefers-color-scheme: dark)");

export const PALETTE_KEYS = [
  ["bg", "Page background"],
  ["surface", "Surface"],
  ["surface-2", "Surface 2"],
  ["surface-3", "Surface 3"],
  ["text", "Text"],
  ["text-dim", "Text dim"],
  ["text-faint", "Text faint"],
  ["border", "Border"],
  ["border-strong", "Border strong"],
  ["user-bubble", "Your bubble"],
];

const isDark = () =>
  state.ui.theme === "dark" || (state.ui.theme === "system" && media.matches);

const currentMode = () => (isDark() ? "dark" : "light");

function applyAppearance() {
  const u = state.ui;
  const s = dom.root.style;
  const dark = isDark();
  const mode = dark ? "dark" : "light";

  dom.root.dataset.theme = mode;
  $("#themeBtn").textContent = dark ? "☀️" : "🌙";

  /* palette: stylesheet default -> preset -> user override */
  for (const [key] of PALETTE_KEYS) s.removeProperty(`--${key}`);
  const preset = THEME_PRESETS[u.preset] ?? THEME_PRESETS.default;
  for (const [k, v] of Object.entries(preset[mode] ?? {})) s.setProperty(`--${k}`, v);
  for (const [k, v] of Object.entries(u.palettes?.[mode] ?? {})) if (v) s.setProperty(`--${k}`, v);

  /* identity */
  s.setProperty("--accent", u.accent);
  s.setProperty("--accent-2", u.gradient ? u.accent2 : u.accent);
  s.setProperty("--accent-fg", contrastOn(u.accent));

  /* typography */
  /* Set as !important so the Custom CSS box cannot repoint the typeface: an
     inline important declaration outranks anything a stylesheet can say. */
  s.setProperty("--font-ui", UI_FONT, "important");
  s.setProperty("--font-mono", CODE_FONT, "important");
  s.setProperty("--font-size", `${u.fontSize}px`);
  s.setProperty("--line-height", String(u.lineHeight));
  s.setProperty("--letter-spacing", `${u.letterSpacing}em`);
  s.setProperty("--weight-bold", String(u.boldWeight));

  /* geometry */
  s.setProperty("--density", `${u.density}px`);
  s.setProperty("--pad-y", `${u.padY}px`);
  s.setProperty("--pad-x", `${u.padX}px`);
  s.setProperty("--max-read", `${u.width}rem`);
  s.setProperty("--radius", `${u.radius}px`);
  s.setProperty("--bubble-radius", `${Math.max(u.radius, 2)}px`);
  s.setProperty("--border-w", `${u.borderW}px`);
  s.setProperty("--shadow-strength", String(u.shadow));
  s.setProperty("--avatar-size", `${u.avatarSize}px`);
  s.setProperty("--sidebar-w", `${u.sidebarWidth}px`);
  s.setProperty("--speed", `${u.speed}s`);

  /* variant switches */
  dom.root.dataset.bubbles = u.bubbles;
  dom.root.dataset.align = u.align;
  dom.root.dataset.avatars = u.avatars;
  dom.root.dataset.pattern = u.pattern;
  dom.root.dataset.side = u.sidebarSide;
  dom.root.dataset.anim = u.animations ? "on" : "off";
  dom.root.dataset.actions = state.behavior.showActions ? "on" : "off";
  dom.app.dataset.sidebar = u.sidebar;

  dom.userCss.textContent = u.customCss || "";
}

/* pick black or white text for a given accent so buttons stay readable */
function contrastOn(hex) {
  const h = String(hex).replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  if ([r, g, b].some(Number.isNaN)) return "#ffffff";
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.45 ? "#101218" : "#ffffff";
}

function applyBrand() {
  const b = BRAND;
  $("#brandLogo").textContent = b.logo || "🎓";
  $("#brandName").textContent = b.name || "Cram";
  $("#welcomeTitle").textContent = b.welcomeTitle;
  $("#welcomeSubtitle").textContent = b.welcomeSubtitle;
  dom.sendBtn.textContent = b.sendLabel || "Send";
  dom.input.placeholder = b.placeholder || "";
  document.title = b.name || "Cram";
  $("#favicon").href =
    "data:image/svg+xml," +
    encodeURIComponent(
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>${b.logo || "🎓"}</text></svg>`);
}

media.addEventListener("change", () => {
  if (state.ui.theme === "system") { applyAppearance(); renderPaletteEditor(); }
});

/* ==========================================================================
   Sidebar
   ========================================================================== */

function renderChatList() {
  const q = dom.chatSearch.value.trim().toLowerCase();
  const chats = q
    ? state.chats.filter((c) =>
        c.title.toLowerCase().includes(q) ||
        c.messages.some((m) => m.content.toLowerCase().includes(q)))
    : state.chats;

  dom.chatList.replaceChildren();
  if (!chats.length) {
    dom.chatList.append(el("div", "empty-note", q ? "No matches." : "No chats yet."));
    return;
  }

  for (const c of chats) {
    const row = el("button", "chat-item");
    row.type = "button";
    row.setAttribute("aria-current", String(c.id === state.activeChatId));
    row.append(el("span", "chat-item__title", c.title));

    const x = el("button", "chat-item__x", "✕");
    x.type = "button";
    x.title = "Delete chat";
    x.onclick = (e) => {
      e.stopPropagation();
      if (state.behavior.confirmDelete && !confirm(`Delete "${c.title}"?`)) return;
      deleteChat(c.id);
      renderAll();
    };
    row.append(x);
    row.onclick = () => { state.activeChatId = c.id; save(); renderAll(); };
    dom.chatList.append(row);
  }
}

/* ==========================================================================
   Transcript
   ========================================================================== */

const timeOf = (ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function assistantName() {
  const info = modelInfo(state.model.serverProvider, state.model.model);
  return info?.name || PROVIDERS[state.model.serverProvider]?.label || "Assistant";
}

function avatarFor(role) {
  if (state.ui.avatars === "initials") {
    return role === "user" ? "You" : assistantName().slice(0, 2).toUpperCase();
  }
  return role === "user" ? "🧑" : "◆";
}

const formatSeconds = (ms) => {
  const s = ms / 1000;
  return s < 1 ? `${Math.round(ms)}ms` : s < 60 ? `${s.toFixed(1)}s` : `${Math.round(s / 60)}m ${Math.round(s % 60)}s`;
};

/* Collapsible "thought for N" block, closed once the answer starts. */
function thinkingNode(msg) {
  const wrap = el("details", "thinking");
  wrap.open = Boolean(msg.pending && !msg.content);
  const summary = el("summary", "thinking__summary");
  summary.textContent = msg.pending && !msg.content
    ? "Thinking..."
    : `Thought for ${formatSeconds(msg.thinkingMs || 0)}`;
  const body = el("div", "thinking__body");
  body.textContent = msg.thinking;
  wrap.append(summary, body);
  return wrap;
}

function messageNode(msg, chat) {
  const wrap = el("div", `msg msg--${msg.role}`);
  wrap.dataset.id = msg.id;
  wrap.append(el("div", "msg__avatar", avatarFor(msg.role)));

  const body = el("div", "msg__body");
  const who = el("div", "msg__who");
  who.append(el("span", null, msg.role === "user" ? "You" : (msg.modelName || assistantName())));
  if (state.behavior.timestamps && msg.at) who.append(el("span", null, timeOf(msg.at)));
  if (msg.error) who.append(el("span", null, "· failed"));
  body.append(who);

  if (msg.images?.length) {
    const strip = el("div", "msg__images");
    for (const img of msg.images) {
      const thumb = el("img", "msg__image");
      thumb.src = `data:${img.mediaType};base64,${img.data}`;
      thumb.alt = img.name || "attached image";
      thumb.loading = "lazy";
      strip.append(thumb);
    }
    body.append(strip);
  }

  if (msg.thinking && state.model.showThinking) body.append(thinkingNode(msg));

  const content = el("div", "msg__content");
  if (msg.pending && !msg.content && !msg.thinking) {
    const dots = el("span", "dots");
    dots.append(el("i"), el("i"), el("i"));
    content.append(dots);
  } else {
    content.innerHTML = md(msg.content);
    if (msg.error) content.style.color = "var(--danger)";
  }
  body.append(content);

  if (!msg.pending) {
    const tools = el("div", "msg__tools");

    const copy = el("button", "tool-btn", "Copy");
    copy.type = "button";
    copy.onclick = () => navigator.clipboard.writeText(msg.content).then(() => toast("Copied"));
    tools.append(copy);

    if (msg.role === "user") {
      const edit = el("button", "tool-btn", "Edit & resend");
      edit.type = "button";
      edit.onclick = () => {
        const i = chat.messages.findIndex((m) => m.id === msg.id);
        dom.input.value = msg.content;
        chat.messages.splice(i);
        save(); renderAll(); autosize(); dom.input.focus();
      };
      tools.append(edit);
    } else {
      const retry = el("button", "tool-btn", "Retry");
      retry.type = "button";
      retry.onclick = () => {
        const i = chat.messages.findIndex((m) => m.id === msg.id);
        if (!chat.messages.slice(0, i).some((m) => m.role === "user")) return;
        chat.messages.splice(i);
        save(); renderAll();
        runCompletion(chat);
      };
      tools.append(retry);
    }

    const del = el("button", "tool-btn", "Delete");
    del.type = "button";
    del.onclick = () => {
      const i = chat.messages.findIndex((m) => m.id === msg.id);
      chat.messages.splice(i, 1);
      save(); renderAll();
    };
    tools.append(del);

    body.append(tools);
  }

  wrap.append(body);
  return wrap;
}

/* Give every fenced block a header with its language and a copy button. */
function decorateCodeBlocks(root) {
  for (const pre of root.querySelectorAll("pre")) {
    if (pre.parentElement?.classList.contains("code")) continue;
    const code = pre.querySelector("code");
    if (!code) continue;

    const box = el("div", "code");
    const head = el("div", "code__head");
    head.append(el("span", "code__lang", code.dataset.lang || "text"));

    const copy = el("button", "code__copy", "Copy");
    copy.type = "button";
    copy.onclick = () => {
      navigator.clipboard.writeText(code.textContent).then(() => {
        copy.textContent = "Copied";
        setTimeout(() => { copy.textContent = "Copy"; }, 1400);
      });
    };
    head.append(copy);

    pre.replaceWith(box);
    box.append(head, pre);
  }
}

function renderTranscript() {
  const chat = activeChat();
  dom.messages.replaceChildren();

  if (!chat || !chat.messages.length) {
    dom.welcome.hidden = false;
    dom.chatTitle.textContent = chat ? chat.title : "New chat";
    dom.chatMeta.textContent = "";
    return;
  }

  dom.welcome.hidden = true;
  dom.chatTitle.textContent = chat.title;
  const n = chat.messages.length;
  dom.chatMeta.textContent = `${n} message${n === 1 ? "" : "s"}`;

  for (const m of chat.messages) dom.messages.append(messageNode(m, chat));
  decorateCodeBlocks(dom.messages);
}

function scrollToEnd(force = false) {
  if (!state.behavior.autoScroll && !force) return;
  const t = dom.transcript;
  const nearBottom = t.scrollHeight - t.scrollTop - t.clientHeight < 200;
  if (force || nearBottom) t.scrollTop = t.scrollHeight;
}

/* ==========================================================================
   Sending
   ========================================================================== */

function effectiveConfig() {
  const provider = state.model.serverProvider || "anthropic";
  const vision = supportsImages(provider, state.model.model);
  const effort = supportsThinking(provider, state.model.model) ? state.model.effort : "";

  if (serverMode) {
    /* The request goes to this origin. No key is attached here, the server
       looks up the caller's stored key, decrypts it, and calls the provider. */
    return {
      ...state.model,
      provider,
      baseUrl: new URL(provider === "deepseek" ? "/api/v1/deepseek" : "/api/v1", location.origin).href,
      apiKey: "",
      headers: [],
      model: state.model.model,
      vision,
      effort,
      demoSpeed: state.behavior.demoSpeed,
    };
  }

  const conn = activeConnection();
  return {
    ...state.model,
    provider: conn.provider,
    baseUrl: conn.baseUrl,
    apiKey: conn.apiKey,
    headers: conn.headers,
    model: conn.model || state.model.model,
    vision,
    effort,
    demoSpeed: state.behavior.demoSpeed,
  };
}

async function runCompletion(chat) {
  const cfg = effectiveConfig();
  const system = state.model.system;

  const history = chat.messages
    .filter((m) => !m.error && (m.content.trim() || m.images?.length))
    .slice(-Math.max(2, state.model.historyTurns * 2))
    .map((m) => ({ role: m.role, content: m.content, images: m.images ?? [] }));

  const reply = {
    id: uid(), role: "assistant", content: "", thinking: "", thinkingMs: 0,
    modelName: assistantName(), at: Date.now(), pending: true,
  };
  chat.messages.push(reply);
  renderTranscript();
  scrollToEnd(true);

  abortController = new AbortController();
  setStreaming(true);

  const startedAt = performance.now();
  let firstTextAt = 0;
  const node = () => dom.messages.querySelector(`[data-id="${reply.id}"]`);
  const caret = state.behavior.streamCursor ? '<span class="cursor"></span>' : "";
  let needsFullRender = false;

  const paint = () => {
    const host = node();
    if (!host) return;
    const thinkingBox = host.querySelector(".thinking__body");
    if (reply.thinking && !thinkingBox) { needsFullRender = true; }
    else if (thinkingBox) thinkingBox.textContent = reply.thinking;

    const content = host.querySelector(".msg__content");
    if (content) content.innerHTML = md(reply.content) + (reply.content ? caret : "");
    if (needsFullRender) { needsFullRender = false; renderTranscript(); }
    else if (content) decorateCodeBlocks(content);
    scrollToEnd();
  };

  try {
    for await (const part of streamReply({ system, messages: history, cfg, signal: abortController.signal })) {
      if (part.type === "thinking") {
        reply.thinking += part.text;
        reply.thinkingMs = performance.now() - startedAt;
      } else {
        if (!firstTextAt) {
          firstTextAt = performance.now();
          reply.thinkingMs = firstTextAt - startedAt;
        }
        reply.content += part.text;
      }
      paint();
    }
    if (!reply.content.trim() && !reply.thinking.trim()) reply.content = "_(empty response)_";
  } catch (err) {
    if (err.name === "AbortError") {
      reply.content += reply.content ? "\n\n_(stopped)_" : "_(stopped)_";
    } else {
      reply.error = true;
      reply.content = `**Request failed.** ${err.message}\n\nCheck Settings, or clear your API key to fall back to the demo replies.`;
    }
  } finally {
    reply.pending = false;
    reply.elapsedMs = performance.now() - startedAt;
    chat.updatedAt = Date.now();
    setStreaming(false);
    abortController = null;
    save();
    renderTranscript();
    renderChatList();
    scrollToEnd();
  }
}

function setStreaming(on) {
  streaming = on;
  dom.sendBtn.disabled = on;
  dom.stopBtn.hidden = !on;
}

function send(text) {
  const body = text.trim();
  if ((!body && !pendingImages.length) || streaming) return;

  let chat = activeChat();
  if (!chat) chat = newChat();

  chat.messages.push({
    id: uid(), role: "user", content: body,
    images: pendingImages.length ? pendingImages : undefined,
    at: Date.now(),
  });
  pendingImages = [];
  renderAttachments();
  if (state.behavior.autoTitle && chat.title === "New chat") {
    chat.title = titleFrom(body || "Image");
  }
  chat.updatedAt = Date.now();

  const i = state.chats.indexOf(chat);
  if (i > 0) move(state.chats, i, 0);

  save();
  dom.input.value = "";
  dom.chips.replaceChildren();
  autosize();
  updateCount();
  renderChatList();
  renderTranscript();
  scrollToEnd(true);
  runCompletion(chat);
}

/* ==========================================================================
   Image attachments
   ========================================================================== */

const MAX_IMAGES = 5;
const MAX_EDGE = 1568;          // Anthropic's recommended longest edge

/* Downscale in a canvas before encoding: a phone photo is several megabytes
   and would be rejected by the body limit long before it reached a model. */
function fileToImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("Not an image"));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not decode that image"));
      img.onload = () => {
        const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);

        const keepPng = file.type === "image/png" && w * h < 640_000;
        const mediaType = keepPng ? "image/png" : "image/jpeg";
        const url = canvas.toDataURL(mediaType, 0.85);
        resolve({
          mediaType,
          data: url.slice(url.indexOf(",") + 1),
          name: file.name || "image",
          width: w, height: h,
        });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function addImages(files) {
  const provider = state.model.serverProvider || "anthropic";
  if (!supportsImages(provider, state.model.model)) {
    toast(`${modelInfo(provider, state.model.model)?.name || "This model"} cannot read images`);
    return;
  }
  for (const file of files) {
    if (pendingImages.length >= MAX_IMAGES) { toast(`Up to ${MAX_IMAGES} images per message`); break; }
    try {
      pendingImages.push(await fileToImage(file));
    } catch (err) {
      toast(err.message);
    }
  }
  renderAttachments();
}

function renderAttachments() {
  dom.attachments.replaceChildren();
  dom.attachments.hidden = pendingImages.length === 0;

  pendingImages.forEach((img, i) => {
    const cell = el("div", "attachment");
    const thumb = el("img", "attachment__img");
    thumb.src = `data:${img.mediaType};base64,${img.data}`;
    thumb.alt = img.name;
    const remove = el("button", "attachment__x", "✕");
    remove.type = "button";
    remove.title = `Remove ${img.name}`;
    remove.onclick = () => { pendingImages.splice(i, 1); renderAttachments(); };
    cell.append(thumb, remove);
    dom.attachments.append(cell);
  });
}

/* ==========================================================================
   Composer
   ========================================================================== */

function autosize() {
  dom.input.style.height = "auto";
  dom.input.style.height = `${Math.min(dom.input.scrollHeight, 260)}px`;
}

function updateCount() {
  if (!state.behavior.wordCount) { dom.countHint.textContent = ""; return; }
  const v = dom.input.value.trim();
  const words = v ? v.split(/\s+/).length : 0;
  dom.countHint.textContent = `${words}w · ${dom.input.value.length}c`;
}

function insertPrompt(promptObj) {
  dom.input.value = promptObj.body;
  dom.chips.replaceChildren();
  autosize();
  updateCount();
  dom.input.focus();
  const m = promptObj.body.match(/\{\{[^}]+\}\}/);
  if (m) dom.input.setSelectionRange(m.index, m.index + m[0].length);
  else dom.input.setSelectionRange(promptObj.body.length, promptObj.body.length);
}

function refreshChips() {
  const v = dom.input.value;
  if (!v.startsWith("/")) {
    if (dom.chips.querySelector("[data-prompt]")) dom.chips.replaceChildren();
    return;
  }
  const q = v.slice(1).toLowerCase();
  const hits = state.prompts.filter(
    (p) => p.name.toLowerCase().includes(q) || (p.tag ?? "").toLowerCase().includes(q)).slice(0, 8);

  dom.chips.replaceChildren();
  for (const p of hits) {
    const chip = el("button", "chip", p.tag ? `${p.name} · ${p.tag}` : p.name);
    chip.type = "button";
    chip.dataset.prompt = p.id;
    chip.onclick = () => insertPrompt(p);
    dom.chips.append(chip);
  }
  if (!hits.length) {
    const note = el("span", "hint", "No saved prompt matches. Settings → Prompts to add one.");
    note.dataset.prompt = "none";
    dom.chips.append(note);
  }
}

/* ==========================================================================
   Drawer plumbing
   ========================================================================== */

function openDrawer(tab) {
  dom.drawer.dataset.open = "true";
  dom.scrim.dataset.open = "true";
  if (tab) selectTab(tab);
  renderTokenDump();
}
function closeDrawer() {
  dom.drawer.dataset.open = "false";
  dom.scrim.dataset.open = "false";
}
function selectTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === name)));
  document.querySelectorAll(".panel").forEach((p) => { p.dataset.active = String(p.dataset.panel === name); });
}

/* input -> state -> side effect */
function bind(sel, get, set, { event = "input", prop = "value", cast = (v) => v } = {}) {
  const node = $(sel);
  node[prop] = get();
  node.addEventListener(event, () => { set(cast(node[prop])); save(); });
  return node;
}
const fmt = (sel, fn) => { $(sel).textContent = fn(); };

/* ==========================================================================
   Theme panel
   ========================================================================== */

function renderPresetGrid() {
  const host = $("#presetGrid");
  host.replaceChildren();
  for (const [key, p] of Object.entries(THEME_PRESETS)) {
    const b = el("button", "preset");
    b.type = "button";
    b.setAttribute("aria-pressed", String(state.ui.preset === key));

    const strip = el("div", "preset__strip");
    const mode = currentMode();
    const pal = p[mode] ?? {};
    for (const c of [pal.bg ?? "var(--bg)", pal.surface ?? "var(--surface)", p.accent, p.accent2]) {
      const i = el("i");
      i.style.background = c;
      strip.append(i);
    }
    b.append(strip, el("div", "preset__name", p.name));
    b.onclick = () => {
      state.ui.preset = key;
      state.ui.accent = p.accent;
      state.ui.accent2 = p.accent2;
      $("#setAccent").value = p.accent;
      $("#setAccent2").value = p.accent2;
      save();
      applyAppearance();
      renderPresetGrid();
      renderPaletteEditor();
      paintSwatches();
      toast(`${p.name} theme`);
    };
    host.append(b);
  }
}

let paintSwatches = () => {};

function renderPaletteEditor() {
  const host = $("#paletteEditor");
  const mode = currentMode();
  $("#paletteModeLabel").textContent = mode;
  host.replaceChildren();

  const preset = THEME_PRESETS[state.ui.preset] ?? THEME_PRESETS.default;
  const computed = getComputedStyle(dom.root);

  for (const [key, label] of PALETTE_KEYS) {
    const row = el("div", "kv");

    const name = el("label", "field__label", label);
    name.style.alignSelf = "center";

    const current =
      state.ui.palettes[mode][key] ||
      preset[mode]?.[key] ||
      computed.getPropertyValue(`--${key}`).trim() ||
      "#000000";

    const picker = el("input", "color");
    picker.type = "color";
    picker.value = /^#[0-9a-f]{6}$/i.test(current) ? current : "#000000";
    picker.oninput = () => {
      state.ui.palettes[mode][key] = picker.value;
      save();
      applyAppearance();
    };

    const clear = el("button", "btn btn--sm btn--ghost", "↺");
    clear.type = "button";
    clear.title = "Use the preset value";
    clear.onclick = () => {
      delete state.ui.palettes[mode][key];
      save();
      applyAppearance();
      renderPaletteEditor();
    };

    row.append(name, picker, clear);
    host.append(row);
  }
}

function wireTheme() {
  const u = state.ui;

  bind("#setTheme", () => u.theme, (v) => {
    u.theme = v; applyAppearance(); renderPresetGrid(); renderPaletteEditor();
  }, { event: "change" });

  const swatches = $("#accentSwatches");
  paintSwatches = () =>
    swatches.querySelectorAll(".swatch").forEach((s) =>
      s.setAttribute("aria-pressed", String(s.dataset.color === u.accent)));

  for (const color of ACCENTS) {
    const b = el("button", "swatch");
    b.type = "button";
    b.dataset.color = color;
    b.style.background = color;
    b.title = color;
    b.onclick = () => {
      u.accent = color;
      if (!u.gradient) u.accent2 = color;
      $("#setAccent").value = color;
      $("#setAccent2").value = u.accent2;
      save(); applyAppearance(); paintSwatches();
    };
    swatches.append(b);
  }
  paintSwatches();

  bind("#setAccent", () => u.accent, (v) => { u.accent = v; applyAppearance(); paintSwatches(); });
  bind("#setAccent2", () => u.accent2, (v) => { u.accent2 = v; applyAppearance(); });
  bind("#setGradient", () => u.gradient, (v) => { u.gradient = v; applyAppearance(); }, { event: "change", prop: "checked" });
  bind("#setPattern", () => u.pattern, (v) => { u.pattern = v; applyAppearance(); }, { event: "change" });

  $("#clearPaletteBtn").onclick = () => {
    state.ui.palettes[currentMode()] = {};
    save(); applyAppearance(); renderPaletteEditor();
    toast("Overrides cleared");
  };

  renderPresetGrid();
  renderPaletteEditor();
}

/* ==========================================================================
   Layout panel
   ========================================================================== */

const LAYOUT_RANGES = [
  ["#setDensity", "density", "#densityVal", (v) => `${v}px`],
  ["#setWidth", "width", "#widthVal", (v) => `${v}rem`],
  ["#setPadY", "padY", "#padYVal", (v) => `${v}px`],
  ["#setPadX", "padX", "#padXVal", (v) => `${v}px`],
  ["#setAvatarSize", "avatarSize", "#avatarSizeVal", (v) => `${v}px`],
  ["#setSidebarWidth", "sidebarWidth", "#sidebarWidthVal", (v) => `${v}px`],
  ["#setRadius", "radius", "#radiusVal", (v) => `${v}px`],
  ["#setBorderW", "borderW", "#borderWVal", (v) => `${v}px`],
  ["#setShadow", "shadow", "#shadowVal", (v) => Number(v).toFixed(1)],
  ["#setSpeed", "speed", "#speedVal", (v) => `${Number(v).toFixed(2)}s`],
];

function syncLayoutInputs() {
  for (const [sel, key, valSel, format] of LAYOUT_RANGES) {
    $(sel).value = state.ui[key];
    fmt(valSel, () => format(state.ui[key]));
  }
}

function wireLayout() {
  const u = state.ui;

  for (const [sel, key, valSel, format] of LAYOUT_RANGES) {
    bind(sel, () => u[key], (v) => {
      u[key] = v;
      applyAppearance();
      fmt(valSel, () => format(u[key]));
    }, { cast: Number });
    fmt(valSel, () => format(u[key]));
  }

  bind("#setBubbles", () => u.bubbles, (v) => { u.bubbles = v; applyAppearance(); }, { event: "change" });
  bind("#setAlign", () => u.align, (v) => { u.align = v; applyAppearance(); }, { event: "change" });
  bind("#setAvatars", () => u.avatars, (v) => { u.avatars = v; applyAppearance(); renderTranscript(); }, { event: "change" });
  bind("#setSidebarSide", () => u.sidebarSide, (v) => { u.sidebarSide = v; applyAppearance(); }, { event: "change" });
  bind("#setAnimations", () => u.animations, (v) => { u.animations = v; applyAppearance(); }, { event: "change", prop: "checked" });

  document.querySelectorAll("[data-layout]").forEach((btn) => {
    btn.onclick = () => {
      Object.assign(u, LAYOUT_PRESETS[btn.dataset.layout]);
      save();
      applyAppearance();
      syncLayoutInputs();
      syncTypeInputs();
      toast(`${btn.textContent} layout`);
    };
  });
}

/* ==========================================================================
   Type panel
   ========================================================================== */

const TYPE_RANGES = [
  ["#setFontSize", "fontSize", "#fontSizeVal", (v) => `${v}px`],
  ["#setLineHeight", "lineHeight", "#lineHeightVal", (v) => Number(v).toFixed(2)],
  ["#setLetterSpacing", "letterSpacing", "#letterSpacingVal", (v) => `${Number(v).toFixed(3)}em`],
  ["#setBoldWeight", "boldWeight", "#boldWeightVal", (v) => String(v)],
];

function syncTypeInputs() {
  for (const [sel, key, valSel, format] of TYPE_RANGES) {
    $(sel).value = state.ui[key];
    fmt(valSel, () => format(state.ui[key]));
  }
}

function wireType() {
  const u = state.ui;

  for (const [sel, key, valSel, format] of TYPE_RANGES) {
    bind(sel, () => u[key], (v) => {
      u[key] = v; applyAppearance(); fmt(valSel, () => format(u[key]));
    }, { cast: Number });
    fmt(valSel, () => format(u[key]));
  }
}

/* ==========================================================================
   Behaviour panel
   ========================================================================== */

function wireBehavior() {
  const bh = state.behavior;
  const toggles = [
    ["#setEnterSends", "enterSends", () => {}],
    ["#setWordCount", "wordCount", updateCount],
    ["#setTimestamps", "timestamps", renderTranscript],
    ["#setShowActions", "showActions", applyAppearance],
    ["#setAutoScroll", "autoScroll", () => {}],
    ["#setStreamCursor", "streamCursor", () => {}],
    ["#setAutoTitle", "autoTitle", () => {}],
    ["#setConfirmDelete", "confirmDelete", () => {}],
  ];
  for (const [sel, key, after] of toggles) {
    bind(sel, () => bh[key], (v) => { bh[key] = v; after(); }, { event: "change", prop: "checked" });
  }

  bind("#setDemoSpeed", () => bh.demoSpeed, (v) => {
    bh.demoSpeed = v; fmt("#demoSpeedVal", () => `${bh.demoSpeed}ms`);
  }, { cast: Number });
  fmt("#demoSpeedVal", () => `${bh.demoSpeed}ms`);

}

/* ==========================================================================
   Model panel
   ========================================================================== */

function renderConnections() {
  const host = $("#connectionEditor");
  host.replaceChildren();

  if (serverMode) {
    const stored = Object.keys(savedKeys);
    const note = el("div", stored.length ? "callout" : "callout callout--warn");
    note.append(
      el("strong", null, stored.length ? "Relayed by this server. " : "No API key stored yet. "),
      el("span", null, stored.length
        ? "Your key is decrypted on the server for the duration of each request. " +
          "It is never sent to this browser, and this browser never contacts the provider."
        : "Add one under Settings → Account. Until then Cram replies with a demo stub."),
    );
    host.append(note);

    const card = el("div", "card");

    const label = el("label", "field__label", "Send through");
    card.append(label);

    const select = el("select", "select");
    for (const [value, text] of [["anthropic", "Anthropic"], ["openai", "OpenAI"]]) {
      const o = el("option", null, savedKeys[value] ? `${text}, key stored` : `${text}, no key`);
      o.value = value;
      select.append(o);
    }
    select.value = state.model.serverProvider || "anthropic";
    select.onchange = () => { state.model.serverProvider = select.value; syncServerLiveState(); };
    card.append(select);

    const go = el("button", "btn btn--sm", "Manage stored keys →");
    go.type = "button";
    go.style.marginTop = "10px";
    go.onclick = () => selectTab("account");
    card.append(go);

    host.append(card);
    return;
  }

  state.connections.forEach((c, idx) => {
    const card = el("div", "card");
    card.setAttribute("aria-current", String(c.id === state.activeConnectionId));

    const head = el("div", "card__head");

    const use = el("input");
    use.type = "radio";
    use.name = "activeConn";
    use.checked = c.id === state.activeConnectionId;
    use.title = "Use this connection";
    use.style.accentColor = "var(--accent)";
    use.onchange = () => { state.activeConnectionId = c.id; save(); renderConnections(); updateStatus(); };

    const label = el("input", "input");
    label.value = c.label;
    label.oninput = () => { c.label = label.value; save(); updateStatus(); };

    const del = el("button", "btn btn--sm btn--danger", "✕");
    del.type = "button";
    del.disabled = state.connections.length <= 1;
    del.onclick = () => {
      state.connections.splice(idx, 1);
      if (state.activeConnectionId === c.id) state.activeConnectionId = state.connections[0].id;
      save(); renderConnections(); updateStatus();
    };

    head.append(use, label, del);
    card.append(head);

    const provider = el("select", "select");
    provider.style.marginTop = "8px";
    for (const [v, t] of [["anthropic", "Anthropic"], ["openai", "OpenAI-compatible"], ["custom", "Custom endpoint"]]) {
      const o = el("option", null, t); o.value = v; provider.append(o);
    }
    provider.value = c.provider;
    provider.onchange = () => { c.provider = provider.value; save(); updateStatus(); };
    card.append(provider);

    const base = el("input", "input");
    base.placeholder = "Base URL, e.g. https://your-proxy.example.com/v1";
    base.value = c.baseUrl;
    base.spellcheck = false;
    base.style.marginTop = "8px";
    base.oninput = () => { c.baseUrl = base.value.trim(); save(); };
    card.append(base);

    const model = el("input", "input");
    model.placeholder = "Model ID";
    model.value = c.model;
    model.spellcheck = false;
    model.style.marginTop = "8px";
    model.oninput = () => { c.model = model.value.trim(); save(); updateStatus(); };
    card.append(model);

    const key = el("input", "input");
    key.type = "password";
    key.placeholder = "API key (optional, leave empty if your proxy holds it)";
    key.value = c.apiKey;
    key.style.marginTop = "8px";
    key.oninput = () => { c.apiKey = key.value; save(); };
    card.append(key);

    /* custom headers */
    const hdrTitle = el("div", "field__help", "Custom headers");
    hdrTitle.style.margin = "10px 0 5px";
    card.append(hdrTitle);

    c.headers ??= [];
    c.headers.forEach((h, hi) => {
      const row = el("div", "kv");
      const k = el("input", "input");
      k.placeholder = "header";
      k.value = h.key ?? "";
      k.oninput = () => { h.key = k.value; save(); };
      const v = el("input", "input");
      v.placeholder = "value";
      v.value = h.value ?? "";
      v.oninput = () => { h.value = v.value; save(); };
      const rm = el("button", "btn btn--sm btn--ghost", "✕");
      rm.type = "button";
      rm.onclick = () => { c.headers.splice(hi, 1); save(); renderConnections(); };
      row.append(k, v, rm);
      card.append(row);
    });

    const foot = el("div", "row");
    foot.style.marginTop = "8px";

    const addHdr = el("button", "btn btn--sm", "＋ Header");
    addHdr.type = "button";
    addHdr.onclick = () => { c.headers.push({ key: "", value: "" }); save(); renderConnections(); };

    const test = el("button", "btn btn--sm", "Test");
    test.type = "button";
    test.onclick = async () => {
      test.disabled = true;
      test.textContent = "Testing…";
      try {
        const reply = await testConnection({ ...state.model, ...c, stream: false });
        toast(`OK, "${reply}"`);
      } catch (err) {
        toast(`Failed, ${err.message}`.slice(0, 120));
      } finally {
        test.disabled = false;
        test.textContent = "Test";
      }
    };

    foot.append(addHdr, test);
    card.append(foot);
    host.append(card);
  });
}

function renderModelPicker() {
  const m = state.model;
  const providerSel = $("#setProviderPick");
  const modelSel = $("#setModelPick");

  providerSel.replaceChildren();
  for (const [id, def] of Object.entries(PROVIDERS)) {
    const opt = el("option", null, def.label);
    opt.value = id;
    providerSel.append(opt);
  }
  providerSel.value = m.serverProvider in PROVIDERS ? m.serverProvider : "anthropic";

  const provider = PROVIDERS[providerSel.value];
  modelSel.replaceChildren();
  for (const model of provider.models) {
    const badges = [model.note, model.vision ? "images" : "text only"].filter(Boolean).join(", ");
    const opt = el("option", null, `${model.name} (${badges})`);
    opt.value = model.id;
    modelSel.append(opt);
  }
  if (!provider.models.some((x) => x.id === m.model)) {
    m.model = provider.models[0].id;
    save();
  }
  modelSel.value = m.model;

  const info = modelInfo(providerSel.value, m.model);
  $("#modelCapabilities").textContent = info
    ? `${info.vision ? "Accepts images" : "Text only"}. ${info.thinking ? "Can show its reasoning" : "No reasoning output"}.`
    : "";

  /* effort only exists where the provider exposes it */
  const levels = provider.effortLevels ?? [];
  const effortSel = $("#setEffort");
  $("#effortField").hidden = levels.length === 0 || !info?.thinking;
  effortSel.replaceChildren();
  for (const level of levels) {
    const opt = el("option", null, level);
    opt.value = level;
    effortSel.append(opt);
  }
  if (levels.length && !levels.includes(m.effort)) {
    m.effort = levels.includes("high") ? "high" : levels[0];
    save();
  }
  effortSel.value = m.effort;
}

function wireModel() {
  const m = state.model;

  $("#setProviderPick").onchange = (e) => {
    m.serverProvider = e.target.value;
    m.model = PROVIDERS[m.serverProvider].models[0].id;
    save(); renderModelPicker(); refreshHeader(); updateStatus(); renderConnections();
  };
  $("#setModelPick").onchange = (e) => {
    m.model = e.target.value;
    save(); renderModelPicker(); refreshHeader(); updateStatus();
  };
  $("#setEffort").onchange = (e) => { m.effort = e.target.value; save(); };

  bind("#setShowThinking", () => m.showThinking, (v) => { m.showThinking = v; renderTranscript(); },
    { event: "change", prop: "checked" });

  renderModelPicker();

  bind("#setSystem", () => m.system, (v) => { m.system = v; });
  bind("#setStop", () => m.stop, (v) => { m.stop = v; });

  bind("#setTemp", () => m.temperature, (v) => {
    m.temperature = v; fmt("#tempVal", () => m.temperature.toFixed(2));
  }, { cast: Number });
  fmt("#tempVal", () => m.temperature.toFixed(2));

  bind("#setTopP", () => m.topP, (v) => {
    m.topP = v; fmt("#topPVal", () => m.topP.toFixed(2));
  }, { cast: Number });
  fmt("#topPVal", () => m.topP.toFixed(2));

  bind("#setMaxTokens", () => m.maxTokens, (v) => { m.maxTokens = Math.max(64, v || 64); }, { cast: Number });
  bind("#setHistory", () => m.historyTurns, (v) => { m.historyTurns = Math.max(1, v || 1); }, { cast: Number });
  bind("#setStream", () => m.stream, (v) => { m.stream = v; }, { event: "change", prop: "checked" });
  bind("#setLive", () => m.live, (v) => {
    m.live = v; updateStatus(); toast(v ? "Live mode on" : "Back to demo mode");
  }, { event: "change", prop: "checked" });

  renderConnections();
}

function updateStatus() {
  if (serverMode) {
    const provider = state.model.serverProvider || "anthropic";
    const ready = Boolean(savedKeys[provider]);
    dom.connBadge.textContent = ready ? "relayed" : "no key";
    dom.connBadge.className = `badge${ready ? " badge--live" : ""}`;
    $("#modeTag").textContent = ready ? `via server · ${provider}` : BRAND.tagline;
    const info = modelInfo(provider, state.model.model);
    dom.modelHint.textContent = ready
      ? `${info?.name || state.model.model} via server`
      : "add a key in Settings → Account";
    return;
  }

  const live = state.model.live;
  const conn = activeConnection();
  dom.connBadge.textContent = live ? "live" : "demo";
  dom.connBadge.className = `badge${live ? " badge--live" : ""}`;
  $("#modeTag").textContent = live ? conn.model || "no model set" : BRAND.tagline;
  dom.modelHint.textContent = live ? `${conn.label} · ${conn.model}` : "demo replies";
}

/* ==========================================================================
   Prompts panel
   ========================================================================== */

function renderPromptEditor() {
  const host = $("#promptEditor");
  host.replaceChildren();

  state.prompts.forEach((p, idx) => {
    const card = el("div", "card");
    const head = el("div", "card__head");

    const name = el("input", "input");
    name.value = p.name;
    name.oninput = () => { p.name = name.value; save(); };

    const tag = el("input", "input");
    tag.placeholder = "tag";
    tag.style.maxWidth = "96px";
    tag.value = p.tag ?? "";
    tag.oninput = () => { p.tag = tag.value; save(); };

    head.append(name, tag);
    card.append(head);

    const body = el("textarea", "textarea");
    body.value = p.body;
    body.style.marginTop = "8px";
    body.oninput = () => { p.body = body.value; save(); };
    card.append(body);

    const foot = el("div", "row");
    foot.style.marginTop = "8px";

    const up = el("button", "btn btn--sm", "↑");
    up.type = "button"; up.disabled = idx === 0;
    up.onclick = () => { move(state.prompts, idx, idx - 1); save(); renderPromptEditor(); };

    const down = el("button", "btn btn--sm", "↓");
    down.type = "button"; down.disabled = idx === state.prompts.length - 1;
    down.onclick = () => { move(state.prompts, idx, idx + 1); save(); renderPromptEditor(); };

    const dupe = el("button", "btn btn--sm", "Duplicate");
    dupe.type = "button";
    dupe.onclick = () => {
      state.prompts.splice(idx + 1, 0, { ...p, id: uid(), name: `${p.name} copy` });
      save(); renderPromptEditor();
    };

    const del = el("button", "btn btn--sm btn--danger", "Delete");
    del.type = "button";
    del.onclick = () => { state.prompts.splice(idx, 1); save(); renderPromptEditor(); };

    foot.append(up, down, dupe, el("div", "spacer"), del);
    card.append(foot);
    host.append(card);
  });
}

/* ==========================================================================
   Advanced panel
   ========================================================================== */

const DUMP_TOKENS = [
  "--accent", "--accent-2", "--bg", "--surface", "--surface-2", "--text", "--border",
  "--radius", "--border-w", "--density", "--pad-y", "--pad-x", "--max-read",
  "--font-size", "--line-height", "--letter-spacing", "--sidebar-w", "--avatar-size",
];

function renderTokenDump() {
  const cs = getComputedStyle(dom.root);
  $("#tokenDump").textContent = DUMP_TOKENS
    .map((t) => `${t}: ${cs.getPropertyValue(t).trim()}`)
    .join("  ·  ");
}

function wireAdvanced() {
  const box = bind("#setCustomCss", () => state.ui.customCss, (v) => {
    state.ui.customCss = v;
    dom.userCss.textContent = v;
    renderTokenDump();
  });

  document.querySelectorAll("[data-css-snippet]").forEach((btn) => {
    btn.onclick = () => {
      if (btn.dataset.cssSnippet === "clear") {
        box.value = "";
      } else {
        const cs = getComputedStyle(dom.root);
        box.value = `:root {\n${DUMP_TOKENS.map((t) => `  ${t}: ${cs.getPropertyValue(t).trim()};`).join("\n")}\n}\n`;
      }
      box.dispatchEvent(new Event("input"));
    };
  });
}

/* ==========================================================================
   Data panel
   ========================================================================== */

function download(filename, text, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pickFile(inputSel, onJson) {
  const input = $(inputSel);
  input.onchange = async (e) => {
    const file = e.target.files?.[0];
    input.value = "";
    if (!file) return;
    try { onJson(JSON.parse(await file.text())); }
    catch { toast("That file isn't valid JSON"); }
  };
  input.click();
}

function storageInfo() {
  const bytes = new Blob([localStorage.getItem(storageKey()) || ""]).size;
  $("#storageInfo").textContent =
    `${state.chats.length} chats · ${state.prompts.length} prompts · ` +
    `${state.connections.length} connections · ${(bytes / 1024).toFixed(1)} KB used`;
}

function exportChatMarkdown() {
  const chat = activeChat();
  if (!chat || !chat.messages.length) return toast("Nothing to export");
  const lines = [
    `# ${chat.title}`, ``,
    `*${new Date(chat.createdAt).toLocaleString()}*`, ``,
    ...chat.messages.map((m) => {
      const who = m.role === "user" ? "You" : (m.modelName || "Assistant");
      const imgs = m.images?.length ? `\n\n_(${m.images.length} image attachment${m.images.length === 1 ? "" : "s"})_` : "";
      return `**${who}:**${imgs}\n\n${m.content}\n`;
    }),
  ];
  const safe = chat.title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "chat";
  download(`${BRAND.name.toLowerCase()}-${safe}.md`, lines.join("\n"), "text/markdown");
  toast("Exported");
}

function wireData() {
  $("#exportAllBtn").onclick = () => {
    download("cram-config.json", JSON.stringify(state, null, 2), "application/json");
    toast("Config exported");
  };
  $("#importAllBtn").onclick = () => pickFile("#importFile", (json) => {
    replaceState(json); location.reload();
  });

  $("#exportThemeBtn").onclick = () => {
    download("cram-theme.json", JSON.stringify({ ui: state.ui }, null, 2), "application/json");
    toast("Theme exported");
  };
  $("#importThemeBtn").onclick = () => pickFile("#importThemeFile", (json) => {
    if (json.ui) Object.assign(state.ui, json.ui);
    save(); location.reload();
  });

  $("#resetThemeBtn").onclick = () => {
    if (!confirm("Reset the look (theme, layout, type, branding)? Your chats are kept.")) return;
    Object.assign(state.ui, structuredClone(DEFAULTS.ui));
    save(); location.reload();
  };
  $("#resetBtn").onclick = () => {
    if (!confirm("Reset everything: settings, prompts, connections and chats?")) return;
    resetState(); location.reload();
  };
}

/* ==========================================================================
   Misc
   ========================================================================== */

let toastTimer;
function toast(text) {
  dom.toast.textContent = text;
  dom.toast.dataset.show = "true";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { dom.toast.dataset.show = "false"; }, 1900);
}

const PROVIDER_LABEL = { anthropic: "Anthropic", openai: "OpenAI", deepseek: "DeepSeek" };

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `${res.status} ${res.statusText}`);
  return data;
}

function renderKeyVault() {
  const host = $("#keyVault");
  host.replaceChildren();

  if (!encryptionOn) {
    const warn = el("div", "callout callout--warn",
      "This server has no ENCRYPTION_KEY set, so keys cannot be stored here. " +
      "Use Settings → Model to keep a key in this browser instead.");
    host.append(warn);
    $("#keySaveBtn").disabled = true;
    return;
  }

  const entries = Object.entries(savedKeys);
  if (!entries.length) {
    host.append(el("div", "empty-note", "No keys stored yet."));
    return;
  }

  for (const [provider, rec] of entries) {
    const card = el("div", "card");
    const head = el("div", "card__head");
    head.append(
      el("div", "card__name", PROVIDER_LABEL[provider] || provider),
      el("span", "field__help", rec.hint),
    );

    const del = el("button", "btn btn--sm btn--danger", "Delete");
    del.type = "button";
    del.onclick = async () => {
      if (!confirm(`Delete your stored ${PROVIDER_LABEL[provider] || provider} key?`)) return;
      try {
        const out = await postJson("/api/keys", { provider, delete: true });
        savedKeys = out.keys ?? {};
        syncServerLiveState();
        renderKeyVault(); renderConnections();
        toast("Key deleted");
      } catch (err) { toast(err.message); }
    };
    head.append(del);
    card.append(head);

    const when = el("div", "field__help",
      `stored ${new Date(rec.savedAt).toLocaleDateString()} · encrypted at rest`);
    when.style.marginTop = "6px";
    card.append(when);
    host.append(card);
  }
}

/** In server mode there is nothing to toggle: we're live iff a key is stored. */
function syncServerLiveState() {
  if (!serverMode) return;
  state.model.live = Boolean(savedKeys[state.model.serverProvider || "anthropic"]);
  save();
  updateStatus();
}

function wireAccountPanel() {
  document.querySelector('[data-tab="account"]').hidden = !account;
  if (!account) return;

  $("#acctEmail").textContent = account.email;

  $("#pwSaveBtn").onclick = async () => {
    const current = $("#pwCurrent").value;
    const next = $("#pwNew").value;
    const confirmed = $("#pwConfirm").value;
    const status = $("#pwStatus");

    if (next !== confirmed) { status.textContent = "The two new passwords don't match."; return; }
    status.textContent = "Working…";
    try {
      await postJson("/api/password", { current, next });
      $("#pwCurrent").value = $("#pwNew").value = $("#pwConfirm").value = "";
      status.textContent = "Password updated.";
      toast("Password updated");
    } catch (err) {
      status.textContent = err.message;
    }
  };

  $("#keySaveBtn").onclick = async () => {
    const provider = $("#keyProvider").value;
    const key = $("#keyValue").value.trim();
    const status = $("#keyStatus");
    if (!key) { status.textContent = "Paste a key first."; return; }

    status.textContent = "Encrypting…";
    try {
      const out = await postJson("/api/keys", { provider, key });
      savedKeys = out.keys ?? {};
      $("#keyValue").value = "";

      /* Only adopt the new provider if the one in use has no key yet, so adding
         a second key does not silently move you off the model you had picked. */
      const current = state.model.serverProvider;
      if (!savedKeys[current]) {
        state.model.serverProvider = provider;
        state.model.model = PROVIDERS[provider].models[0].id;
        renderModelPicker(); refreshHeader();
        status.textContent = `Stored, encrypted. Now using ${modelInfo(provider, state.model.model)?.name}.`;
      } else {
        status.textContent =
          `Stored, encrypted. Still using ${PROVIDER_LABEL[current]}; switch provider above to use it.`;
      }
      syncServerLiveState();
      renderKeyVault(); renderConnections();
      toast("Key encrypted and stored");
    } catch (err) {
      status.textContent = err.message;
    }
  };

  renderKeyVault();
}

function renderAccount() {
  const row = $("#accountRow");
  if (!account) { row.hidden = true; return; }
  row.hidden = false;
  $("#accountAvatar").textContent = account.email.slice(0, 2);
  $("#accountEmail").textContent = account.email;
  $("#accountEmail").title = account.email;
}

function refreshHeader() {
  const provider = state.model.serverProvider || "anthropic";
  const info = modelInfo(provider, state.model.model);
  $("#activeModelName").textContent = info?.name || state.model.model || "No model";
  const vision = supportsImages(provider, state.model.model);
  $("#attachBtn").hidden = !vision;
  $("#attachBtn").title = vision ? "Attach an image" : "This model cannot read images";
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function randomiseLook() {
  const u = state.ui;
  const presetKey = pick(Object.keys(THEME_PRESETS));
  const preset = THEME_PRESETS[presetKey];

  u.preset = presetKey;
  u.palettes = { light: {}, dark: {} };
  u.accent = pick([preset.accent, ...ACCENTS]);
  u.accent2 = pick([preset.accent2, ...ACCENTS]);
  u.gradient = Math.random() > 0.35;
  u.pattern = pick(["none", "none", "dots", "grid", "glow", "stripes"]);
  u.bubbles = pick(["card", "plain", "solid", "outline"]);
  u.align = pick(["left", "left", "split"]);
  u.avatars = pick(["emoji", "emoji", "initials", "none"]);
  u.radius = pick([0, 4, 8, 14, 20, 26]);
  u.borderW = pick([0, 1, 1, 2]);
  u.shadow = pick([0, 0.5, 1, 1.8]);
  Object.assign(u, LAYOUT_PRESETS[pick(Object.keys(LAYOUT_PRESETS))]);

  save();
  applyAppearance();
  renderPresetGrid();
  renderPaletteEditor();
  syncLayoutInputs();
  syncTypeInputs();
  syncVariantInputs();
  paintSwatches();
  renderTranscript();
  toast(`${preset.name}, randomised`);
}

function syncVariantInputs() {
  const u = state.ui;
  $("#setBubbles").value = u.bubbles;
  $("#setAlign").value = u.align;
  $("#setAvatars").value = u.avatars;
  $("#setPattern").value = u.pattern;
  $("#setAccent").value = u.accent;
  $("#setAccent2").value = u.accent2;
  $("#setGradient").checked = u.gradient;
}

function renderAll() {
  renderAccount();
  renderChatList();
  renderTranscript();
  refreshHeader();
  updateStatus();
  storageInfo();
}

/* ==========================================================================
   Events
   ========================================================================== */

function wireEvents() {
  $("#newChatBtn").onclick = () => { newChat(); renderAll(); dom.input.focus(); };

  $("#toggleSidebarBtn").onclick = () => {
    state.ui.sidebar = state.ui.sidebar === "shown" ? "hidden" : "shown";
    dom.app.dataset.sidebar = state.ui.sidebar;
    save();
  };

  $("#themeBtn").onclick = () => {
    state.ui.theme = isDark() ? "light" : "dark";
    $("#setTheme").value = state.ui.theme;
    save();
    applyAppearance();
    renderPresetGrid();
    renderPaletteEditor();
  };

  $("#settingsBtn").onclick = () => openDrawer("theme");
  $("#closeDrawerBtn").onclick = closeDrawer;
  dom.scrim.onclick = closeDrawer;
  $("#exportChatBtn").onclick = exportChatMarkdown;
  $("#randomThemeBtn").onclick = randomiseLook;

  $("#shortcutsBtn").onclick = () =>
    toast("⌘K new chat · ⌘/ settings · ⌘B sidebar · ⌘⇧L shuffle look · Esc close");

  $("#clearChatsBtn").onclick = () => {
    if (!state.chats.length) return;
    if (state.behavior.confirmDelete && !confirm(`Delete all ${state.chats.length} chats?`)) return;
    state.chats = [];
    state.activeChatId = null;
    save(); renderAll();
  };

  dom.chatSearch.addEventListener("input", renderChatList);
  document.querySelectorAll(".tab").forEach((t) => { t.onclick = () => selectTab(t.dataset.tab); });

  $("#addPromptBtn").onclick = () => {
    state.prompts.push({ id: uid(), name: "New prompt", tag: "", body: "" });
    save(); renderPromptEditor();
  };

  /* In server mode there is no endpoint to configure, so those controls are
     hidden. This must NOT return: everything below still needs wiring. */
  if (serverMode) {
    $("#addConnBtn").hidden = true;
    $("#useSharedBtn").hidden = true;
    $("#connHint").hidden = false;
    $("#setLive").closest(".switch").hidden = true;   // derived, not chosen
    renderConnections();
  } else {
  const useShared = $("#useSharedBtn");
  const hasStoredKey = Object.keys(savedKeys).length > 0;
  useShared.hidden = !((sharedEndpoint && sharedEndpoint.available) || hasStoredKey);
  useShared.textContent = hasStoredKey ? "Use my stored key" : "Use this server's key";
  useShared.onclick = () => {
    const provider = Object.keys(savedKeys)[0] || sharedEndpoint?.provider || "anthropic";
    state.connections.push({
      id: uid(),
      label: Object.keys(savedKeys).length ? "My stored key" : "This server's key",
      provider,
      baseUrl: new URL("/api/v1", location.origin).href,
      model: sharedEndpoint?.model || "",
      apiKey: "",
      headers: [],
    });
    state.activeConnectionId = state.connections.at(-1).id;
    state.model.live = true;
    $("#setLive").checked = true;
    save(); renderConnections(); updateStatus();
    toast("Added the server's shared endpoint");
  };

  $("#addConnBtn").onclick = () => {
    state.connections.push({
      id: uid(), label: "New connection", provider: "openai",
      baseUrl: "", model: "", apiKey: "", headers: [],
    });
    save(); renderConnections();
  };
  }

  // composer
  dom.input.addEventListener("input", () => { autosize(); refreshChips(); updateCount(); });
  dom.input.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Enter" && (state.behavior.enterSends ? !e.shiftKey : mod)) {
      e.preventDefault();
      send(dom.input.value);
    }
    if (e.key === "Tab" && dom.chips.querySelector("[data-prompt]:not([data-prompt='none'])")) {
      e.preventDefault();
      dom.chips.querySelector("[data-prompt]").click();
    }
  });

  dom.composer.addEventListener("submit", (e) => { e.preventDefault(); send(dom.input.value); });

  $("#attachBtn").onclick = () => dom.imageInput.click();
  dom.imageInput.onchange = async (e) => {
    await addImages([...e.target.files]);
    dom.imageInput.value = "";
  };
  $("#modelPickerBtn").onclick = () => openDrawer("model");

  dom.input.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    e.preventDefault();
    addImages(files);
  });

  for (const type of ["dragover", "drop"]) {
    dom.composer.addEventListener(type, (e) => {
      e.preventDefault();
      dom.composer.classList.toggle("composer--drop", type === "dragover");
      if (type === "drop") {
        const files = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith("image/"));
        if (files.length) addImages(files);
      }
    });
  }
  dom.composer.addEventListener("dragleave", () => dom.composer.classList.remove("composer--drop"));
  dom.stopBtn.onclick = () => abortController?.abort();


  document.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.shiftKey && e.key.toLowerCase() === "l") { e.preventDefault(); randomiseLook(); }
    else if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); newChat(); renderAll(); dom.input.focus(); }
    else if (mod && e.key === "/") { e.preventDefault(); openDrawer(); }
    else if (mod && e.key.toLowerCase() === "b") { e.preventDefault(); $("#toggleSidebarBtn").click(); }
    else if (e.key === "Escape") {
      if (dom.drawer.dataset.open === "true") closeDrawer();
      else if (dom.chips.firstElementChild) dom.chips.replaceChildren();
      else if (streaming) abortController?.abort();
    }
  });
}

/* ==========================================================================
   Boot
   ========================================================================== */

async function boot() {
  await loadServerConfig();
  if (account) useAccount(account.id);
  if (serverMode) state.model.live = Boolean(savedKeys[state.model.serverProvider || "anthropic"]);
  applyAppearance();
  applyBrand();
  wireTheme();
  wireLayout();
  wireType();
  wireBehavior();
  wireModel();
  wireAdvanced();
  wireData();
  wireAccountPanel();
  wireEvents();
  renderPromptEditor();
  syncVariantInputs();
  renderAll();
  autosize();
  updateCount();
  /* Write the normalised shape straight back, so keys dropped by a migration
     (brand, typeface, the old pilots) do not linger in storage. */
  save();
  dom.input.focus();
}

boot();

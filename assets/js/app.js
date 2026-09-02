/* ==========================================================================
   app.js — wiring. Renders from `state`, writes back to `state`, saves.
   ========================================================================== */

import {
  state, save, replaceState, resetState, uid, move,
  ACCENTS, THEME_PRESETS, LAYOUT_PRESETS, FONT_STACKS, DEFAULTS, STORAGE_KEY,
  activeChat, pilotById, activeConnection, newChat, deleteChat, titleFrom,
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
  pilotList: $("#pilotList"),
  pilotGrid: $("#pilotGrid"),
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
  activePilotName: $("#activePilotName"),
  connBadge: $("#connBadge"),
  drawer: $("#drawer"),
  scrim: $("#scrim"),
  toast: $("#toast"),
  userCss: $("#userCss"),
};

let abortController = null;
let streaming = false;

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

function fontStack() {
  const u = state.ui;
  return u.font === "custom" ? (u.fontCustom || FONT_STACKS.system) : (FONT_STACKS[u.font] || FONT_STACKS.system);
}

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
  s.setProperty("--font-ui", fontStack());
  s.setProperty("--font-mono", u.fontMono || FONT_STACKS.mono);
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
  const b = state.brand;
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

function renderPilots() {
  dom.pilotList.replaceChildren();
  for (const p of state.pilots) {
    const btn = el("button", "chat-item");
    btn.type = "button";
    btn.setAttribute("aria-current", String(p.id === state.activePilotId));
    btn.append(el("span", "chat-item__emoji", p.emoji || "🎯"), el("span", "chat-item__title", p.name));
    btn.onclick = () => { newChat(p.id); renderAll(); dom.input.focus(); };
    dom.pilotList.append(btn);
  }

  dom.pilotGrid.replaceChildren();
  for (const p of state.pilots) {
    const card = el("button", "pilot-card");
    card.type = "button";
    if (p.accent) card.style.setProperty("--pilot-accent", p.accent);
    const body = el("div");
    body.append(el("div", "pilot-card__name", p.name), el("div", "pilot-card__desc", p.desc || ""));
    card.append(el("div", "pilot-card__emoji", p.emoji || "🎯"), body);
    card.onclick = () => { newChat(p.id); renderAll(); dom.input.focus(); };
    dom.pilotGrid.append(card);
  }
}

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
    const pilot = pilotById(c.pilotId);
    row.append(el("span", "chat-item__emoji", pilot.emoji || "💬"), el("span", "chat-item__title", c.title));

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
    row.onclick = () => { state.activeChatId = c.id; state.activePilotId = c.pilotId; save(); renderAll(); };
    dom.chatList.append(row);
  }
}

/* ==========================================================================
   Transcript
   ========================================================================== */

const timeOf = (ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function avatarFor(role, pilot) {
  if (state.ui.avatars === "initials") {
    return role === "user" ? "You" : (pilot.name || "AI").slice(0, 2).toUpperCase();
  }
  return role === "user" ? "🧑" : pilot.emoji || "🎓";
}

function messageNode(msg, chat) {
  const pilot = pilotById(chat.pilotId);
  const wrap = el("div", `msg msg--${msg.role}`);
  wrap.dataset.id = msg.id;

  const avatar = el("div", "msg__avatar", avatarFor(msg.role, pilot));
  if (msg.role !== "user" && pilot.accent) avatar.style.background = pilot.accent;
  wrap.append(avatar);

  const body = el("div", "msg__body");
  const who = el("div", "msg__who");
  who.append(el("span", null, msg.role === "user" ? "You" : pilot.name));
  if (state.behavior.timestamps && msg.at) who.append(el("span", null, timeOf(msg.at)));
  if (msg.error) who.append(el("span", null, "· failed"));
  body.append(who);

  const content = el("div", "msg__content");
  if (msg.pending && !msg.content) {
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

function renderTranscript() {
  const chat = activeChat();
  dom.messages.replaceChildren();

  if (!chat || !chat.messages.length) {
    dom.welcome.hidden = false;
    dom.chatTitle.textContent = chat ? chat.title : "New chat";
    dom.chatMeta.textContent = chat ? pilotById(chat.pilotId).name : "";
    renderStarters(chat);
    return;
  }

  dom.welcome.hidden = true;
  dom.chatTitle.textContent = chat.title;
  const n = chat.messages.length;
  dom.chatMeta.textContent = `${pilotById(chat.pilotId).name} · ${n} message${n === 1 ? "" : "s"}`;

  for (const m of chat.messages) dom.messages.append(messageNode(m, chat));
}

/* per-pilot starter questions on an empty chat */
function renderStarters(chat) {
  if (!chat) return;
  const pilot = pilotById(chat.pilotId);
  const starters = (pilot.starters ?? []).filter(Boolean);
  if (!starters.length || dom.chips.childElementCount) return;
  dom.chips.replaceChildren();
  for (const s of starters) {
    const chip = el("button", "chip", s);
    chip.type = "button";
    chip.onclick = () => { dom.chips.replaceChildren(); send(s); };
    dom.chips.append(chip);
  }
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

function effectiveConfig(pilot) {
  const conn = activeConnection();
  return {
    ...state.model,
    provider: conn.provider,
    baseUrl: conn.baseUrl,
    apiKey: conn.apiKey,
    headers: conn.headers,
    model: pilot.model || conn.model,
    temperature: pilot.temperature ?? state.model.temperature,
    maxTokens: pilot.maxTokens ?? state.model.maxTokens,
    demoSpeed: state.behavior.demoSpeed,
  };
}

async function runCompletion(chat) {
  const pilot = pilotById(chat.pilotId);
  const cfg = effectiveConfig(pilot);
  const system = pilot.system?.trim() || state.model.system;

  const history = chat.messages
    .filter((m) => !m.error && m.content.trim())
    .slice(-Math.max(2, state.model.historyTurns * 2))
    .map((m) => ({ role: m.role, content: m.content }));

  const reply = { id: uid(), role: "assistant", content: "", at: Date.now(), pending: true };
  chat.messages.push(reply);
  renderTranscript();
  scrollToEnd(true);

  abortController = new AbortController();
  setStreaming(true);

  const node = () => dom.messages.querySelector(`[data-id="${reply.id}"] .msg__content`);
  const caret = state.behavior.streamCursor ? '<span class="cursor"></span>' : "";

  try {
    for await (const chunk of streamReply({
      system, messages: history, cfg,
      signal: abortController.signal,
      pilotName: pilot.name,
    })) {
      reply.content += chunk;
      const target = node();
      if (target) { target.innerHTML = md(reply.content) + caret; scrollToEnd(); }
    }
    if (!reply.content.trim()) reply.content = "_(empty response)_";
  } catch (err) {
    if (err.name === "AbortError") {
      reply.content += reply.content ? "\n\n_(stopped)_" : "_(stopped)_";
    } else {
      reply.error = true;
      reply.content = `**Request failed** — ${err.message}\n\nCheck Settings → Model, or turn Live mode off to keep using demo replies.`;
    }
  } finally {
    reply.pending = false;
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
  if (!body || streaming) return;

  let chat = activeChat();
  if (!chat) chat = newChat();

  chat.messages.push({ id: uid(), role: "user", content: body, at: Date.now() });
  if (state.behavior.autoTitle && chat.title === "New chat") chat.title = titleFrom(body);
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
    const note = el("span", "hint", "No saved prompt matches — Settings → Prompts to add one.");
    note.dataset.prompt = "none";
    dom.chips.append(note);
  }
}

function showPilotChips() {
  dom.chips.replaceChildren();
  for (const p of state.pilots) {
    const chip = el("button", `chip${p.id === state.activePilotId ? " chip--on" : ""}`, `${p.emoji || "🎯"} ${p.name}`);
    chip.type = "button";
    chip.onclick = () => {
      const chat = activeChat();
      if (chat && !chat.messages.length) {
        chat.pilotId = p.id;
        if (p.greeting) chat.messages.push({ id: uid(), role: "assistant", content: p.greeting, at: Date.now() });
      } else {
        newChat(p.id);
      }
      state.activePilotId = p.id;
      save();
      dom.chips.replaceChildren();
      renderAll();
      dom.input.focus();
    };
    dom.chips.append(chip);
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

  const toggleCustom = () => { $("#fontCustomField").hidden = u.font !== "custom"; };
  bind("#setFont", () => u.font, (v) => { u.font = v; toggleCustom(); applyAppearance(); }, { event: "change" });
  toggleCustom();

  bind("#setFontCustom", () => u.fontCustom, (v) => { u.fontCustom = v; applyAppearance(); });
  bind("#setFontMono", () => u.fontMono, (v) => { u.fontMono = v; applyAppearance(); });

  for (const [sel, key, valSel, format] of TYPE_RANGES) {
    bind(sel, () => u[key], (v) => {
      u[key] = v; applyAppearance(); fmt(valSel, () => format(u[key]));
    }, { cast: Number });
    fmt(valSel, () => format(u[key]));
  }
}

/* ==========================================================================
   Branding panel
   ========================================================================== */

function wireBrand() {
  const b = state.brand;
  const pairs = [
    ["#setBrandLogo", "logo"], ["#setBrandName", "name"], ["#setBrandTagline", "tagline"],
    ["#setWelcomeTitle", "welcomeTitle"], ["#setWelcomeSubtitle", "welcomeSubtitle"],
    ["#setSendLabel", "sendLabel"], ["#setPlaceholder", "placeholder"],
  ];
  for (const [sel, key] of pairs) {
    bind(sel, () => b[key], (v) => { b[key] = v; applyBrand(); updateStatus(); });
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

  renderDefaultPilotSelect();
}

function renderDefaultPilotSelect() {
  const sel = $("#setDefaultPilot");
  sel.replaceChildren();
  for (const p of state.pilots) {
    const opt = el("option", null, `${p.emoji || "🎯"} ${p.name}`);
    opt.value = p.id;
    sel.append(opt);
  }
  sel.value = state.behavior.defaultPilot;
  sel.onchange = () => { state.behavior.defaultPilot = sel.value; save(); };
}

/* ==========================================================================
   Model panel
   ========================================================================== */

function renderConnections() {
  const host = $("#connectionEditor");
  host.replaceChildren();

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
    base.placeholder = "Base URL — https://your-proxy.example.com/v1";
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
    key.placeholder = "API key (optional — leave empty if your proxy holds it)";
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
        toast(`OK — "${reply}"`);
      } catch (err) {
        toast(`Failed — ${err.message}`.slice(0, 120));
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

function wireModel() {
  const m = state.model;

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
  const live = state.model.live;
  const conn = activeConnection();
  dom.connBadge.textContent = live ? "live" : "demo";
  dom.connBadge.className = `badge${live ? " badge--live" : ""}`;
  $("#modeTag").textContent = live ? conn.model || "no model set" : state.brand.tagline;
  dom.modelHint.textContent = live ? `${conn.label} · ${conn.model}` : "demo replies";
}

/* ==========================================================================
   Pilots panel
   ========================================================================== */

function renderPilotEditor() {
  const host = $("#pilotEditor");
  host.replaceChildren();

  state.pilots.forEach((p, idx) => {
    const card = el("div", "card");
    const head = el("div", "card__head");

    const emoji = el("input", "input");
    emoji.value = p.emoji || "";
    emoji.style.width = "48px";
    emoji.style.textAlign = "center";
    emoji.oninput = () => { p.emoji = emoji.value; save(); renderPilots(); renderDefaultPilotSelect(); };

    const name = el("input", "input");
    name.value = p.name;
    name.oninput = () => { p.name = name.value; save(); renderPilots(); refreshHeader(); renderDefaultPilotSelect(); };

    const accent = el("input", "color");
    accent.type = "color";
    accent.value = p.accent || state.ui.accent;
    accent.title = "Pilot accent";
    accent.oninput = () => { p.accent = accent.value; save(); renderPilots(); renderTranscript(); };

    head.append(emoji, name, accent);
    card.append(head);

    const desc = el("input", "input");
    desc.placeholder = "Short description (shown on the welcome cards)";
    desc.value = p.desc || "";
    desc.style.marginTop = "8px";
    desc.oninput = () => { p.desc = desc.value; save(); renderPilots(); };
    card.append(desc);

    const sys = el("textarea", "textarea");
    sys.placeholder = "System prompt";
    sys.value = p.system || "";
    sys.style.marginTop = "8px";
    sys.oninput = () => { p.system = sys.value; save(); };
    card.append(sys);

    const greet = el("input", "input");
    greet.placeholder = "Opening line (optional)";
    greet.value = p.greeting || "";
    greet.style.marginTop = "8px";
    greet.oninput = () => { p.greeting = greet.value; save(); };
    card.append(greet);

    const starters = el("input", "input");
    starters.placeholder = "Starter questions, separated by |";
    starters.value = (p.starters ?? []).join(" | ");
    starters.style.marginTop = "8px";
    starters.oninput = () => {
      p.starters = starters.value.split("|").map((s) => s.trim()).filter(Boolean);
      save();
    };
    card.append(starters);

    const row = el("div", "grid-3");
    row.style.marginTop = "8px";

    const model = el("input", "input");
    model.placeholder = "Model override";
    model.value = p.model || "";
    model.oninput = () => { p.model = model.value.trim(); save(); };

    const temp = el("input", "input");
    temp.type = "number"; temp.step = "0.05"; temp.min = "0"; temp.max = "1";
    temp.placeholder = "Temp";
    temp.value = p.temperature ?? "";
    temp.oninput = () => { p.temperature = temp.value === "" ? null : Number(temp.value); save(); };

    const tokens = el("input", "input");
    tokens.type = "number"; tokens.step = "64"; tokens.min = "64";
    tokens.placeholder = "Max tok";
    tokens.value = p.maxTokens ?? "";
    tokens.oninput = () => { p.maxTokens = tokens.value === "" ? null : Number(tokens.value); save(); };

    row.append(model, temp, tokens);
    card.append(row);

    const foot = el("div", "row");
    foot.style.marginTop = "8px";

    const up = el("button", "btn btn--sm", "↑");
    up.type = "button"; up.disabled = idx === 0;
    up.onclick = () => { move(state.pilots, idx, idx - 1); save(); renderPilotEditor(); renderPilots(); };

    const down = el("button", "btn btn--sm", "↓");
    down.type = "button"; down.disabled = idx === state.pilots.length - 1;
    down.onclick = () => { move(state.pilots, idx, idx + 1); save(); renderPilotEditor(); renderPilots(); };

    const dupe = el("button", "btn btn--sm", "Duplicate");
    dupe.type = "button";
    dupe.onclick = () => {
      state.pilots.splice(idx + 1, 0, { ...structuredClone(p), id: uid(), name: `${p.name} copy` });
      save(); renderPilotEditor(); renderPilots(); renderDefaultPilotSelect();
    };

    const del = el("button", "btn btn--sm btn--danger", "Delete");
    del.type = "button";
    del.disabled = state.pilots.length <= 1;
    del.onclick = () => {
      state.pilots.splice(idx, 1);
      if (state.activePilotId === p.id) state.activePilotId = state.pilots[0].id;
      if (state.behavior.defaultPilot === p.id) state.behavior.defaultPilot = state.pilots[0].id;
      save(); renderPilotEditor(); renderDefaultPilotSelect(); renderAll();
    };

    foot.append(up, down, dupe, el("div", "spacer"), del);
    card.append(foot);
    host.append(card);
  });
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
  const bytes = new Blob([localStorage.getItem(STORAGE_KEY) || ""]).size;
  $("#storageInfo").textContent =
    `${state.chats.length} chats · ${state.pilots.length} pilots · ${state.prompts.length} prompts · ` +
    `${state.connections.length} connections · ${(bytes / 1024).toFixed(1)} KB used`;
}

function exportChatMarkdown() {
  const chat = activeChat();
  if (!chat || !chat.messages.length) return toast("Nothing to export");
  const pilot = pilotById(chat.pilotId);
  const lines = [
    `# ${chat.title}`, ``,
    `*Pilot: ${pilot.name} · ${new Date(chat.createdAt).toLocaleString()}*`, ``,
    ...chat.messages.map((m) => `**${m.role === "user" ? "You" : pilot.name}:**\n\n${m.content}\n`),
  ];
  const safe = chat.title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "chat";
  download(`${(state.brand.name || "chat").toLowerCase()}-${safe}.md`, lines.join("\n"), "text/markdown");
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
    download("cram-theme.json", JSON.stringify({ ui: state.ui, brand: state.brand }, null, 2), "application/json");
    toast("Theme exported");
  };
  $("#importThemeBtn").onclick = () => pickFile("#importThemeFile", (json) => {
    if (json.ui) Object.assign(state.ui, json.ui);
    if (json.brand) Object.assign(state.brand, json.brand);
    save(); location.reload();
  });

  $("#resetThemeBtn").onclick = () => {
    if (!confirm("Reset the look (theme, layout, type, branding)? Chats and pilots are kept.")) return;
    Object.assign(state.ui, structuredClone(DEFAULTS.ui));
    Object.assign(state.brand, structuredClone(DEFAULTS.brand));
    save(); location.reload();
  };
  $("#resetBtn").onclick = () => {
    if (!confirm("Reset everything — settings, pilots, prompts, connections and chats?")) return;
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

function refreshHeader() {
  dom.activePilotName.textContent = pilotById(activeChat()?.pilotId ?? state.activePilotId).name;
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
  u.font = pick(["system", "system", "serif", "mono", "rounded"]);
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
  $("#setFont").value = u.font;
  $("#setAccent").value = u.accent;
  $("#setAccent2").value = u.accent2;
  $("#setGradient").checked = u.gradient;
  $("#fontCustomField").hidden = u.font !== "custom";
}

function renderAll() {
  renderPilots();
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

  $("#addPilotBtn").onclick = () => {
    state.pilots.push({
      id: uid(), emoji: "🎯", name: "New pilot", desc: "", accent: "",
      system: "", greeting: "", model: "", temperature: null, maxTokens: null, starters: [],
    });
    save(); renderPilotEditor(); renderPilots(); renderDefaultPilotSelect();
  };

  $("#addPromptBtn").onclick = () => {
    state.prompts.push({ id: uid(), name: "New prompt", tag: "", body: "" });
    save(); renderPromptEditor();
  };

  $("#addConnBtn").onclick = () => {
    state.connections.push({
      id: uid(), label: "New connection", provider: "openai",
      baseUrl: "", model: "", apiKey: "", headers: [],
    });
    save(); renderConnections();
  };

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
  dom.stopBtn.onclick = () => abortController?.abort();
  $("#pilotPickerBtn").onclick = () => {
    if (dom.chips.firstElementChild) dom.chips.replaceChildren();
    else showPilotChips();
  };

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

function boot() {
  applyAppearance();
  applyBrand();
  wireTheme();
  wireLayout();
  wireType();
  wireBrand();
  wireBehavior();
  wireModel();
  wireAdvanced();
  wireData();
  wireEvents();
  renderPilotEditor();
  renderPromptEditor();
  syncVariantInputs();
  renderAll();
  autosize();
  updateCount();
  dom.input.focus();
}

boot();

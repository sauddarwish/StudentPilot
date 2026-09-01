/* ==========================================================================
   app.js — wiring. Renders from `state`, writes back to `state`, saves.
   ========================================================================== */

import {
  state, save, replaceState, resetState, uid, ACCENTS, STORAGE_KEY,
  activeChat, pilotById, newChat, deleteChat, titleFrom,
} from "./store.js";
import { render as md } from "./markdown.js";
import { streamReply } from "./api.js";

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
  activePilotName: $("#activePilotName"),
  connBadge: $("#connBadge"),
  modeTag: $("#modeTag"),
  drawer: $("#drawer"),
  scrim: $("#scrim"),
  toast: $("#toast"),
};

let abortController = null;
let streaming = false;

/* ==========================================================================
   Appearance
   ========================================================================== */

const media = window.matchMedia("(prefers-color-scheme: dark)");

function applyTheme() {
  const { theme } = state.ui;
  const dark = theme === "dark" || (theme === "system" && media.matches);
  dom.root.dataset.theme = dark ? "dark" : "light";
  $("#themeBtn").textContent = dark ? "☀️" : "🌙";
}

function applyAppearance() {
  const s = dom.root.style;
  const u = state.ui;
  s.setProperty("--accent", u.accent);
  s.setProperty("--font-ui", u.font);
  s.setProperty("--font-size", `${u.fontSize}px`);
  s.setProperty("--density", `${u.density}px`);
  s.setProperty("--max-read", `${u.width}rem`);
  s.setProperty("--radius", `${u.radius}px`);
  s.setProperty("--bubble-radius", `${Math.max(u.radius, 4)}px`);
  s.setProperty("--accent-fg", contrastOn(u.accent));
  dom.root.dataset.bubbles = u.bubbles;
  dom.app.dataset.sidebar = u.sidebar;
  applyTheme();
}

/* pick black or white text for a given accent so buttons stay readable */
function contrastOn(hex) {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.45 ? "#101218" : "#ffffff";
}

media.addEventListener("change", () => { if (state.ui.theme === "system") applyTheme(); });

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
    row.append(
      el("span", "chat-item__emoji", pilot.emoji || "💬"),
      el("span", "chat-item__title", c.title),
    );
    const x = el("button", "chat-item__x", "✕");
    x.type = "button";
    x.title = "Delete chat";
    x.onclick = (e) => { e.stopPropagation(); deleteChat(c.id); renderAll(); };
    row.append(x);
    row.onclick = () => { state.activeChatId = c.id; state.activePilotId = c.pilotId; save(); renderAll(); };
    dom.chatList.append(row);
  }
}

/* ==========================================================================
   Transcript
   ========================================================================== */

const timeOf = (ts) =>
  new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function messageNode(msg, chat) {
  const pilot = pilotById(chat.pilotId);
  const wrap = el("div", `msg msg--${msg.role}`);
  wrap.dataset.id = msg.id;

  wrap.append(el("div", "msg__avatar", msg.role === "user" ? "🧑" : pilot.emoji || "🎓"));

  const body = el("div", "msg__body");
  const who = el("div", "msg__who");
  who.append(el("span", null, msg.role === "user" ? "You" : pilot.name));
  if (state.ui.timestamps && msg.at) who.append(el("span", null, timeOf(msg.at)));
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
    copy.onclick = () => {
      navigator.clipboard.writeText(msg.content).then(() => toast("Copied"));
    };
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
        const prevUser = [...chat.messages.slice(0, i)].reverse().find((m) => m.role === "user");
        if (!prevUser) return;
        chat.messages.splice(i);
        save(); renderAll();
        runCompletion(chat);
      };
      tools.append(retry);
    }
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
    if (chat) {
      dom.chatTitle.textContent = chat.title;
      dom.chatMeta.textContent = pilotById(chat.pilotId).name;
    } else {
      dom.chatTitle.textContent = "New chat";
      dom.chatMeta.textContent = "";
    }
    return;
  }

  dom.welcome.hidden = true;
  dom.chatTitle.textContent = chat.title;
  dom.chatMeta.textContent =
    `${pilotById(chat.pilotId).name} · ${chat.messages.length} message${chat.messages.length === 1 ? "" : "s"}`;

  for (const m of chat.messages) dom.messages.append(messageNode(m, chat));
}

function scrollToEnd(force = false) {
  const t = dom.transcript;
  const nearBottom = t.scrollHeight - t.scrollTop - t.clientHeight < 200;
  if (force || nearBottom) t.scrollTop = t.scrollHeight;
}

/* ==========================================================================
   Sending
   ========================================================================== */

function effectiveConfig(pilot) {
  return {
    ...state.model,
    model: pilot.model || state.model.model,
    temperature: pilot.temperature ?? state.model.temperature,
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

  try {
    for await (const chunk of streamReply({
      system, messages: history, cfg,
      signal: abortController.signal,
      pilotName: pilot.name,
    })) {
      reply.content += chunk;
      const target = node();
      if (target) { target.innerHTML = md(reply.content); scrollToEnd(); }
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
  if (chat.title === "New chat") chat.title = titleFrom(body);
  chat.updatedAt = Date.now();

  // move touched chat to the top of the list
  const i = state.chats.indexOf(chat);
  if (i > 0) state.chats.splice(0, 0, ...state.chats.splice(i, 1));

  save();
  dom.input.value = "";
  autosize();
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

function insertPrompt(promptObj) {
  dom.input.value = promptObj.body;
  dom.chips.replaceChildren();
  autosize();
  dom.input.focus();

  const m = promptObj.body.match(/\{\{[^}]+\}\}/);
  if (m) dom.input.setSelectionRange(m.index, m.index + m[0].length);
  else dom.input.setSelectionRange(promptObj.body.length, promptObj.body.length);
}

function refreshChips() {
  const v = dom.input.value;
  dom.chips.replaceChildren();
  if (!v.startsWith("/")) return;

  const q = v.slice(1).toLowerCase();
  const hits = state.prompts.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 8);
  for (const p of hits) {
    const chip = el("button", "chip", p.name);
    chip.type = "button";
    chip.onclick = () => insertPrompt(p);
    dom.chips.append(chip);
  }
  if (!hits.length) dom.chips.append(el("span", "hint", "No saved prompt matches — Settings → Prompts to add one."));
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
   Settings drawer
   ========================================================================== */

function openDrawer(tab) {
  dom.drawer.dataset.open = "true";
  dom.scrim.dataset.open = "true";
  if (tab) selectTab(tab);
}
function closeDrawer() {
  dom.drawer.dataset.open = "false";
  dom.scrim.dataset.open = "false";
}

function selectTab(name) {
  document.querySelectorAll(".tab").forEach((t) =>
    t.setAttribute("aria-selected", String(t.dataset.tab === name)));
  document.querySelectorAll(".panel").forEach((p) =>
    p.dataset.active = String(p.dataset.panel === name));
}

/* --- generic binder: input -> state path -> side effect ------------------ */
function bind(sel, get, set, { event = "input", prop = "value", cast = (v) => v } = {}) {
  const node = $(sel);
  node[prop] = get();
  node.addEventListener(event, () => {
    set(cast(node[prop]));
    save();
  });
  return node;
}

function fmt(sel, fn) { $(sel).textContent = fn(); }

function wireAppearance() {
  const u = state.ui;

  bind("#setTheme", () => u.theme, (v) => { u.theme = v; applyTheme(); }, { event: "change" });

  const swatches = $("#accentSwatches");
  const paintSwatches = () =>
    swatches.querySelectorAll(".swatch").forEach((s) =>
      s.setAttribute("aria-pressed", String(s.dataset.color === u.accent)));

  for (const color of ACCENTS) {
    const b = el("button", "swatch");
    b.type = "button";
    b.dataset.color = color;
    b.style.background = color;
    b.title = color;
    b.onclick = () => { u.accent = color; $("#setAccentCustom").value = color; applyAppearance(); paintSwatches(); save(); };
    swatches.append(b);
  }
  paintSwatches();

  bind("#setAccentCustom", () => u.accent,
    (v) => { u.accent = v; applyAppearance(); paintSwatches(); });

  bind("#setFont", () => u.font, (v) => { u.font = v; applyAppearance(); }, { event: "change" });

  const sizeRange = bind("#setFontSize", () => u.fontSize,
    (v) => { u.fontSize = v; applyAppearance(); fmt("#fontSizeVal", () => `${u.fontSize}px`); }, { cast: Number });
  sizeRange.value = u.fontSize;
  fmt("#fontSizeVal", () => `${u.fontSize}px`);

  bind("#setBubbles", () => u.bubbles, (v) => { u.bubbles = v; applyAppearance(); }, { event: "change" });

  bind("#setDensity", () => u.density,
    (v) => { u.density = v; applyAppearance(); fmt("#densityVal", () => `${u.density}px`); }, { cast: Number });
  fmt("#densityVal", () => `${u.density}px`);

  bind("#setWidth", () => u.width,
    (v) => { u.width = v; applyAppearance(); fmt("#widthVal", () => `${u.width}rem`); }, { cast: Number });
  fmt("#widthVal", () => `${u.width}rem`);

  bind("#setRadius", () => u.radius,
    (v) => { u.radius = v; applyAppearance(); fmt("#radiusVal", () => `${u.radius}px`); }, { cast: Number });
  fmt("#radiusVal", () => `${u.radius}px`);

  bind("#setEnterSends", () => u.enterSends, (v) => { u.enterSends = v; }, { event: "change", prop: "checked" });
  bind("#setTimestamps", () => u.timestamps, (v) => { u.timestamps = v; renderTranscript(); }, { event: "change", prop: "checked" });
}

function wireModel() {
  const m = state.model;

  bind("#setProvider", () => m.provider, (v) => { m.provider = v; updateStatus(); }, { event: "change" });
  bind("#setBaseUrl", () => m.baseUrl, (v) => { m.baseUrl = v.trim(); });
  bind("#setModel", () => m.model, (v) => { m.model = v.trim(); updateStatus(); });
  bind("#setApiKey", () => m.apiKey, (v) => { m.apiKey = v; });
  bind("#setSystem", () => m.system, (v) => { m.system = v; });

  bind("#setTemp", () => m.temperature,
    (v) => { m.temperature = v; fmt("#tempVal", () => m.temperature.toFixed(2)); }, { cast: Number });
  fmt("#tempVal", () => m.temperature.toFixed(2));

  bind("#setTopP", () => m.topP,
    (v) => { m.topP = v; fmt("#topPVal", () => m.topP.toFixed(2)); }, { cast: Number });
  fmt("#topPVal", () => m.topP.toFixed(2));

  bind("#setMaxTokens", () => m.maxTokens, (v) => { m.maxTokens = Math.max(64, v || 64); }, { cast: Number });
  bind("#setHistory", () => m.historyTurns, (v) => { m.historyTurns = Math.max(1, v || 1); }, { cast: Number });
  bind("#setStream", () => m.stream, (v) => { m.stream = v; }, { event: "change", prop: "checked" });
  bind("#setLive", () => m.live, (v) => { m.live = v; updateStatus(); toast(v ? "Live mode on" : "Back to demo mode"); },
    { event: "change", prop: "checked" });
}

function updateStatus() {
  const live = state.model.live;
  dom.connBadge.textContent = live ? "live" : "demo";
  dom.connBadge.className = `badge${live ? " badge--live" : ""}`;
  dom.modeTag.textContent = live ? state.model.model || "no model set" : "demo mode";
  dom.modelHint.textContent = live ? `${state.model.provider} · ${state.model.model}` : "demo replies";
}

/* --- pilots -------------------------------------------------------------- */

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
    emoji.oninput = () => { p.emoji = emoji.value; save(); renderPilots(); };

    const name = el("input", "input");
    name.value = p.name;
    name.oninput = () => { p.name = name.value; save(); renderPilots(); refreshHeader(); };

    const del = el("button", "btn btn--sm btn--danger", "Delete");
    del.type = "button";
    del.disabled = state.pilots.length <= 1;
    del.onclick = () => {
      state.pilots.splice(idx, 1);
      if (state.activePilotId === p.id) state.activePilotId = state.pilots[0].id;
      save(); renderPilotEditor(); renderAll();
    };

    head.append(emoji, name, del);
    card.append(head);

    const desc = el("input", "input");
    desc.placeholder = "Short description (shown on the welcome card)";
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

    const row = el("div", "grid-2");
    row.style.marginTop = "8px";

    const model = el("input", "input");
    model.placeholder = "Model override (optional)";
    model.value = p.model || "";
    model.oninput = () => { p.model = model.value.trim(); save(); };

    const temp = el("input", "input");
    temp.type = "number";
    temp.step = "0.05"; temp.min = "0"; temp.max = "1";
    temp.placeholder = "Temp override";
    temp.value = p.temperature ?? "";
    temp.oninput = () => { p.temperature = temp.value === "" ? null : Number(temp.value); save(); };

    row.append(model, temp);
    card.append(row);
    host.append(card);
  });
}

/* --- prompts ------------------------------------------------------------- */

function renderPromptEditor() {
  const host = $("#promptEditor");
  host.replaceChildren();

  state.prompts.forEach((p, idx) => {
    const card = el("div", "card");
    const head = el("div", "card__head");

    const name = el("input", "input");
    name.value = p.name;
    name.oninput = () => { p.name = name.value; save(); };

    const del = el("button", "btn btn--sm btn--danger", "Delete");
    del.type = "button";
    del.onclick = () => { state.prompts.splice(idx, 1); save(); renderPromptEditor(); };

    head.append(name, del);
    card.append(head);

    const body = el("textarea", "textarea");
    body.value = p.body;
    body.style.marginTop = "8px";
    body.oninput = () => { p.body = body.value; save(); };
    card.append(body);

    host.append(card);
  });
}

/* --- data ---------------------------------------------------------------- */

function download(filename, text, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function storageInfo() {
  const bytes = new Blob([localStorage.getItem(STORAGE_KEY) || ""]).size;
  const kb = (bytes / 1024).toFixed(1);
  $("#storageInfo").textContent =
    `${state.chats.length} chats · ${state.pilots.length} pilots · ${state.prompts.length} prompts · ${kb} KB used`;
}

function exportChatMarkdown() {
  const chat = activeChat();
  if (!chat || !chat.messages.length) return toast("Nothing to export");
  const pilot = pilotById(chat.pilotId);
  const lines = [
    `# ${chat.title}`,
    ``,
    `*Pilot: ${pilot.name} · ${new Date(chat.createdAt).toLocaleString()}*`,
    ``,
    ...chat.messages.map((m) => `**${m.role === "user" ? "You" : pilot.name}:**\n\n${m.content}\n`),
  ];
  const safe = chat.title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "chat";
  download(`studentpilot-${safe}.md`, lines.join("\n"), "text/markdown");
  toast("Exported");
}

/* ==========================================================================
   Misc UI
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
    const dark = dom.root.dataset.theme === "dark";
    state.ui.theme = dark ? "light" : "dark";
    $("#setTheme").value = state.ui.theme;
    applyTheme();
    save();
  };
  $("#settingsBtn").onclick = () => openDrawer("appearance");
  $("#closeDrawerBtn").onclick = closeDrawer;
  dom.scrim.onclick = closeDrawer;
  $("#exportChatBtn").onclick = exportChatMarkdown;

  $("#shortcutsBtn").onclick = () => {
    toast("⌘K new chat · ⌘/ settings · ⌘B sidebar · Esc close");
  };

  $("#clearChatsBtn").onclick = () => {
    if (!state.chats.length) return;
    if (!confirm(`Delete all ${state.chats.length} chats? This cannot be undone.`)) return;
    state.chats = [];
    state.activeChatId = null;
    save(); renderAll();
  };

  dom.chatSearch.addEventListener("input", renderChatList);

  document.querySelectorAll(".tab").forEach((t) => {
    t.onclick = () => selectTab(t.dataset.tab);
  });

  $("#addPilotBtn").onclick = () => {
    state.pilots.push({
      id: uid(), emoji: "🎯", name: "New pilot", desc: "",
      system: "", greeting: "", model: "", temperature: null,
    });
    save(); renderPilotEditor(); renderPilots();
  };

  $("#addPromptBtn").onclick = () => {
    state.prompts.push({ id: uid(), name: "New prompt", body: "" });
    save(); renderPromptEditor();
  };

  $("#exportAllBtn").onclick = () => {
    download("studentpilot-config.json", JSON.stringify(state, null, 2), "application/json");
    toast("Config exported");
  };
  $("#importAllBtn").onclick = () => $("#importFile").click();
  $("#importFile").onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      replaceState(JSON.parse(await file.text()));
      applyAppearance();
      location.reload();
    } catch {
      toast("That file isn't valid StudentPilot config");
    }
  };

  $("#resetBtn").onclick = () => {
    if (!confirm("Reset all settings, pilots, prompts and chats?")) return;
    resetState();
    location.reload();
  };

  // composer
  dom.input.addEventListener("input", () => { autosize(); refreshChips(); });
  dom.input.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Enter") {
      if (state.ui.enterSends ? !e.shiftKey : mod) {
        e.preventDefault();
        send(dom.input.value);
      }
    }
    if (e.key === "Tab" && dom.chips.firstElementChild?.classList.contains("chip")) {
      e.preventDefault();
      dom.chips.firstElementChild.click();
    }
  });

  dom.composer.addEventListener("submit", (e) => { e.preventDefault(); send(dom.input.value); });
  dom.stopBtn.onclick = () => abortController?.abort();
  $("#pilotPickerBtn").onclick = () => {
    if (dom.chips.firstElementChild) dom.chips.replaceChildren();
    else showPilotChips();
  };

  // global shortcuts
  document.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); newChat(); renderAll(); dom.input.focus(); }
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
  wireAppearance();
  wireModel();
  wireEvents();
  renderPilotEditor();
  renderPromptEditor();
  renderAll();
  autosize();
  dom.input.focus();
}

boot();

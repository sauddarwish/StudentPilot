/* ==========================================================================
   store.js, defaults, persistence, and the single mutable app state.
   Everything lives in localStorage under one key so export/import is trivial.
   ========================================================================== */

export const STORAGE_KEY = "cram.v1";

/* Muted, ink-and-pigment tones, nothing neon. */
export const ACCENTS = [
  "#c15f3c", "#a8503a", "#8a6a3f", "#6b7150",
  "#4a7c6f", "#4a6b8a", "#7a5b7d", "#4a4a46",
];

/* Theme presets write a whole palette at once. `light`/`dark` keys are merged
   over the stylesheet defaults; anything omitted falls back to the stylesheet. */
export const THEME_PRESETS = {
  /* Cream stock, warm ink, one muted terracotta accent. */
  book: {
    name: "Book", accent: "#c15f3c", accent2: "#c15f3c",
    light: {
      bg: "#efece3", surface: "#f8f6f0", "surface-2": "#e7e3d8", "surface-3": "#dcd7c9",
      text: "#1c1b17", "text-dim": "#57544c", "text-faint": "#8a867b",
      border: "#ded9cc", "border-strong": "#c6c0ae",
      "user-bubble": "#e5e0d2",
    },
    dark: {
      bg: "#171612", surface: "#1e1d18", "surface-2": "#262420", "surface-3": "#322f28",
      text: "#ece7dc", "text-dim": "#aaa495", "text-faint": "#7b7568",
      border: "#2a2822", "border-strong": "#3d3a31",
      "user-bubble": "#262420",
    },
  },
  vellum: {
    name: "Vellum", accent: "#8a6a3f", accent2: "#8a6a3f",
    light: {
      bg: "#f4f0e4", surface: "#fbf9f2", "surface-2": "#ebe6d6", "surface-3": "#ded7c3",
      text: "#221f16", "text-dim": "#5d5748", "text-faint": "#918a77",
      border: "#e3ddcb", "border-strong": "#cbc3ab",
      "user-bubble": "#eae4d2",
    },
    dark: {
      bg: "#191710", surface: "#211e16", "surface-2": "#2a261c", "surface-3": "#363126",
      text: "#efe9d9", "text-dim": "#b2aa93", "text-faint": "#7e7765",
      border: "#2c2820", "border-strong": "#403a2d",
      "user-bubble": "#2a261c",
    },
  },
  slate: {
    name: "Slate", accent: "#5b6b73", accent2: "#5b6b73",
    light: {
      bg: "#eceeee", surface: "#f7f8f8", "surface-2": "#e2e5e6", "surface-3": "#d5d9da",
      text: "#191c1d", "text-dim": "#53595b", "text-faint": "#868c8e",
      border: "#dcdfe0", "border-strong": "#c1c6c8",
      "user-bubble": "#e0e4e5",
    },
    dark: {
      bg: "#131617", surface: "#1a1d1e", "surface-2": "#232728", "surface-3": "#2e3334",
      text: "#e6eaeb", "text-dim": "#a3aaac", "text-faint": "#757c7e",
      border: "#262a2b", "border-strong": "#383e3f",
      "user-bubble": "#232728",
    },
  },
  default: {
    name: "Ink", accent: "#4a4a46", accent2: "#4a4a46",
    light: {}, dark: {},
  },
  midnight: {
    name: "Midnight", accent: "#38bdf8", accent2: "#818cf8",
    light: {
      bg: "#eef2f9", surface: "#ffffff", "surface-2": "#e6ecf6", "surface-3": "#d8e1f0",
      text: "#0f172a", "text-dim": "#475569", "text-faint": "#7b8aa3",
      border: "#dbe3ef", "border-strong": "#c2cee1",
    },
    dark: {
      bg: "#070b16", surface: "#0d1424", "surface-2": "#131c30", "surface-3": "#1c273f",
      text: "#e2ecff", "text-dim": "#93a4c4", "text-faint": "#62718e",
      border: "#182338", "border-strong": "#26344f",
    },
  },
  forest: {
    name: "Forest", accent: "#16a34a", accent2: "#0d9488",
    light: {
      bg: "#f1f6f1", surface: "#ffffff", "surface-2": "#e7efe7", "surface-3": "#d8e6d9",
      text: "#12261a", "text-dim": "#4a6353", "text-faint": "#7d9585",
      border: "#dde8de", "border-strong": "#c2d5c5",
    },
    dark: {
      bg: "#080f0b", surface: "#0f1a13", "surface-2": "#16241a", "surface-3": "#1f3124",
      text: "#e4f2e8", "text-dim": "#9bb8a6", "text-faint": "#68836f",
      border: "#1a2a1f", "border-strong": "#28402f",
    },
  },
  rose: {
    name: "Rose", accent: "#e11d48", accent2: "#f43f5e",
    light: {
      bg: "#fdf2f5", surface: "#ffffff", "surface-2": "#f9e6eb", "surface-3": "#f2d5dd",
      text: "#2a0f18", "text-dim": "#6b4451", "text-faint": "#a3808c",
      border: "#f0dbe2", "border-strong": "#e0bcc7",
    },
    dark: {
      bg: "#140609", surface: "#1e0d12", "surface-2": "#2a141a", "surface-3": "#391c24",
      text: "#ffe8ee", "text-dim": "#c79aa7", "text-faint": "#8d6570",
      border: "#2c141b", "border-strong": "#452029",
    },
  },
  terminal: {
    name: "Terminal", accent: "#22c55e", accent2: "#22c55e",
    light: {
      bg: "#e9ece9", surface: "#f6f8f6", "surface-2": "#dfe4df", "surface-3": "#cfd6cf",
      text: "#0b1a0e", "text-dim": "#3e5142", "text-faint": "#6e7f72",
      border: "#d5dcd5", "border-strong": "#b8c2b8",
    },
    dark: {
      bg: "#000000", surface: "#0a0f0b", "surface-2": "#101710", "surface-3": "#18211a",
      text: "#c8f7d0", "text-dim": "#7bbd8a", "text-faint": "#4d7a58",
      border: "#14200f", "border-strong": "#1f3320",
    },
  },
  mono: {
    name: "Mono", accent: "#111827", accent2: "#374151",
    light: {
      bg: "#ffffff", surface: "#ffffff", "surface-2": "#f4f4f5", "surface-3": "#e7e7ea",
      text: "#09090b", "text-dim": "#52525b", "text-faint": "#8b8b93",
      border: "#e5e5e8", "border-strong": "#c9c9cf",
    },
    dark: {
      bg: "#09090b", surface: "#111113", "surface-2": "#18181b", "surface-3": "#242427",
      text: "#fafafa", "text-dim": "#a1a1aa", "text-faint": "#71717a",
      border: "#1f1f23", "border-strong": "#33333a",
    },
  },
};

/* Layout presets: one click sets several geometry knobs at once. */
export const LAYOUT_PRESETS = {
  compact:     { density: 10, fontSize: 14, padY: 7,  padX: 11, width: 42, radius: 8,  lineHeight: 1.45, avatarSize: 24 },
  comfortable: { density: 16, fontSize: 15, padY: 10, padX: 14, width: 46, radius: 14, lineHeight: 1.55, avatarSize: 28 },
  spacious:    { density: 26, fontSize: 16, padY: 14, padX: 18, width: 52, radius: 20, lineHeight: 1.7,  avatarSize: 34 },
};

export const FONT_STACKS = {
  /* Book faces first. All of these ship with macOS/Windows, so nothing is
     fetched over the network (the CSP forbids it anyway). */
  book: '"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Charter,Georgia,serif',
  literary: 'Charter,Georgia,"Bitstream Charter","Sitka Text","Times New Roman",serif',
  transitional: 'Baskerville,"Libre Baskerville","Hoefler Text",Garamond,Georgia,serif',
  system: '"Inter","SF Pro Text",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
  mono: '"JetBrains Mono","SF Mono",ui-monospace,Menlo,monospace',
};

/* Verified against the providers' own model docs on 2 September 2026.
   vision: accepts image input.  thinking: exposes reasoning before the answer. */
export const PROVIDERS = {
  anthropic: {
    label: "Claude",
    base: "https://api.anthropic.com/v1",
    effortLevels: ["low", "medium", "high", "xhigh", "max"],
    models: [
      { id: "claude-opus-5",              name: "Claude Opus 5",     vision: true, thinking: true, note: "complex work" },
      { id: "claude-fable-5-1",           name: "Claude Fable 5.1",  vision: true, thinking: true, note: "deepest reasoning" },
      { id: "claude-sonnet-5",            name: "Claude Sonnet 5",   vision: true, thinking: true, note: "balanced" },
      { id: "claude-haiku-4-5",           name: "Claude Haiku 4.5",  vision: true, thinking: true, note: "fastest" },
      { id: "claude-opus-4-8",            name: "Claude Opus 4.8",   vision: true, thinking: true, note: "legacy" },
      { id: "claude-sonnet-4-6",          name: "Claude Sonnet 4.6", vision: true, thinking: true, note: "legacy" },
    ],
  },
  openai: {
    label: "ChatGPT",
    base: "https://api.openai.com/v1",
    effortLevels: ["none", "low", "medium", "high", "max"],
    models: [
      { id: "gpt-5.6-sol",   name: "GPT-5.6 Sol",   vision: true, thinking: true, note: "flagship" },
      { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", vision: true, thinking: true, note: "balanced" },
      { id: "gpt-5.6-luna",  name: "GPT-5.6 Luna",  vision: true, thinking: true, note: "cost-saving" },
    ],
  },
  deepseek: {
    label: "DeepSeek",
    base: "https://api.deepseek.com/v1",
    effortLevels: [],
    models: [
      { id: "deepseek-v4-pro",   name: "DeepSeek V4 Pro",   vision: false, thinking: true, note: "thinking by default" },
      { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", vision: false, thinking: true, note: "fast and cheap" },
    ],
  },
};

export const modelInfo = (providerId, modelId) =>
  PROVIDERS[providerId]?.models.find((m) => m.id === modelId) || null;

export const supportsImages = (providerId, modelId) =>
  Boolean(modelInfo(providerId, modelId)?.vision);

export const supportsThinking = (providerId, modelId) =>
  Boolean(modelInfo(providerId, modelId)?.thinking);

export const DEFAULT_PROMPTS = [
  { id: "p1", name: "Explain simply", tag: "learn", body: "Explain {{topic}} as if I have no background in it, then again at exam level. Note where the simple version breaks down." },
  { id: "p2", name: "Make me a study plan", tag: "plan", body: "I have {{days}} days until my {{subject}} exam and I'm weak on {{weak_areas}}. Build me a day-by-day plan with what to do each day." },
  { id: "p3", name: "Quiz me", tag: "drill", body: "Ask me 10 questions on {{topic}}, one at a time. Wait for my answer before the next one. Mark each out of 5." },
  { id: "p4", name: "Find the flaw", tag: "review", body: "Here is my argument:\n\n{{argument}}\n\nAttack it the way a hostile examiner would. List the three weakest points in order." },
];

export const DEFAULT_CONNECTIONS = [
  {
    id: "conn-default", label: "My endpoint", provider: "anthropic",
    baseUrl: "", model: "claude-sonnet-5", apiKey: "", headers: [],
  },
];

/* Fixed identity. Deliberately not part of `state`: it is never persisted,
   never exported, and cannot be reached by an imported config or by editing
   localStorage by hand. The same goes for the typeface below. */
export const BRAND = Object.freeze({
  name: "Cram",
  logo: "🎓",
  tagline: "demo mode",
  welcomeTitle: "What are we working on?",
  welcomeSubtitle: "Ask anything. Attach an image if the model supports it.",
  sendLabel: "Send ↵",
  placeholder: "Ask anything. Type / for saved prompts.",
});

export const UI_FONT = FONT_STACKS.book;
export const CODE_FONT = FONT_STACKS.mono;

export const DEFAULTS = {
  version: 5,

  ui: {
    theme: "system",
    preset: "book",
    accent: "#c15f3c",
    accent2: "#c15f3c",
    gradient: false,
    palettes: { light: {}, dark: {} },   // per-mode manual colour overrides

    fontSize: 16,
    lineHeight: 1.68,
    letterSpacing: 0,
    boldWeight: 600,

    layoutPreset: "comfortable",
    density: 22,
    padY: 10,
    padX: 15,
    width: 42,
    radius: 5,
    borderW: 1,
    shadow: 0.3,
    avatarSize: 26,
    sidebarWidth: 272,
    sidebarSide: "left",

    bubbles: "plain",
    align: "left",
    avatars: "initials",
    pattern: "none",
    animations: true,
    speed: 0.2,

    sidebar: "shown",
    customCss: "",
  },

  behavior: {
    enterSends: true,
    timestamps: false,
    autoScroll: true,
    showActions: true,
    wordCount: false,
    autoTitle: true,
    confirmDelete: true,
    streamCursor: true,
    demoSpeed: 9,
  },

  connections: DEFAULT_CONNECTIONS,
  activeConnectionId: "conn-default",

  model: {
    serverProvider: "anthropic",   // which stored key to relay through
    model: "claude-opus-5",
    effort: "high",                // reasoning depth where the provider supports it
    showThinking: true,
    system:
      "You are Cram, a study assistant. Be accurate and concise. Say when you are unsure rather than guessing. " +
      "Use fenced code blocks with a language tag whenever you show code.",
    temperature: 0.7,
    topP: 1,
    maxTokens: 2048,
    historyTurns: 20,
    stop: "",
    stream: true,
    live: false,
  },

  prompts: DEFAULT_PROMPTS,
  chats: [],
  activeChatId: null,
};

/* Keys that would reassign an object's prototype or constructor rather than
   setting a normal property. Imported config is untrusted, so they're dropped. */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/* deep-merge saved state over defaults so new keys land on old installs */
function merge(base, saved, depth = 0) {
  if (depth > 12) return base;                       // no unbounded recursion
  if (Array.isArray(base) || saved === null || typeof saved !== "object") {
    return saved === undefined ? base : saved;
  }
  const out = { ...base };
  for (const k of Object.keys(saved)) {
    if (UNSAFE_KEYS.has(k)) continue;
    if (!Object.prototype.hasOwnProperty.call(saved, k)) continue;
    out[k] = Object.prototype.hasOwnProperty.call(base, k)
      ? merge(base[k], saved[k], depth + 1)
      : saved[k];
  }
  return out;
}

/* the app was called StudentPilot before; carry those settings over once */
const LEGACY_KEYS = ["studentpilot.v1", STORAGE_KEY];

/* When the server reports a signed-in account, settings and chats are kept
   under a per-account key. Two people sharing a browser then keep separate
   workspaces instead of overwriting each other. Served statically there is no
   account, and everything lives under the plain key as before. */
let activeKey = STORAGE_KEY;

export function load(key = activeKey) {
  try {
    let raw = localStorage.getItem(key);
    if (!raw) {
      // first run for this account: adopt anything left by an earlier install
      for (const legacy of LEGACY_KEYS) {
        if (legacy === key) continue;
        const found = localStorage.getItem(legacy);
        if (found) {
          localStorage.setItem(key, found);
          localStorage.removeItem(legacy);
          raw = found;
          break;
        }
      }
    }
    if (!raw) return structuredClone(DEFAULTS);

    const saved = JSON.parse(raw);
    const merged = merge(structuredClone(DEFAULTS), saved);

    /* The look was redesigned in v3. Appearance settings saved under the old
       palette would otherwise pin an install to the previous theme forever, so
       they are reset once. Chats, pilots, prompts and branding are untouched. */
    if ((Number(saved.version) || 0) < 3) {
      merged.ui = { ...structuredClone(DEFAULTS.ui), sidebar: merged.ui?.sidebar ?? "shown" };
    }
    /* v4 removed the persona "pilots". Strip the leftover keys so they cannot
       reappear through the merge, and drop the per-chat pilot reference. */
    if ((Number(saved.version) || 0) < 4) {
      delete merged.pilots;
      delete merged.activePilotId;
      delete merged.behavior?.defaultPilot;
      for (const chat of merged.chats ?? []) delete chat.pilotId;
    }
    /* v5 made the name, logo and typeface fixed. Anything an older install or
       an imported file carried for those is discarded on load. */
    delete merged.brand;
    delete merged.ui?.font;
    delete merged.ui?.fontCustom;
    delete merged.ui?.fontMono;
    merged.version = DEFAULTS.version;
    return merged;
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export const state = load();

/** The localStorage key currently in use. */
export const storageKey = () => activeKey;

/** Re-point the store at a specific account, then reload it in place. */
export function useAccount(accountId) {
  activeKey = accountId ? `${STORAGE_KEY}:${accountId}` : STORAGE_KEY;
  const loaded = load(activeKey);
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, loaded);
}

let saveTimer = null;
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(activeKey, JSON.stringify(state));
    } catch (err) {
      console.warn("Cram: could not save state", err);
    }
  }, 120);
}

export function replaceState(next) {
  const merged = merge(structuredClone(DEFAULTS), next);
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, merged);
  save();
}

export function resetState() {
  replaceState(structuredClone(DEFAULTS));
}

export const uid = () => Math.random().toString(36).slice(2, 10);

/* ---- selectors ---------------------------------------------------------- */

export function activeChat() {
  return state.chats.find((c) => c.id === state.activeChatId) || null;
}

export function activeConnection() {
  return state.connections.find((c) => c.id === state.activeConnectionId) || state.connections[0];
}

export function newChat() {
  const chat = {
    id: uid(),
    title: "New chat",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
  state.chats.unshift(chat);
  state.activeChatId = chat.id;
  save();
  return chat;
}

export function deleteChat(id) {
  const i = state.chats.findIndex((c) => c.id === id);
  if (i === -1) return;
  state.chats.splice(i, 1);
  if (state.activeChatId === id) state.activeChatId = state.chats[0]?.id ?? null;
  save();
}

export function titleFrom(text) {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 42 ? t.slice(0, 42) + "…" : t || "New chat";
}

export function move(arr, from, to) {
  if (to < 0 || to >= arr.length) return;
  arr.splice(to, 0, ...arr.splice(from, 1));
}

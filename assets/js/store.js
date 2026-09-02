/* ==========================================================================
   store.js — defaults, persistence, and the single mutable app state.
   Everything lives in localStorage under one key so export/import is trivial.
   ========================================================================== */

export const STORAGE_KEY = "cram.v1";

export const ACCENTS = [
  "#6366f1", "#0ea5e9", "#10b981", "#f59e0b",
  "#ef4444", "#ec4899", "#8b5cf6", "#64748b",
];

/* Theme presets write a whole palette at once. `light`/`dark` keys are merged
   over the stylesheet defaults; anything omitted falls back to the stylesheet. */
export const THEME_PRESETS = {
  default: {
    name: "Default", accent: "#6366f1", accent2: "#8b5cf6",
    light: {}, dark: {},
  },
  paper: {
    name: "Paper", accent: "#b45309", accent2: "#d97706",
    light: {
      bg: "#f5f1e8", surface: "#fffdf7", "surface-2": "#efe9dc", "surface-3": "#e3dbc9",
      text: "#2b2417", "text-dim": "#6b5f4a", "text-faint": "#9a8d75",
      border: "#e2d9c6", "border-strong": "#cdc0a5",
    },
    dark: {
      bg: "#17150f", surface: "#1f1c14", "surface-2": "#282318", "surface-3": "#332d1f",
      text: "#f0e9d8", "text-dim": "#b5a98d", "text-faint": "#7d735e",
      border: "#2f2a1d", "border-strong": "#463e2b",
    },
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
  system: '"Inter","SF Pro Text",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
  serif: 'Georgia,"Iowan Old Style","Times New Roman",serif',
  mono: '"JetBrains Mono","SF Mono",ui-monospace,Menlo,monospace',
  rounded: '"SF Pro Rounded","Nunito",system-ui,sans-serif',
  casual: '"Comic Sans MS","Chalkboard SE",cursive',
};

export const DEFAULT_PILOTS = [
  {
    id: "general", emoji: "🎓", name: "General", accent: "",
    desc: "A straight-talking study partner for anything.",
    system:
      "You are Cram, a study partner for a university student. Be direct and concrete. " +
      "Prefer short paragraphs and worked examples over long preambles. If the student is wrong, say so plainly.",
    greeting: "", model: "", temperature: null, maxTokens: null, starters: [],
  },
  {
    id: "tutor", emoji: "🧠", name: "Socratic tutor", accent: "#8b5cf6",
    desc: "Never hands you the answer — walks you to it.",
    system:
      "You are a Socratic tutor. Never give the final answer outright. Ask one guiding question at a time, " +
      "wait for the student's attempt, and give a hint only after they try. Confirm understanding before moving on.",
    greeting: "What are we trying to understand today? Tell me what you already know about it.",
    model: "", temperature: 0.7, maxTokens: null,
    starters: ["I don't understand recursion", "Walk me through Bayes' theorem"],
  },
  {
    id: "essay", emoji: "✍️", name: "Essay coach", accent: "#0ea5e9",
    desc: "Structure, argument and clarity feedback.",
    system:
      "You are an essay coach. Critique structure, thesis strength, evidence and clarity. Quote the student's own " +
      "sentences when pointing at a problem. Never rewrite the essay for them — show the fix on one sentence and " +
      "let them apply the pattern.",
    greeting: "Paste your draft (or just the thesis) and tell me the prompt you're answering.",
    model: "", temperature: 0.5, maxTokens: null,
    starters: ["Critique my thesis statement", "Is my argument structure sound?"],
  },
  {
    id: "examdrill", emoji: "📝", name: "Exam drill", accent: "#f59e0b",
    desc: "Rapid-fire questions with scoring.",
    system:
      "You run exam drills. Ask one question at a time in the style of the exam the student names. After each answer, " +
      "score it out of 5, explain the deduction in two lines, then immediately ask the next question. Keep a running total.",
    greeting: "Which subject, and what exam format? I'll start firing.",
    model: "", temperature: 0.4, maxTokens: null,
    starters: ["Drill me on organic chemistry", "MCQ practice, 10 questions"],
  },
  {
    id: "code", emoji: "💻", name: "Code mentor", accent: "#10b981",
    desc: "Debugging and code review that explains why.",
    system:
      "You are a code mentor. When shown broken code, identify the root cause before proposing a fix, and say which " +
      "line is wrong and why. Prefer minimal diffs. Point out security-relevant mistakes explicitly.",
    greeting: "", model: "", temperature: 0.3, maxTokens: null,
    starters: ["Review this function", "Why is this throwing?"],
  },
  {
    id: "summarize", emoji: "📚", name: "Reading digest", accent: "#ec4899",
    desc: "Condenses papers and lecture notes.",
    system:
      "You condense academic reading. Output: a 3-sentence core claim, the evidence it rests on, the stated limitations, " +
      "and 3 questions a marker would ask. Flag anything the source asserts without support.",
    greeting: "Paste the text or abstract you want digested.",
    model: "", temperature: 0.3, maxTokens: null, starters: [],
  },
];

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

export const DEFAULTS = {
  version: 2,

  brand: {
    name: "Cram",
    logo: "🎓",
    tagline: "demo mode",
    welcomeTitle: "What are we working on?",
    welcomeSubtitle: "Pick a pilot to start, or just type below.",
    sendLabel: "Send ↵",
    placeholder: "Ask anything… (/ for saved prompts)",
  },

  ui: {
    theme: "system",
    preset: "default",
    accent: "#6366f1",
    accent2: "#8b5cf6",
    gradient: true,
    palettes: { light: {}, dark: {} },   // per-mode manual colour overrides

    font: "system",                      // key into FONT_STACKS, or "custom"
    fontMono: FONT_STACKS.mono,
    fontCustom: "",
    fontSize: 15,
    lineHeight: 1.55,
    letterSpacing: 0,
    boldWeight: 650,

    layoutPreset: "comfortable",
    density: 16,
    padY: 10,
    padX: 14,
    width: 46,
    radius: 14,
    borderW: 1,
    shadow: 1,
    avatarSize: 28,
    sidebarWidth: 272,
    sidebarSide: "left",

    bubbles: "card",
    align: "left",
    avatars: "emoji",
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
    defaultPilot: "general",
  },

  connections: DEFAULT_CONNECTIONS,
  activeConnectionId: "conn-default",

  model: {
    system:
      "You are Cram, a study assistant. Be accurate and concise. Say when you are unsure rather than guessing.",
    temperature: 0.7,
    topP: 1,
    maxTokens: 2048,
    historyTurns: 20,
    stop: "",
    stream: true,
    live: false,
  },

  pilots: DEFAULT_PILOTS,
  prompts: DEFAULT_PROMPTS,
  chats: [],
  activeChatId: null,
  activePilotId: "general",
};

/* deep-merge saved state over defaults so new keys land on old installs */
function merge(base, saved) {
  if (Array.isArray(base) || saved === null || typeof saved !== "object") {
    return saved === undefined ? base : saved;
  }
  const out = { ...base };
  for (const k of Object.keys(saved)) {
    out[k] = k in base ? merge(base[k], saved[k]) : saved[k];
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
    return merge(structuredClone(DEFAULTS), JSON.parse(raw));
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

export function pilotById(id) {
  return state.pilots.find((p) => p.id === id) || state.pilots[0];
}

export function activeConnection() {
  return state.connections.find((c) => c.id === state.activeConnectionId) || state.connections[0];
}

export function newChat(pilotId = state.behavior.defaultPilot || state.activePilotId) {
  const pilot = pilotById(pilotId);
  const chat = {
    id: uid(),
    title: "New chat",
    pilotId: pilot.id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
  if (pilot.greeting) {
    chat.messages.push({ id: uid(), role: "assistant", content: pilot.greeting, at: Date.now() });
  }
  state.chats.unshift(chat);
  state.activeChatId = chat.id;
  state.activePilotId = pilot.id;
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

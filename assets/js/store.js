/* ==========================================================================
   store.js — defaults, persistence, and the single mutable app state.
   Everything lives in localStorage under one key so export/import is trivial.
   ========================================================================== */

export const STORAGE_KEY = "studentpilot.v1";

export const ACCENTS = [
  "#6366f1", "#0ea5e9", "#10b981", "#f59e0b",
  "#ef4444", "#ec4899", "#8b5cf6", "#64748b",
];

export const DEFAULT_PILOTS = [
  {
    id: "general",
    emoji: "🎓",
    name: "General",
    desc: "A straight-talking study partner for anything.",
    system:
      "You are StudentPilot, a study partner for a university student. Be direct and concrete. " +
      "Prefer short paragraphs and worked examples over long preambles. If the student is wrong, say so plainly.",
    greeting: "",
    model: "",
    temperature: null,
  },
  {
    id: "tutor",
    emoji: "🧠",
    name: "Socratic tutor",
    desc: "Never hands you the answer — walks you to it.",
    system:
      "You are a Socratic tutor. Never give the final answer outright. Ask one guiding question at a time, " +
      "wait for the student's attempt, and give a hint only after they try. Confirm understanding before moving on.",
    greeting: "What are we trying to understand today? Tell me what you already know about it.",
    model: "",
    temperature: 0.7,
  },
  {
    id: "essay",
    emoji: "✍️",
    name: "Essay coach",
    desc: "Structure, argument and clarity feedback.",
    system:
      "You are an essay coach. Critique structure, thesis strength, evidence and clarity. Quote the student's own " +
      "sentences when pointing at a problem. Never rewrite the essay for them — show the fix on one sentence and " +
      "let them apply the pattern.",
    greeting: "Paste your draft (or just the thesis) and tell me the prompt you're answering.",
    model: "",
    temperature: 0.5,
  },
  {
    id: "examdrill",
    emoji: "📝",
    name: "Exam drill",
    desc: "Rapid-fire questions with scoring.",
    system:
      "You run exam drills. Ask one question at a time in the style of the exam the student names. After each answer, " +
      "score it out of 5, explain the deduction in two lines, then immediately ask the next question. Keep a running total.",
    greeting: "Which subject, and what exam format? I'll start firing.",
    model: "",
    temperature: 0.4,
  },
  {
    id: "code",
    emoji: "💻",
    name: "Code mentor",
    desc: "Debugging and code review that explains why.",
    system:
      "You are a code mentor. When shown broken code, identify the root cause before proposing a fix, and say which " +
      "line is wrong and why. Prefer minimal diffs. Point out security-relevant mistakes explicitly.",
    greeting: "",
    model: "",
    temperature: 0.3,
  },
  {
    id: "summarize",
    emoji: "📚",
    name: "Reading digest",
    desc: "Condenses papers and lecture notes.",
    system:
      "You condense academic reading. Output: a 3-sentence core claim, the evidence it rests on, the stated limitations, " +
      "and 3 questions a marker would ask. Flag anything the source asserts without support.",
    greeting: "Paste the text or abstract you want digested.",
    model: "",
    temperature: 0.3,
  },
];

export const DEFAULT_PROMPTS = [
  { id: "p1", name: "Explain simply", body: "Explain {{topic}} as if I have no background in it, then again at exam level. Note where the simple version breaks down." },
  { id: "p2", name: "Make me a study plan", body: "I have {{days}} days until my {{subject}} exam and I'm weak on {{weak_areas}}. Build me a day-by-day plan with what to do each day." },
  { id: "p3", name: "Quiz me", body: "Ask me 10 questions on {{topic}}, one at a time. Wait for my answer before the next one. Mark each out of 5." },
  { id: "p4", name: "Find the flaw", body: "Here is my argument:\n\n{{argument}}\n\nAttack it the way a hostile examiner would. List the three weakest points in order." },
];

export const DEFAULTS = {
  version: 1,
  ui: {
    theme: "system",
    accent: ACCENTS[0],
    font: '"Inter","SF Pro Text",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    fontSize: 15,
    density: 16,
    width: 46,
    radius: 14,
    bubbles: "card",
    enterSends: true,
    timestamps: false,
    sidebar: "shown",
  },
  model: {
    provider: "anthropic",
    baseUrl: "",
    model: "claude-sonnet-5",
    apiKey: "",
    system:
      "You are StudentPilot, a study assistant. Be accurate and concise. Say when you are unsure rather than guessing.",
    temperature: 0.7,
    topP: 1,
    maxTokens: 2048,
    historyTurns: 20,
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

export function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULTS);
    return merge(structuredClone(DEFAULTS), JSON.parse(raw));
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export const state = load();

let saveTimer = null;
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn("StudentPilot: could not save state", err);
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

/* ---- chat helpers ------------------------------------------------------- */

export function activeChat() {
  return state.chats.find((c) => c.id === state.activeChatId) || null;
}

export function pilotById(id) {
  return state.pilots.find((p) => p.id === id) || state.pilots[0];
}

export function newChat(pilotId = state.activePilotId) {
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
    chat.messages.push({
      id: uid(),
      role: "assistant",
      content: pilot.greeting,
      at: Date.now(),
    });
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
  if (state.activeChatId === id) {
    state.activeChatId = state.chats[0]?.id ?? null;
  }
  save();
}

export function titleFrom(text) {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 42 ? t.slice(0, 42) + "…" : t || "New chat";
}

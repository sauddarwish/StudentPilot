/* ==========================================================================
   api.js — the only file that talks to a model.
   Nothing else in the app knows what a provider is; swap this out and the
   rest of Cram keeps working.

   Public surface:
     streamReply({ system, messages, cfg, signal, pilotName }) -> async gen
   where cfg merges the active connection (provider/baseUrl/model/key/headers)
   with the generation settings (temperature, maxTokens, stop, …).
   ========================================================================== */

/* ---- demo mode ---------------------------------------------------------- */

const DEMO_OPENERS = [
  "Here's how I'd approach that.",
  "Good question — let's break it down.",
  "Short answer first, then the reasoning.",
];

function demoReply(userText, pilotName) {
  const topic = userText.trim().replace(/\s+/g, " ").slice(0, 90) || "that";
  const opener = DEMO_OPENERS[topic.length % DEMO_OPENERS.length];

  return `${opener}

**You asked:** ${topic}

This is a **demo response** — Cram's frontend is fully wired, but no model is connected yet, so I'm echoing a stub instead of thinking.

To make this real:

1. Open **Settings → Model**
2. Pick a connection, set its **Base URL** and **Model ID**
3. Turn on **Live mode**

Everything else already works — the *${pilotName}* pilot's system prompt, your temperature and token settings, and the last few turns of this chat are all being assembled into a proper request. Only the network call is stubbed.

\`\`\`js
// assets/js/api.js — this is the request that would go out
{ model: "…", system: "…", messages: [...], stream: true }
\`\`\`

> Everything you can see is adjustable: try **Theme** for a full palette swap, **Layout** for density and shape, or **Advanced** to drop in your own CSS.`;
}

const sleep = (ms, signal) =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });

async function* demoStream(userText, pilotName, signal, speed = 9) {
  const text = demoReply(userText, pilotName);
  const chunks = text.match(/\S+\s*/g) ?? [text];
  await sleep(Math.min(280, speed * 24), signal);
  for (const chunk of chunks) {
    if (signal?.aborted) return;
    yield chunk;
    if (speed > 0) await sleep(speed + (chunk.length % 5) * 4, signal);
  }
}

/* ---- request builders --------------------------------------------------- */

const DEFAULT_BASE = {
  anthropic: "https://api.anthropic.com/v1",
  openai: "https://api.openai.com/v1",
  custom: "",
};

function extraHeaders(cfg) {
  const out = {};
  for (const h of cfg.headers ?? []) {
    if (h?.key?.trim()) out[h.key.trim().toLowerCase()] = h.value ?? "";
  }
  return out;
}

function stopList(cfg) {
  return String(cfg.stop || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildRequest({ system, messages, cfg }) {
  const base = (cfg.baseUrl || DEFAULT_BASE[cfg.provider] || "").replace(/\/+$/, "");
  const headers = { "content-type": "application/json" };
  const stop = stopList(cfg);

  if (cfg.provider === "anthropic") {
    if (cfg.apiKey) {
      headers["x-api-key"] = cfg.apiKey;
      headers["anthropic-version"] = "2023-06-01";
      // required by the API when calling straight from a browser
      headers["anthropic-dangerous-direct-browser-access"] = "true";
    }
    return {
      url: `${base}/messages`,
      headers: { ...headers, ...extraHeaders(cfg) },
      body: {
        model: cfg.model,
        system,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        max_tokens: cfg.maxTokens,
        temperature: cfg.temperature,
        top_p: cfg.topP,
        stream: cfg.stream,
        ...(stop.length ? { stop_sequences: stop } : {}),
      },
    };
  }

  // openai-compatible (also the sane shape for most self-hosted proxies)
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
  return {
    url: `${base}/chat/completions`,
    headers: { ...headers, ...extraHeaders(cfg) },
    body: {
      model: cfg.model,
      messages: [
        { role: "system", content: system },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      max_tokens: cfg.maxTokens,
      temperature: cfg.temperature,
      top_p: cfg.topP,
      stream: cfg.stream,
      ...(stop.length ? { stop } : {}),
    },
  };
}

/* ---- SSE plumbing ------------------------------------------------------- */

async function* sseEvents(response, signal) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let split;
      while ((split = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const data = raw
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("");
        if (!data || data === "[DONE]") continue;
        try { yield JSON.parse(data); } catch { /* keep-alive or partial frame */ }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

function textFromEvent(event, provider) {
  if (provider === "anthropic") {
    return event.type === "content_block_delta" ? event.delta?.text ?? "" : "";
  }
  return event.choices?.[0]?.delta?.content ?? "";
}

function textFromWhole(json, provider) {
  if (provider === "anthropic") {
    return (json.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
  }
  return json.choices?.[0]?.message?.content ?? "";
}

/* ---- public ------------------------------------------------------------- */

export async function* streamReply({ system, messages, cfg, signal, pilotName = "General" }) {
  if (!cfg.live) {
    const last = [...messages].reverse().find((m) => m.role === "user");
    yield* demoStream(last?.content ?? "", pilotName, signal, cfg.demoSpeed);
    return;
  }

  const { url, headers, body } = buildRequest({ system, messages, cfg });
  if (!url || !/^https?:/.test(url)) {
    throw new Error("Live mode is on but this connection has no valid Base URL (Settings → Model).");
  }

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${detail ? ` — ${detail.slice(0, 300)}` : ""}`);
  }

  if (!cfg.stream || !res.body) {
    yield textFromWhole(await res.json(), cfg.provider);
    return;
  }

  for await (const event of sseEvents(res, signal)) {
    const chunk = textFromEvent(event, cfg.provider);
    if (chunk) yield chunk;
  }
}

/* Used by the "Test connection" button in settings. */
export async function testConnection(cfg) {
  const { url, headers, body } = buildRequest({
    system: "reply with the single word: ok",
    messages: [{ role: "user", content: "ping" }],
    cfg: { ...cfg, stream: false, maxTokens: 16 },
  });
  if (!url || !/^https?:/.test(url)) throw new Error("No valid Base URL set.");

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const text = textFromWhole(await res.json(), cfg.provider);
  return text.trim().slice(0, 60) || "(empty reply)";
}

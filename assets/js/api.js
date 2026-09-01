/* ==========================================================================
   api.js — the only file that talks to a model.
   Nothing else in the app knows what a provider is; swap this out and the
   rest of StudentPilot keeps working.

   Public surface:
     streamReply({ system, messages, cfg, signal }) -> async generator of text
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

This is a **demo response** — StudentPilot's frontend is fully wired, but no model is connected yet, so I'm echoing a stub instead of thinking.

To make this real:

1. Open **Settings → Model**
2. Set a **Base URL** (your own endpoint or proxy) and a **Model ID**
3. Turn on **Live mode**

Everything else already works — the *${pilotName}* pilot's system prompt, your temperature and token settings, and the last few turns of this chat are all being assembled into a proper request. Only the network call is stubbed.

\`\`\`js
// assets/js/api.js — this is the request that would go out
{ model: "…", system: "…", messages: [...], stream: true }
\`\`\`

> Try the pilots in the sidebar, save a prompt under Settings → Prompts, or restyle the whole thing under Appearance.`;
}

async function* demoStream(userText, pilotName, signal) {
  const text = demoReply(userText, pilotName);
  const chunks = text.match(/\S+\s*/g) ?? [text];
  await sleep(280, signal);
  for (const chunk of chunks) {
    if (signal?.aborted) return;
    yield chunk;
    await sleep(9 + (chunk.length % 5) * 4, signal);
  }
}

const sleep = (ms, signal) =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });

/* ---- request builders --------------------------------------------------- */

const DEFAULT_BASE = {
  anthropic: "https://api.anthropic.com/v1",
  openai: "https://api.openai.com/v1",
  custom: "",
};

function buildRequest({ system, messages, cfg }) {
  const base = (cfg.baseUrl || DEFAULT_BASE[cfg.provider] || "").replace(/\/+$/, "");
  const headers = { "content-type": "application/json" };

  if (cfg.provider === "anthropic") {
    if (cfg.apiKey) {
      headers["x-api-key"] = cfg.apiKey;
      headers["anthropic-version"] = "2023-06-01";
      // required by the API when calling straight from a browser
      headers["anthropic-dangerous-direct-browser-access"] = "true";
    }
    return {
      url: `${base}/messages`,
      headers,
      body: {
        model: cfg.model,
        system,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        max_tokens: cfg.maxTokens,
        temperature: cfg.temperature,
        top_p: cfg.topP,
        stream: cfg.stream,
      },
    };
  }

  // openai-compatible (also the sane shape for most self-hosted proxies)
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
  return {
    url: `${base}/chat/completions`,
    headers,
    body: {
      model: cfg.model,
      messages: [{ role: "system", content: system }, ...messages.map((m) => ({ role: m.role, content: m.content }))],
      max_tokens: cfg.maxTokens,
      temperature: cfg.temperature,
      top_p: cfg.topP,
      stream: cfg.stream,
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
    if (event.type === "content_block_delta") return event.delta?.text ?? "";
    return "";
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
    yield* demoStream(last?.content ?? "", pilotName, signal);
    return;
  }

  const { url, headers, body } = buildRequest({ system, messages, cfg });
  if (!url || !/^https?:/.test(url)) {
    throw new Error("Live mode is on but no valid Base URL is set (Settings → Model).");
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

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

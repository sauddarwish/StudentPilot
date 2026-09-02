/* ==========================================================================
   api.js is the only file that talks to a model. Nothing else in the app
   knows what a provider is; swap this out and the rest of Cram keeps working.

   On a hosted deployment cfg.baseUrl points at Cram's own /api/v1 and
   cfg.apiKey is empty: the server holds the key and makes the provider call.
   In the standalone static build it points straight at the provider.

   Public surface:
     streamReply({ system, messages, cfg, signal }) -> async generator of
       { type: "thinking" | "text", text }
     testConnection(cfg) -> string

   `messages` is the whole conversation so far, each entry:
     { role: "user" | "assistant", content: string, images?: [{ mediaType, data }] }
   ========================================================================== */

/* ---- demo mode ----------------------------------------------------------
   Deliberately conversational: it counts the turns and refers back to what
   was said, so the transcript behaves like a conversation and not like a
   single canned reply repeated forever.
   ------------------------------------------------------------------------- */

function demoReply(messages) {
  const userTurns = messages.filter((m) => m.role === "user");
  const latest = userTurns.at(-1);
  const question = (latest?.content || "").trim().replace(/\s+/g, " ").slice(0, 120) || "that";
  const turn = userTurns.length;
  const imageCount = userTurns.reduce((n, m) => n + (m.images?.length || 0), 0);

  if (turn === 1) {
    return `You asked: **${question}**

I am a **demo reply**, not a model. The whole app is wired up: this conversation is
being assembled into a real request with your system prompt, your settings and every
previous turn attached. Only the network call is stubbed out.

Add an API key under **Settings → Account** and Cram will relay to the provider you
picked. Until then, keep typing and I will keep track of the conversation so you can
see that multi-turn actually works.`;
  }

  const earlier = userTurns.slice(0, -1).map((m, i) =>
    `${i + 1}. ${(m.content || "").trim().replace(/\s+/g, " ").slice(0, 60)}`).join("\n");

  return `That is **turn ${turn}** of this conversation, and I still have the earlier ones:

${earlier}

Your latest: **${question}**${imageCount ? `\n\nYou have attached ${imageCount} image${imageCount === 1 ? "" : "s"} so far. A real model would be looking at ${imageCount === 1 ? "it" : "them"} here.` : ""}

Every one of those turns goes out with the next request, which is what makes this a
conversation rather than a series of unrelated questions.

\`\`\`js
// what the request body looks like right now
{
  model: "...",
  messages: ${JSON.stringify(userTurns.length)} user turns + ${messages.length - userTurns.length} assistant turns,
  stream: true
}
\`\`\``;
}

const sleep = (ms, signal) =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });

async function* demoStream(messages, signal, speed = 9, withThinking = true) {
  if (withThinking) {
    const musing = "Reading the conversation so far, checking what was already covered, then answering the latest turn.";
    await sleep(Math.min(200, speed * 18), signal);
    for (const word of musing.match(/\S+\s*/g) ?? []) {
      if (signal?.aborted) return;
      yield { type: "thinking", text: word };
      if (speed > 0) await sleep(speed, signal);
    }
  }

  const text = demoReply(messages);
  await sleep(Math.min(240, speed * 20), signal);
  for (const chunk of text.match(/\S+\s*/g) ?? [text]) {
    if (signal?.aborted) return;
    yield { type: "text", text: chunk };
    if (speed > 0) await sleep(speed + (chunk.length % 5) * 4, signal);
  }
}

/* ---- request builders --------------------------------------------------- */

const DEFAULT_BASE = {
  anthropic: "https://api.anthropic.com/v1",
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  custom: "",
};

/* DeepSeek and any other OpenAI-compatible endpoint share one request shape. */
const isAnthropic = (provider) => provider === "anthropic";

function extraHeaders(cfg) {
  const out = {};
  for (const h of cfg.headers ?? []) {
    if (h?.key?.trim()) out[h.key.trim().toLowerCase()] = h.value ?? "";
  }
  return out;
}

function stopList(cfg) {
  return String(cfg.stop || "").split(",").map((s) => s.trim()).filter(Boolean);
}

/* Anthropic wants base64 in a source object; OpenAI wants a data: URL. */
function anthropicContent(message, allowImages) {
  const blocks = [];
  if (allowImages) {
    for (const img of message.images ?? []) {
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: img.mediaType, data: img.data },
      });
    }
  }
  if (message.content) blocks.push({ type: "text", text: message.content });
  return blocks.length ? blocks : [{ type: "text", text: "" }];
}

function openaiContent(message, allowImages) {
  const hasImages = allowImages && (message.images?.length ?? 0) > 0;
  if (!hasImages) return message.content ?? "";

  const parts = message.images.map((img) => ({
    type: "image_url",
    image_url: { url: `data:${img.mediaType};base64,${img.data}` },
  }));
  if (message.content) parts.push({ type: "text", text: message.content });
  return parts;
}

export function buildRequest({ system, messages, cfg }) {
  const base = (cfg.baseUrl || DEFAULT_BASE[cfg.provider] || "").replace(/\/+$/, "");
  const headers = { "content-type": "application/json" };
  const stop = stopList(cfg);
  const allowImages = cfg.vision !== false;

  if (isAnthropic(cfg.provider)) {
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
        messages: messages.map((m) => ({ role: m.role, content: anthropicContent(m, allowImages) })),
        max_tokens: cfg.maxTokens,
        temperature: cfg.temperature,
        top_p: cfg.topP,
        stream: cfg.stream,
        // current Claude models think adaptively; effort is how you steer it
        ...(cfg.effort ? { output_config: { effort: cfg.effort } } : {}),
        // Cram's own flag: the relay strips it and runs the search loop itself
        ...(cfg.web ? { cram_web: true } : {}),
        ...(stop.length ? { stop_sequences: stop } : {}),
      },
    };
  }

  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
  return {
    url: `${base}/chat/completions`,
    headers: { ...headers, ...extraHeaders(cfg) },
    body: {
      model: cfg.model,
      messages: [
        { role: "system", content: system },
        ...messages.map((m) => ({ role: m.role, content: openaiContent(m, allowImages) })),
      ],
      max_tokens: cfg.maxTokens,
      temperature: cfg.temperature,
      top_p: cfg.topP,
      stream: cfg.stream,
      // OpenAI reasoning models take an effort level; DeepSeek ignores it
      ...(cfg.provider === "openai" && cfg.effort ? { reasoning_effort: cfg.effort } : {}),
      ...(cfg.web ? { cram_web: true } : {}),
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

/** Normalises one provider event into { type, text } or null. */
function partFromEvent(event, provider) {
  if (isAnthropic(provider)) {
    if (event.type !== "content_block_delta") return null;
    const delta = event.delta ?? {};
    if (delta.type === "thinking_delta") return { type: "thinking", text: delta.thinking ?? "" };
    if (delta.type === "text_delta") return { type: "text", text: delta.text ?? "" };
    return null;
  }

  const delta = event.choices?.[0]?.delta ?? {};
  // DeepSeek streams its chain of thought in reasoning_content
  if (delta.reasoning_content) return { type: "thinking", text: delta.reasoning_content };
  if (delta.reasoning) return { type: "thinking", text: delta.reasoning };
  if (delta.content) return { type: "text", text: delta.content };
  return null;
}

function partsFromWhole(json, provider) {
  if (isAnthropic(provider)) {
    const out = [];
    for (const block of json.content ?? []) {
      if (block.type === "thinking") out.push({ type: "thinking", text: block.thinking ?? "" });
      if (block.type === "text") out.push({ type: "text", text: block.text ?? "" });
    }
    return out;
  }
  const message = json.choices?.[0]?.message ?? {};
  const out = [];
  if (message.reasoning_content) out.push({ type: "thinking", text: message.reasoning_content });
  if (message.content) out.push({ type: "text", text: message.content });
  return out;
}

/* ---- public ------------------------------------------------------------- */

export async function* streamReply({ system, messages, cfg, signal }) {
  if (!cfg.live) {
    yield* demoStream(messages, signal, cfg.demoSpeed, cfg.showThinking !== false);
    return;
  }

  /* A tool loop cannot stream partial answers, so the relay collects the whole
     reply and re-streams it. Asking for stream:true is still correct: the relay
     emits provider-shaped SSE either way. */

  const { url, headers, body } = buildRequest({ system, messages, cfg });
  if (!url || !/^https?:/.test(url)) {
    throw new Error("No endpoint is configured for this connection (Settings → Model).");
  }

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }

  if (!cfg.stream || !res.body) {
    for (const part of partsFromWhole(await res.json(), cfg.provider)) yield part;
    return;
  }

  for await (const event of sseEvents(res, signal)) {
    const part = partFromEvent(event, cfg.provider);
    if (part && part.text) yield part;
  }
}

/* Used by the "Test connection" button in settings. */
export async function testConnection(cfg) {
  const { url, headers, body } = buildRequest({
    system: "reply with the single word: ok",
    messages: [{ role: "user", content: "ping" }],
    cfg: { ...cfg, stream: false, maxTokens: 16, effort: "" },
  });
  if (!url || !/^https?:/.test(url)) throw new Error("No valid Base URL set.");

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const parts = partsFromWhole(await res.json(), cfg.provider);
  const text = parts.filter((p) => p.type === "text").map((p) => p.text).join("");
  return text.trim().slice(0, 60) || "(empty reply)";
}

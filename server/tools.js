/* ==========================================================================
   tools.js runs the search-and-read loop on the model's behalf.

   The two providers disagree about shape but not about substance, so the tool
   definitions and the transcript surgery are written twice and the executor
   once. Anthropic uses content blocks; OpenAI and DeepSeek use tool_calls.

   Yields step objects as it goes so the caller can show progress:
     { type: "step", text }   a tool ran
     { type: "thinking", text }
     { type: "text", text }   the final answer
   ========================================================================== */

import { webSearch, fetchPage } from "./web.js";

const MAX_ROUNDS = 5;          // tool round trips before we insist on an answer
const MAX_CALLS_PER_ROUND = 4;

const SEARCH_DESC =
  "Search the web and return titles, URLs and snippets. Use this to find pages, " +
  "then read the promising ones with fetch_url before answering.";
const FETCH_DESC =
  "Fetch a web page and return its readable text. Use it on URLs from search " +
  "results, or on a URL the user gave you.";

export const ANTHROPIC_TOOLS = [
  {
    name: "web_search",
    description: SEARCH_DESC,
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "What to search for." } },
      required: ["query"],
    },
  },
  {
    name: "fetch_url",
    description: FETCH_DESC,
    input_schema: {
      type: "object",
      properties: { url: { type: "string", description: "The absolute http(s) URL to read." } },
      required: ["url"],
    },
  },
];

export const OPENAI_TOOLS = ANTHROPIC_TOOLS.map((t) => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: t.input_schema },
}));

/* ---- executor ----------------------------------------------------------- */

async function runTool(name, args) {
  if (name === "web_search") {
    const { backend, results } = await webSearch(args?.query);
    const caveat = backend === "wikipedia"
      ? "\n\n(This server has no general search backend configured, so these are " +
        "Wikipedia results only. For anything else, call fetch_url on a URL you know.)"
      : "";
    return {
      label: `searched ${backend} for "${String(args?.query).slice(0, 50)}", ${results.length} results`,
      content: results
        .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
        .join("\n\n") + caveat,
    };
  }
  if (name === "fetch_url") {
    const page = await fetchPage(args?.url);
    const words = page.text.split(/\s+/).length;
    return {
      label: `read ${new URL(page.url).hostname}, ${words} words${page.truncated ? ", truncated" : ""}`,
      content: `# ${page.title}\nSource: ${page.url}\n\n${page.text}`,
    };
  }
  throw new Error(`Unknown tool ${name}`);
}

async function settle(calls) {
  return Promise.all(calls.slice(0, MAX_CALLS_PER_ROUND).map(async (call) => {
    try {
      const out = await runTool(call.name, call.args);
      return { ...call, ok: true, ...out };
    } catch (err) {
      return { ...call, ok: false, label: `${call.name} failed: ${err.message}`, content: `Error: ${err.message}` };
    }
  }));
}

/* ---- provider dialects -------------------------------------------------- */

const isAnthropic = (provider) => provider === "anthropic";

function readCalls(json, provider) {
  if (isAnthropic(provider)) {
    return (json.content ?? [])
      .filter((b) => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, args: b.input ?? {} }));
  }
  return (json.choices?.[0]?.message?.tool_calls ?? []).map((c) => {
    let args = {};
    try { args = JSON.parse(c.function?.arguments || "{}"); } catch { /* model sent junk */ }
    return { id: c.id, name: c.function?.name, args };
  });
}

function readText(json, provider) {
  if (isAnthropic(provider)) {
    const out = { thinking: "", text: "" };
    for (const block of json.content ?? []) {
      if (block.type === "thinking") out.thinking += block.thinking ?? "";
      if (block.type === "text") out.text += block.text ?? "";
    }
    return out;
  }
  const m = json.choices?.[0]?.message ?? {};
  return { thinking: m.reasoning_content || "", text: m.content || "" };
}

/** Append the assistant turn and the tool results, in the provider's shape. */
function extendTranscript(messages, json, results, provider) {
  if (isAnthropic(provider)) {
    messages.push({ role: "assistant", content: json.content });
    messages.push({
      role: "user",
      content: results.map((r) => ({
        type: "tool_result",
        tool_use_id: r.id,
        content: r.content,
        ...(r.ok ? {} : { is_error: true }),
      })),
    });
    return;
  }
  messages.push(json.choices[0].message);
  for (const r of results) {
    messages.push({ role: "tool", tool_call_id: r.id, content: r.content });
  }
}

/* ---- the loop ----------------------------------------------------------- */

/**
 * @param post  async (body) => parsed JSON from the provider
 * @param body  the request body, already provider-shaped, non-streaming
 */
export async function* runToolLoop({ post, body, provider }) {
  const working = { ...body, stream: false };
  working.messages = [...body.messages];

  if (isAnthropic(provider)) working.tools = ANTHROPIC_TOOLS;
  else working.tools = OPENAI_TOOLS;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const json = await post(working);
    const calls = readCalls(json, provider);

    if (!calls.length) {
      const { thinking, text } = readText(json, provider);
      if (thinking) yield { type: "thinking", text: thinking };
      yield { type: "text", text };
      return;
    }

    for (const call of calls.slice(0, MAX_CALLS_PER_ROUND)) {
      const detail = call.name === "web_search"
        ? String(call.args?.query ?? "").slice(0, 70)
        : String(call.args?.url ?? "").slice(0, 90);
      yield { type: "step", text: `${call.name === "web_search" ? "Searching" : "Reading"}: ${detail}` };
    }

    const results = await settle(calls);
    for (const r of results) yield { type: "step", text: `  ${r.label}` };

    extendTranscript(working.messages, json, results, provider);

    /* Last round: take the tools away so the model has to answer. */
    if (round === MAX_ROUNDS - 1) delete working.tools;
  }

  const json = await post(working);
  const { thinking, text } = readText(json, provider);
  if (thinking) yield { type: "thinking", text: thinking };
  yield { type: "text", text: text || "I ran out of research steps before reaching an answer." };
}

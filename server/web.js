/* ==========================================================================
   web.js gives the models a way to search and to read pages.

   The server does this, not the browser: the page is pinned by CSP to its own
   origin and would hit CORS on every site anyway.

   Because this fetches URLs a model chose, it is a server-side request forgery
   risk by construction. Every hop is therefore re-checked: scheme, port, and
   the resolved IP of the host, including after each redirect.
   ========================================================================== */

import dns from "node:dns/promises";
import net from "node:net";

const USER_AGENT = "CramBot/1.0 (+https://cram.averon.club)";
const FETCH_TIMEOUT_MS = 12_000;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_CHARS = 12_000;
const MAX_REDIRECTS = 3;

/* ---- SSRF guard --------------------------------------------------------- */

/** Ranges that must never be reachable from a model-chosen URL. */
function isBlockedIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;          // this host, private, loopback
    if (a === 169 && b === 254) return true;                     // link-local, cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;            // private
    if (a === 192 && b === 168) return true;                     // private
    if (a === 100 && b >= 64 && b <= 127) return true;           // carrier grade NAT
    if (a >= 224) return true;                                   // multicast and reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return true;
    if (v.startsWith("fe80") || v.startsWith("fc") || v.startsWith("fd")) return true;
    if (v.startsWith("::ffff:")) return isBlockedIp(v.slice(7));  // v4-mapped
    return false;
  }
  return true;
}

/** @returns {Promise<URL>} the parsed URL, or throws with a readable reason */
async function assertPublicUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error("That is not a valid URL."); }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs can be fetched.");
  }
  if (url.port && !["80", "443", ""].includes(url.port)) {
    throw new Error("Only the standard web ports can be fetched.");
  }

  let addresses;
  try {
    addresses = await dns.lookup(url.hostname, { all: true });
  } catch {
    throw new Error(`Could not resolve ${url.hostname}.`);
  }
  if (!addresses.length || addresses.some((a) => isBlockedIp(a.address))) {
    throw new Error(`${url.hostname} resolves to a non-public address.`);
  }
  return url;
}

/* Follows redirects by hand so every hop is re-validated. */
async function safeFetch(rawUrl, { accept }) {
  let current = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicUrl(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let res;
    try {
      res = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": USER_AGENT, accept },
      });
    } catch (err) {
      clearTimeout(timer);
      throw new Error(err.name === "AbortError" ? "The site timed out." : `Could not reach ${url.hostname}.`);
    }
    clearTimeout(timer);

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get("location");
      if (!location) throw new Error("The site sent a redirect with no destination.");
      current = new URL(location, url).href;
      continue;
    }
    return { res, url };
  }
  throw new Error("Too many redirects.");
}

/* ---- HTML to text ------------------------------------------------------- */

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", mdash: "-", ndash: "-",
};

function htmlToText(html) {
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#?\w+);/g, (m, e) => ENTITIES[e.toLowerCase()] ?? m)
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

const titleOf = (html) =>
  (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim();

async function readBounded(res) {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_PAGE_BYTES) { reader.cancel().catch(() => {}); break; }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map(Buffer.from)).toString("utf8");
}

/* ---- search ------------------------------------------------------------
   Three backends, best first. An official API is stable; scraping a results
   page is not, so the scraper is written to key off nothing but "an external
   link with visible text" rather than any class name. Brave's own markup uses
   per-build Svelte hashes, which would rot on their next deploy.
   ------------------------------------------------------------------------- */

const BRAVE_KEY = () => process.env.BRAVE_API_KEY || "";
const SEARXNG = () => (process.env.SEARXNG_URL || "").replace(/\/+$/, "");

export const searchBackend = () =>
  BRAVE_KEY() ? "brave-api" : SEARXNG() ? "searxng" : "wikipedia";

async function searchBraveApi(q, limit) {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${limit}`;
  const res = await fetch(url, {
    headers: { accept: "application/json", "x-subscription-token": BRAVE_KEY() },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Brave search returned ${res.status}.`);
  const json = await res.json();
  return (json.web?.results ?? []).slice(0, limit).map((r) => ({
    title: r.title || "",
    url: r.url,
    snippet: htmlToText(r.description || "").slice(0, 300),
  }));
}

/* Operator-configured, so it is allowed to be on the local network. */
async function searchSearxng(q, limit) {
  const url = `${SEARXNG()}/search?q=${encodeURIComponent(q)}&format=json`;
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`SearXNG returned ${res.status}.`);
  const json = await res.json();
  return (json.results ?? []).slice(0, limit).map((r) => ({
    title: r.title || "",
    url: r.url,
    snippet: (r.content || "").slice(0, 300),
  }));
}

/* Keyless fallback. Narrow on purpose: it is a real API that will not rot,
   unlike scraping a results page, which is what the alternative amounts to.
   Anything outside Wikipedia is still reachable through fetch_url. */
async function searchWikipedia(q, limit) {
  const url = "https://en.wikipedia.org/w/api.php?action=query&format=json&list=search" +
              `&srlimit=${limit}&srsearch=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Wikipedia search returned ${res.status}.`);
  const json = await res.json();
  return (json.query?.search ?? []).map((r) => ({
    title: r.title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, "_"))}`,
    snippet: htmlToText(r.snippet || "").slice(0, 300),
  }));
}

export async function webSearch(query, limit = 6) {
  const q = String(query || "").trim().slice(0, 400);
  if (!q) throw new Error("Empty search query.");

  const backend = searchBackend();
  const run = backend === "brave-api" ? searchBraveApi
            : backend === "searxng"   ? searchSearxng
            : searchWikipedia;

  let results = [];
  try {
    results = await run(q, limit);
  } catch (err) {
    if (backend === "wikipedia") throw err;
    console.warn(`search backend ${backend} failed (${err.message}), falling back to Wikipedia`);
    results = await searchWikipedia(q, limit);
  }

  if (!results.length) throw new Error(`No results for "${q}".`);
  return { backend, results };
}

export async function fetchPage(rawUrl) {
  const { res, url } = await safeFetch(rawUrl, { accept: "text/html,text/plain" });
  if (!res.ok) throw new Error(`${url.hostname} returned ${res.status}.`);

  const type = res.headers.get("content-type") || "";
  if (!/text\/html|text\/plain|application\/(xhtml|json)/i.test(type)) {
    throw new Error(`${url.hostname} returned ${type.split(";")[0] || "an unreadable type"}.`);
  }

  const body = await readBounded(res);
  const text = /html/i.test(type) ? htmlToText(body) : body.trim();
  const truncated = text.length > MAX_TEXT_CHARS;

  return {
    url: url.href,
    title: /html/i.test(type) ? titleOf(body) : url.hostname,
    text: text.slice(0, MAX_TEXT_CHARS),
    truncated,
  };
}

/* exported for the tests */
export const _internal = { isBlockedIp, assertPublicUrl, htmlToText };

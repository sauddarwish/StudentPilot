#!/usr/bin/env node
/* ==========================================================================
   Cram server

   Two jobs:
     1. Gate the whole site behind a password. The check is server-side — an
        unauthenticated request never receives index.html, the JS, or the CSS.
        Only the login page and its POST handler are reachable logged out.
     2. Hold the model API key. The browser talks to /api/v1/messages on this
        origin; the key lives in .env and is attached here, server-side, so it
        is never shipped to the client.

   Zero npm dependencies — node:http, node:crypto and global fetch only.
   ========================================================================== */

import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = path.resolve(HERE, "..");

/* ==========================================================================
   Config
   ========================================================================== */

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv(path.join(HERE, ".env"));

const CONFIG = {
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || "127.0.0.1",

  // auth
  passwordHash: process.env.SITE_PASSWORD_HASH || "",
  passwordPlain: process.env.SITE_PASSWORD || "",
  sessionSecret: process.env.SESSION_SECRET || "",
  sessionHours: Number(process.env.SESSION_HOURS || 12),
  secureCookie: (process.env.SECURE_COOKIE ?? "true") !== "false",

  // upstream model provider
  anthropicKey: process.env.ANTHROPIC_API_KEY || "",
  anthropicBase: process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1",
  openaiKey: process.env.OPENAI_API_KEY || "",
  openaiBase: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",

  maxBodyBytes: Number(process.env.MAX_BODY_BYTES || 256 * 1024),
  loginMaxAttempts: Number(process.env.LOGIN_MAX_ATTEMPTS || 8),
  loginWindowMin: Number(process.env.LOGIN_WINDOW_MIN || 15),
};

if (!CONFIG.sessionSecret) {
  console.error("FATAL: SESSION_SECRET is not set in server/.env");
  process.exit(1);
}
if (!CONFIG.passwordHash && !CONFIG.passwordPlain) {
  console.error("FATAL: set SITE_PASSWORD_HASH (preferred) or SITE_PASSWORD in server/.env");
  process.exit(1);
}

/* ==========================================================================
   Password + session
   ========================================================================== */

/* scrypt hash format: scrypt$<saltHex>$<keyHex> */
function verifyPassword(candidate) {
  if (CONFIG.passwordHash) {
    const [scheme, saltHex, keyHex] = CONFIG.passwordHash.split("$");
    if (scheme !== "scrypt" || !saltHex || !keyHex) return false;
    const expected = Buffer.from(keyHex, "hex");
    let actual;
    try {
      actual = crypto.scryptSync(candidate, Buffer.from(saltHex, "hex"), expected.length);
    } catch {
      return false;
    }
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }

  const a = Buffer.from(candidate);
  const b = Buffer.from(CONFIG.passwordPlain);
  // hash both sides so timingSafeEqual gets equal-length buffers
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

const sign = (data) =>
  crypto.createHmac("sha256", CONFIG.sessionSecret).update(data).digest("base64url");

function issueSession() {
  const expires = Date.now() + CONFIG.sessionHours * 3600_000;
  const payload = Buffer.from(JSON.stringify({ exp: expires })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function validSession(token) {
  if (!token || !token.includes(".")) return false;
  const [payload, mac] = token.split(".");
  const expected = sign(payload);
  if (mac.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return false;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString()).exp > Date.now();
  } catch {
    return false;
  }
}

const parseCookies = (header = "") =>
  Object.fromEntries(
    header.split(";").map((c) => {
      const i = c.indexOf("=");
      return i === -1 ? [c.trim(), ""] : [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
    }).filter(([k]) => k));

/* ---- login throttling --------------------------------------------------- */

const attempts = new Map(); // ip -> { count, first }

function throttled(ip) {
  const rec = attempts.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.first > CONFIG.loginWindowMin * 60_000) {
    attempts.delete(ip);
    return false;
  }
  return rec.count >= CONFIG.loginMaxAttempts;
}

function noteFailure(ip) {
  const rec = attempts.get(ip);
  if (!rec || Date.now() - rec.first > CONFIG.loginWindowMin * 60_000) {
    attempts.set(ip, { count: 1, first: Date.now() });
  } else {
    rec.count++;
  }
}

setInterval(() => {
  const cutoff = Date.now() - CONFIG.loginWindowMin * 60_000;
  for (const [ip, rec] of attempts) if (rec.first < cutoff) attempts.delete(ip);
}, 5 * 60_000).unref();

const clientIp = (req) =>
  (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "unknown";

/* ==========================================================================
   Helpers
   ========================================================================== */

function readBody(req, limit = CONFIG.maxBodyBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "x-content-type-options": "nosniff",
    "referrer-policy": "same-origin",
    ...headers,
  });
  res.end(body);
}

const json = (res, status, obj, headers = {}) =>
  send(res, status, JSON.stringify(obj), { "content-type": "application/json; charset=utf-8", ...headers });

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".md": "text/markdown; charset=utf-8",
};

/* only these prefixes are ever served from disk */
const SERVE_ALLOW = [/^\/$/, /^\/index\.html$/, /^\/assets\//];

async function serveStatic(req, res, urlPath) {
  if (!SERVE_ALLOW.some((re) => re.test(urlPath))) return send(res, 404, "Not found");

  const rel = urlPath === "/" ? "index.html" : urlPath.slice(1);
  const file = path.resolve(SITE_ROOT, rel);
  if (!file.startsWith(SITE_ROOT + path.sep)) return send(res, 403, "Forbidden");

  let stat;
  try {
    stat = await fsp.stat(file);
  } catch {
    return send(res, 404, "Not found");
  }
  if (!stat.isFile()) return send(res, 404, "Not found");

  const etag = `"${stat.size}-${stat.mtimeMs.toString(36)}"`;
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, { etag });
    return res.end();
  }

  res.writeHead(200, {
    "content-type": MIME[path.extname(file)] || "application/octet-stream",
    "content-length": stat.size,
    etag,
    "cache-control": "no-cache",
    "x-content-type-options": "nosniff",
  });
  fs.createReadStream(file).pipe(res);
}

/* ==========================================================================
   Login page
   ========================================================================== */

function loginPage({ error = "", locked = false } = {}) {
  const msg = locked
    ? `<p class="err">Too many attempts. Try again in ${CONFIG.loginWindowMin} minutes.</p>`
    : error
      ? `<p class="err">${error}</p>`
      : "";

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cram</title>
<meta name="color-scheme" content="light dark">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎓</text></svg>">
<style>
  :root{--bg:#f6f7fb;--surface:#fff;--surface-2:#f0f1f6;--text:#12141c;--dim:#5b6072;
        --border:#e2e4ed;--accent:#6366f1;--danger:#dc2626}
  @media (prefers-color-scheme:dark){
    :root{--bg:#0c0d12;--surface:#14161e;--surface-2:#1b1e28;--text:#eceef5;--dim:#a2a8bd;
          --border:#242733;--danger:#f87171}
  }
  *{box-sizing:border-box}
  body{margin:0;min-height:100dvh;display:grid;place-items:center;background:var(--bg);color:var(--text);
       font:15px/1.55 "Inter","SF Pro Text",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:20px}
  .card{width:100%;max-width:352px;background:var(--surface);border:1px solid var(--border);
        border-radius:16px;padding:26px;box-shadow:0 8px 30px rgba(10,12,20,.10)}
  .mark{width:42px;height:42px;display:grid;place-items:center;border-radius:12px;
        background:linear-gradient(135deg,var(--accent),#8b5cf6);font-size:21px;margin-bottom:14px}
  h1{font-size:19px;margin:0 0 4px;letter-spacing:-.01em}
  p.sub{margin:0 0 20px;color:var(--dim);font-size:13px}
  label{display:block;font-size:12.5px;font-weight:600;margin-bottom:6px}
  input{width:100%;padding:10px 12px;font:inherit;background:var(--surface-2);color:var(--text);
        border:1px solid var(--border);border-radius:10px;outline:none}
  input:focus{border-color:var(--accent)}
  button{width:100%;margin-top:14px;padding:10px;font:inherit;font-weight:600;cursor:pointer;
         background:linear-gradient(135deg,var(--accent),#8b5cf6);color:#fff;border:0;border-radius:10px}
  button:hover{filter:brightness(1.08)}
  .err{margin:14px 0 0;color:var(--danger);font-size:12.5px}
  .foot{margin:18px 0 0;color:var(--dim);font-size:11.5px;text-align:center}
</style></head>
<body>
  <form class="card" method="POST" action="/login">
    <div class="mark">🎓</div>
    <h1>Cram</h1>
    <p class="sub">This site is private. Enter the access password.</p>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" autofocus required>
    <button type="submit">Unlock</button>
    ${msg}
    <p class="foot">Sessions last ${CONFIG.sessionHours}h.</p>
  </form>
</body></html>`;
}

/* ==========================================================================
   Model proxy — the key never leaves this process
   ========================================================================== */

const PROXY_ROUTES = {
  "/api/v1/messages": () => ({
    url: `${CONFIG.anthropicBase.replace(/\/+$/, "")}/messages`,
    key: CONFIG.anthropicKey,
    headers: (key) => ({
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    }),
    name: "ANTHROPIC_API_KEY",
  }),
  "/api/v1/chat/completions": () => ({
    url: `${CONFIG.openaiBase.replace(/\/+$/, "")}/chat/completions`,
    key: CONFIG.openaiKey,
    headers: (key) => ({
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    }),
    name: "OPENAI_API_KEY",
  }),
};

async function proxy(req, res, route) {
  const spec = PROXY_ROUTES[route]();
  if (!spec.key) {
    return json(res, 503, {
      error: { type: "not_configured", message: `${spec.name} is not set in server/.env` },
    });
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 413, { error: { type: "too_large", message: "Request body too large" } });
  }

  let upstream;
  try {
    upstream = await fetch(spec.url, { method: "POST", headers: spec.headers(spec.key), body });
  } catch (err) {
    return json(res, 502, { error: { type: "upstream_unreachable", message: err.message } });
  }

  res.writeHead(upstream.status, {
    "content-type": upstream.headers.get("content-type") || "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });

  if (!upstream.body) return res.end();

  try {
    for await (const chunk of upstream.body) {
      if (!res.write(Buffer.from(chunk))) {
        await new Promise((r) => res.once("drain", r));
      }
    }
  } catch (err) {
    console.error("proxy stream error:", err.message);
  }
  res.end();
}

/* ==========================================================================
   Router
   ========================================================================== */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const urlPath = decodeURIComponent(url.pathname);
  const cookies = parseCookies(req.headers.cookie);
  const authed = validSession(cookies.sp_session);
  const ip = clientIp(req);

  const cookieAttrs = [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    CONFIG.secureCookie ? "Secure" : "",
    `Max-Age=${CONFIG.sessionHours * 3600}`,
  ].filter(Boolean).join("; ");

  /* ---- health (unauthenticated, no secrets) ---- */
  if (urlPath === "/healthz") {
    return json(res, 200, {
      ok: true,
      anthropic: Boolean(CONFIG.anthropicKey),
      openai: Boolean(CONFIG.openaiKey),
    });
  }

  /* ---- login ---- */
  if (urlPath === "/login") {
    if (req.method === "GET") {
      if (authed) return send(res, 302, "", { location: "/" });
      return send(res, 200, loginPage(), { "content-type": "text/html; charset=utf-8" });
    }
    if (req.method === "POST") {
      if (throttled(ip)) {
        console.warn(`login throttled for ${ip}`);
        return send(res, 429, loginPage({ locked: true }), { "content-type": "text/html; charset=utf-8" });
      }
      let form;
      try {
        form = new URLSearchParams(await readBody(req, 4096));
      } catch {
        return send(res, 400, "Bad request");
      }
      if (verifyPassword(form.get("password") ?? "")) {
        attempts.delete(ip);
        console.log(`login ok from ${ip}`);
        return send(res, 302, "", { location: "/", "set-cookie": `sp_session=${issueSession()}; ${cookieAttrs}` });
      }
      noteFailure(ip);
      console.warn(`login failed from ${ip}`);
      return send(res, 401, loginPage({ error: "Wrong password." }), {
        "content-type": "text/html; charset=utf-8",
      });
    }
    return send(res, 405, "Method not allowed");
  }

  if (urlPath === "/logout") {
    return send(res, 302, "", {
      location: "/login",
      "set-cookie": `sp_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    });
  }

  /* ---- everything below requires a session ---- */
  if (!authed) {
    if (urlPath.startsWith("/api/")) {
      return json(res, 401, { error: { type: "unauthenticated", message: "Log in first." } });
    }
    return send(res, 302, "", { location: "/login" });
  }

  if (PROXY_ROUTES[urlPath]) {
    if (req.method !== "POST") return send(res, 405, "Method not allowed");
    return proxy(req, res, urlPath);
  }
  if (urlPath.startsWith("/api/")) return json(res, 404, { error: { type: "not_found" } });

  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");
  return serveStatic(req, res, urlPath);
});

server.listen(CONFIG.port, CONFIG.host, () => {
  console.log(`Cram listening on http://${CONFIG.host}:${CONFIG.port}`);
  console.log(`  auth:      ${CONFIG.passwordHash ? "scrypt hash" : "PLAINTEXT password (set a hash instead)"}`);
  console.log(`  anthropic: ${CONFIG.anthropicKey ? "key loaded" : "not configured"}`);
  console.log(`  openai:    ${CONFIG.openaiKey ? "key loaded" : "not configured"}`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => server.close(() => process.exit(0)));
}

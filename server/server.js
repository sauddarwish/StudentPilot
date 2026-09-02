#!/usr/bin/env node
/* ==========================================================================
   Cram server

   Jobs:
     1. Accounts. Email + password signup and login, enforced server-side —
        an unauthenticated request never receives index.html, the JS or the
        CSS. Only /login, /signup and their POST handlers are reachable
        logged out.
     2. An optional model proxy. If the operator puts a key in .env, signed-in
        users can point a connection at /api/v1 on this origin and the key is
        attached here rather than in the browser. Users are also free to use
        their own keys directly — that is the default.

   Zero npm dependencies — node:http, node:crypto and global fetch only.
   ========================================================================== */

import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  createUser, verifyUser, findById, noteLogin, count as userCount,
  changePassword, saveApiKey, deleteApiKey, listApiKeys, getApiKey,
} from "./users.js";
import { initMasterKey, canEncrypt, generateKey } from "./secretbox.js";

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

  sessionSecret: process.env.SESSION_SECRET || "",
  sessionDays: Number(process.env.SESSION_DAYS || 14),
  secureCookie: (process.env.SECURE_COOKIE ?? "true") !== "false",
  allowSignup: (process.env.ALLOW_SIGNUP ?? "true") !== "false",

  // optional shared proxy — off unless the operator supplies a key
  anthropicKey: process.env.ANTHROPIC_API_KEY || "",
  anthropicBase: process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1",
  openaiKey: process.env.OPENAI_API_KEY || "",
  openaiBase: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  forceModel: process.env.FORCE_MODEL || "",
  maxTokensCap: Number(process.env.MAX_TOKENS_CAP || 8192),

  encryptionKey: process.env.ENCRYPTION_KEY || "",

  maxBodyBytes: Number(process.env.MAX_BODY_BYTES || 256 * 1024),
  authMaxAttempts: Number(process.env.LOGIN_MAX_ATTEMPTS || 10),
  authWindowMin: Number(process.env.LOGIN_WINDOW_MIN || 15),
};

if (!CONFIG.sessionSecret) {
  console.error("FATAL: SESSION_SECRET is not set in server/.env");
  process.exit(1);
}

if (CONFIG.encryptionKey && !initMasterKey(CONFIG.encryptionKey)) {
  console.error("FATAL: ENCRYPTION_KEY must be 32 bytes, base64 or hex encoded.");
  console.error(`       Generate one with:  ENCRYPTION_KEY=${generateKey()}`);
  process.exit(1);
}

const COOKIE = "cram_session";

/* ==========================================================================
   Sessions
   ========================================================================== */

const sign = (data) =>
  crypto.createHmac("sha256", CONFIG.sessionSecret).update(data).digest("base64url");

function issueSession(userId) {
  const exp = Date.now() + CONFIG.sessionDays * 86_400_000;
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** @returns the signed-in user record, or null */
function sessionUser(token) {
  if (!token || !token.includes(".")) return null;
  const [payload, mac] = token.split(".");
  const expected = sign(payload);
  if (mac.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!(exp > Date.now())) return null;
    return findById(uid);            // deleted accounts stop working immediately
  } catch {
    return null;
  }
}

const parseCookies = (header = "") =>
  Object.fromEntries(
    header.split(";").map((c) => {
      const i = c.indexOf("=");
      return i === -1 ? [c.trim(), ""] : [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
    }).filter(([k]) => k));

/* ---- throttling (shared by login and signup) ---------------------------- */

const attempts = new Map(); // ip -> { count, first }

function throttled(ip) {
  const rec = attempts.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.first > CONFIG.authWindowMin * 60_000) {
    attempts.delete(ip);
    return false;
  }
  return rec.count >= CONFIG.authMaxAttempts;
}

function noteFailure(ip) {
  const rec = attempts.get(ip);
  if (!rec || Date.now() - rec.first > CONFIG.authWindowMin * 60_000) {
    attempts.set(ip, { count: 1, first: Date.now() });
  } else {
    rec.count++;
  }
}

setInterval(() => {
  const cutoff = Date.now() - CONFIG.authWindowMin * 60_000;
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
      if (size > limit) { reject(new Error("payload too large")); req.destroy(); return; }
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

const html = (res, status, body, headers = {}) =>
  send(res, status, body, { "content-type": "text/html; charset=utf-8", ...headers });

const json = (res, status, obj, headers = {}) =>
  send(res, status, JSON.stringify(obj), { "content-type": "application/json; charset=utf-8", ...headers });

const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

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
};

/* only these paths are ever served from disk */
const SERVE_ALLOW = [/^\/$/, /^\/index\.html$/, /^\/assets\//];

async function serveStatic(req, res, urlPath) {
  if (!SERVE_ALLOW.some((re) => re.test(urlPath))) return send(res, 404, "Not found");

  const rel = urlPath === "/" ? "index.html" : urlPath.slice(1);
  const file = path.resolve(SITE_ROOT, rel);
  if (!file.startsWith(SITE_ROOT + path.sep)) return send(res, 403, "Forbidden");

  let stat;
  try { stat = await fsp.stat(file); } catch { return send(res, 404, "Not found"); }
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
   Auth pages
   ========================================================================== */

const AUTH_CSS = `
  :root{--bg:#f6f7fb;--surface:#fff;--surface-2:#f0f1f6;--text:#12141c;--dim:#5b6072;
        --border:#e2e4ed;--accent:#6366f1;--accent2:#8b5cf6;--danger:#dc2626}
  @media (prefers-color-scheme:dark){
    :root{--bg:#0c0d12;--surface:#14161e;--surface-2:#1b1e28;--text:#eceef5;--dim:#a2a8bd;
          --border:#242733;--danger:#f87171}
  }
  *{box-sizing:border-box}
  body{margin:0;min-height:100dvh;display:grid;place-items:center;background:var(--bg);color:var(--text);
       font:15px/1.55 "Inter","SF Pro Text",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:20px}
  .card{width:100%;max-width:368px;background:var(--surface);border:1px solid var(--border);
        border-radius:16px;padding:26px;box-shadow:0 8px 30px rgba(10,12,20,.10)}
  .mark{width:42px;height:42px;display:grid;place-items:center;border-radius:12px;
        background:linear-gradient(135deg,var(--accent),var(--accent2));font-size:21px;margin-bottom:14px}
  h1{font-size:19px;margin:0 0 4px;letter-spacing:-.01em}
  p.sub{margin:0 0 20px;color:var(--dim);font-size:13px}
  label{display:block;font-size:12.5px;font-weight:600;margin:0 0 6px}
  .f{margin-bottom:13px}
  input{width:100%;padding:10px 12px;font:inherit;background:var(--surface-2);color:var(--text);
        border:1px solid var(--border);border-radius:10px;outline:none}
  input:focus{border-color:var(--accent)}
  button{width:100%;margin-top:4px;padding:10px;font:inherit;font-weight:600;cursor:pointer;
         background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;border:0;border-radius:10px}
  button:hover{filter:brightness(1.08)}
  .err{margin:13px 0 0;color:var(--danger);font-size:12.5px}
  .alt{margin:18px 0 0;color:var(--dim);font-size:12.5px;text-align:center}
  .alt a{color:var(--accent)}
  .hint{color:var(--dim);font-size:11.5px;margin:5px 0 0}`;

function authPage({ mode, error = "", email = "", notice = "" }) {
  const signup = mode === "signup";
  const title = signup ? "Create your account" : "Welcome back";
  const sub = signup ? "Email and password — that's all we need." : "Sign in to your Cram workspace.";

  const errBlock = error ? `<p class="err">${escapeHtml(error)}</p>` : "";
  const noticeBlock = notice ? `<p class="hint">${escapeHtml(notice)}</p>` : "";

  const alt = signup
    ? `<p class="alt">Already have an account? <a href="/login">Sign in</a></p>`
    : (CONFIG.allowSignup
        ? `<p class="alt">No account yet? <a href="/signup">Create one</a></p>`
        : `<p class="alt">Signups are closed.</p>`);

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${signup ? "Sign up" : "Sign in"} · Cram</title>
<meta name="color-scheme" content="light dark">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎓</text></svg>">
<style>${AUTH_CSS}</style></head>
<body>
  <form class="card" method="POST" action="${signup ? "/signup" : "/login"}">
    <div class="mark">🎓</div>
    <h1>${title}</h1>
    <p class="sub">${sub}</p>

    <div class="f">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" autocomplete="email"
             value="${escapeHtml(email)}" required autofocus>
    </div>

    <div class="f">
      <label for="password">Password</label>
      <input id="password" name="password" type="password"
             autocomplete="${signup ? "new-password" : "current-password"}" required>
      ${signup ? '<p class="hint">At least 8 characters.</p>' : ""}
    </div>

    ${signup ? `<div class="f">
      <label for="confirm">Confirm password</label>
      <input id="confirm" name="confirm" type="password" autocomplete="new-password" required>
    </div>` : ""}

    <button type="submit">${signup ? "Create account" : "Sign in"}</button>
    ${errBlock}
    ${noticeBlock}
    ${alt}
  </form>
</body></html>`;
}

/* ==========================================================================
   Optional model proxy
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

async function proxy(req, res, route, user) {
  const spec = PROXY_ROUTES[route]();

  /* Prefer the user's own saved key (encrypted at rest, decrypted here only for
     the duration of their request). Fall back to the operator's shared key. */
  const providerName = route.includes("messages") ? "anthropic" : "openai";
  const ownKey = canEncrypt() ? getApiKey(user.id, providerName) : null;
  const usingOwnKey = Boolean(ownKey);
  const key = ownKey || spec.key;

  if (!key) {
    return json(res, 503, {
      error: {
        type: "not_configured",
        message:
          `No ${spec.name} available. Save your own key under Settings → Model, ` +
          `or ask the operator to configure a shared one.`,
      },
    });
  }

  let body;
  try { body = await readBody(req); }
  catch { return json(res, 413, { error: { type: "too_large", message: "Request body too large" } }); }

  /* Spend guards apply only when the operator's key is footing the bill. A user
     spending their own key is not restricted. */
  if (!usingOwnKey) {
    try {
      const parsed = JSON.parse(body);
      if (CONFIG.forceModel) parsed.model = CONFIG.forceModel;
      parsed.max_tokens = Math.min(Number(parsed.max_tokens) || CONFIG.maxTokensCap, CONFIG.maxTokensCap);
      body = JSON.stringify(parsed);
    } catch {
      return json(res, 400, { error: { type: "bad_request", message: "Body must be JSON" } });
    }
  }

  let upstream;
  try {
    upstream = await fetch(spec.url, { method: "POST", headers: spec.headers(key), body });
  } catch (err) {
    return json(res, 502, { error: { type: "upstream_unreachable", message: err.message } });
  }

  console.log(`proxy ${route} for ${user.email} (${usingOwnKey ? "own key" : "shared key"}) -> ${upstream.status}`);

  res.writeHead(upstream.status, {
    "content-type": upstream.headers.get("content-type") || "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  if (!upstream.body) return res.end();

  try {
    for await (const chunk of upstream.body) {
      if (!res.write(Buffer.from(chunk))) await new Promise((r) => res.once("drain", r));
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
  const user = sessionUser(cookies[COOKIE]);
  const ip = clientIp(req);

  const cookieAttrs = [
    "Path=/", "HttpOnly", "SameSite=Lax",
    CONFIG.secureCookie ? "Secure" : "",
    `Max-Age=${CONFIG.sessionDays * 86_400}`,
  ].filter(Boolean).join("; ");

  const startSession = (u, location = "/") =>
    send(res, 302, "", { location, "set-cookie": `${COOKIE}=${issueSession(u.id)}; ${cookieAttrs}` });

  /* ---- unauthenticated ---- */

  if (urlPath === "/healthz") {
    return json(res, 200, {
      ok: true,
      users: userCount(),
      signup: CONFIG.allowSignup,
      sharedEndpoint: Boolean(CONFIG.anthropicKey || CONFIG.openaiKey),
    });
  }

  if (urlPath === "/login") {
    if (req.method === "GET") {
      return user ? send(res, 302, "", { location: "/" }) : html(res, 200, authPage({ mode: "login" }));
    }
    if (req.method === "POST") {
      if (throttled(ip)) {
        return html(res, 429, authPage({
          mode: "login",
          error: `Too many attempts. Try again in ${CONFIG.authWindowMin} minutes.`,
        }));
      }
      let form;
      try { form = new URLSearchParams(await readBody(req, 8192)); }
      catch { return send(res, 400, "Bad request"); }

      const email = form.get("email") ?? "";
      const password = form.get("password") ?? "";
      const found = verifyUser(email, password);
      if (found) {
        attempts.delete(ip);
        // pass the plaintext so an older, cheaper hash gets upgraded in place
        noteLogin(found.id, password);
        console.log(`login ok: ${found.email} from ${ip}`);
        return startSession(found);
      }
      noteFailure(ip);
      console.warn(`login failed: ${email} from ${ip}`);
      return html(res, 401, authPage({
        mode: "login", email, error: "Wrong email or password.",
      }));
    }
    return send(res, 405, "Method not allowed");
  }

  if (urlPath === "/signup") {
    if (!CONFIG.allowSignup) {
      return html(res, 403, authPage({ mode: "login", error: "Signups are closed on this server." }));
    }
    if (req.method === "GET") {
      return user ? send(res, 302, "", { location: "/" }) : html(res, 200, authPage({ mode: "signup" }));
    }
    if (req.method === "POST") {
      if (throttled(ip)) {
        return html(res, 429, authPage({
          mode: "signup",
          error: `Too many attempts. Try again in ${CONFIG.authWindowMin} minutes.`,
        }));
      }
      let form;
      try { form = new URLSearchParams(await readBody(req, 8192)); }
      catch { return send(res, 400, "Bad request"); }

      const email = form.get("email") ?? "";
      const password = form.get("password") ?? "";
      const confirm = form.get("confirm") ?? "";

      if (password !== confirm) {
        return html(res, 400, authPage({ mode: "signup", email, error: "The two passwords don't match." }));
      }

      const result = createUser(email, password);
      if (!result.ok) {
        noteFailure(ip);
        return html(res, 400, authPage({ mode: "signup", email, error: result.error }));
      }

      attempts.delete(ip);
      noteLogin(result.user.id);
      console.log(`signup: ${result.user.email} from ${ip}`);
      return startSession(result.user);
    }
    return send(res, 405, "Method not allowed");
  }

  if (urlPath === "/logout") {
    return send(res, 302, "", {
      location: "/login",
      "set-cookie": `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    });
  }

  /* ---- everything below requires a session ---- */

  if (!user) {
    if (urlPath.startsWith("/api/")) {
      return json(res, 401, { error: { type: "unauthenticated", message: "Sign in first." } });
    }
    return send(res, 302, "", { location: "/login" });
  }

  /* ---- saved API keys (encrypted at rest; never returned in full) ---- */
  if (urlPath === "/api/keys") {
    if (req.method === "GET") return json(res, 200, { keys: listApiKeys(user.id) });

    if (req.method === "POST") {
      let payload;
      try { payload = JSON.parse(await readBody(req, 8192)); }
      catch { return json(res, 400, { error: { type: "bad_request", message: "Body must be JSON" } }); }

      if (payload.delete) {
        const removed = deleteApiKey(user.id, payload.provider);
        console.log(`key ${removed ? "deleted" : "delete-miss"} (${payload.provider}) for ${user.email}`);
        return json(res, 200, { ok: removed, keys: listApiKeys(user.id) });
      }

      const result = saveApiKey(user.id, payload.provider, payload.key);
      if (!result.ok) return json(res, 400, { error: { type: "invalid", message: result.error } });
      console.log(`key saved (${payload.provider}) for ${user.email}`);
      return json(res, 200, { ok: true, keys: listApiKeys(user.id) });
    }
    return send(res, 405, "Method not allowed");
  }

  /* ---- change password ---- */
  if (urlPath === "/api/password" && req.method === "POST") {
    let payload;
    try { payload = JSON.parse(await readBody(req, 8192)); }
    catch { return json(res, 400, { error: { type: "bad_request", message: "Body must be JSON" } }); }

    const result = changePassword(user.id, payload.current ?? "", payload.next ?? "");
    if (!result.ok) return json(res, 400, { error: { type: "invalid", message: result.error } });
    console.log(`password changed for ${user.email}`);
    // re-issue so the current browser stays signed in
    return json(res, 200, { ok: true }, { "set-cookie": `${COOKIE}=${issueSession(user.id)}; ${cookieAttrs}` });
  }

  if (urlPath === "/api/config") {
    return json(res, 200, {
      user: { id: user.id, email: user.email },
      encryption: canEncrypt(),
      savedKeys: canEncrypt() ? listApiKeys(user.id) : {},
      sharedEndpoint: {
        available: Boolean(CONFIG.anthropicKey || CONFIG.openaiKey),
        provider: CONFIG.anthropicKey ? "anthropic" : CONFIG.openaiKey ? "openai" : "",
        model: CONFIG.forceModel,
        maxTokens: CONFIG.maxTokensCap,
        url: "/api/v1",
      },
    }, { "cache-control": "no-store" });
  }

  if (PROXY_ROUTES[urlPath]) {
    if (req.method !== "POST") return send(res, 405, "Method not allowed");
    return proxy(req, res, urlPath, user);
  }
  if (urlPath.startsWith("/api/")) return json(res, 404, { error: { type: "not_found" } });

  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");
  return serveStatic(req, res, urlPath);
});

server.listen(CONFIG.port, CONFIG.host, () => {
  console.log(`Cram listening on http://${CONFIG.host}:${CONFIG.port}`);
  console.log(`  accounts:        ${userCount()} registered, signup ${CONFIG.allowSignup ? "open" : "closed"}`);
  console.log(`  shared endpoint: ${CONFIG.anthropicKey || CONFIG.openaiKey ? "on" : "off (users bring their own keys)"}`);
  console.log(`  key encryption:  ${canEncrypt() ? "on (AES-256-GCM)" : "OFF — set ENCRYPTION_KEY to let users store keys"}`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => server.close(() => process.exit(0)));
}

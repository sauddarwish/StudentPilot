/* ==========================================================================
   users.js, a tiny JSON-file user store.

   One process, small user counts, no dependencies. Writes are atomic
   (tmp file + rename) so a crash mid-write cannot truncate the store.
   ========================================================================== */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { encrypt, decrypt, hint, canEncrypt } from "./secretbox.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const USERS_FILE = process.env.USERS_FILE || path.join(HERE, "users.json");

const MIN_PASSWORD = 8;

/* ---- password hashing ---------------------------------------------------
   Passwords are HASHED, never encrypted. There must be no key anywhere that
   turns a stored password back into the original. Cost parameters are written
   into the hash so they can be raised later without invalidating old accounts.
   Format: scrypt$<N>$<r>$<p>$<saltHex>$<keyHex>
   ------------------------------------------------------------------------- */

const SCRYPT = { N: 1 << 16, r: 8, p: 1 };            // ~64 MB, ~100 ms
const MAXMEM = 160 * 1024 * 1024;

export function hashPassword(password, params = SCRYPT) {
  const { N, r, p } = params;
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64, { N, r, p, maxmem: MAXMEM });
  return `scrypt$${N}$${r}$${p}$${salt.toString("hex")}$${key.toString("hex")}`;
}

function parseHash(stored) {
  const parts = String(stored || "").split("$");
  if (parts[0] !== "scrypt") return null;
  if (parts.length === 6) {
    const [, N, r, p, saltHex, keyHex] = parts;
    return { N: Number(N), r: Number(r), p: Number(p), saltHex, keyHex };
  }
  if (parts.length === 3) {
    // pre-parameter hashes used node's scrypt defaults
    return { N: 16384, r: 8, p: 1, saltHex: parts[1], keyHex: parts[2], legacy: true };
  }
  return null;
}

export function checkPassword(password, stored) {
  const parsed = parseHash(stored);
  if (!parsed) return false;
  const expected = Buffer.from(parsed.keyHex, "hex");
  let actual;
  try {
    actual = crypto.scryptSync(password, Buffer.from(parsed.saltHex, "hex"), expected.length, {
      N: parsed.N, r: parsed.r, p: parsed.p, maxmem: MAXMEM,
    });
  } catch {
    return false;
  }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** true when a stored hash used weaker parameters than we now use */
export function needsRehash(stored) {
  const parsed = parseHash(stored);
  return !parsed || parsed.N < SCRYPT.N || parsed.r < SCRYPT.r;
}

/* A dummy verify used when the email doesn't exist, so a missing account and a
   wrong password take about the same time and can't be told apart by timing. */
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString("hex"));
export const burnTime = () => checkPassword("x", DUMMY_HASH);

/* ---- store -------------------------------------------------------------- */

function readAll() {
  try {
    const raw = fs.readFileSync(USERS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.users) ? parsed.users : [];
  } catch {
    return [];
  }
}

function writeAll(users) {
  const tmp = `${USERS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ users }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, USERS_FILE);
  try { fs.chmodSync(USERS_FILE, 0o600); } catch { /* best effort */ }
}

export const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

/* Deliberately permissive, enough to catch typos, not a spec implementation. */
export const validEmail = (email) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizeEmail(email)) && email.length <= 254;

export function passwordProblem(password) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD) {
    return `Password must be at least ${MIN_PASSWORD} characters.`;
  }
  if (password.length > 1024) return "Password is too long.";
  return null;
}

export const count = () => readAll().length;

export function findByEmail(email) {
  const target = normalizeEmail(email);
  return readAll().find((u) => u.email === target) || null;
}

export function findById(id) {
  return readAll().find((u) => u.id === id) || null;
}

/** @returns {{ok: true, user: object} | {ok: false, error: string}} */
export function createUser(email, password) {
  const normalized = normalizeEmail(email);
  if (!validEmail(normalized)) return { ok: false, error: "That doesn't look like an email address." };

  const problem = passwordProblem(password);
  if (problem) return { ok: false, error: problem };

  const users = readAll();
  if (users.some((u) => u.email === normalized)) {
    return { ok: false, error: "An account with that email already exists." };
  }

  const user = {
    id: crypto.randomUUID(),
    email: normalized,
    passwordHash: hashPassword(password),
    createdAt: Date.now(),
    lastLoginAt: null,
  };
  users.push(user);
  writeAll(users);
  return { ok: true, user };
}

export function verifyUser(email, password) {
  const user = findByEmail(email);
  if (!user) {
    burnTime();
    return null;
  }
  return checkPassword(password, user.passwordHash) ? user : null;
}

export function noteLogin(id, password = null) {
  const users = readAll();
  const user = users.find((u) => u.id === id);
  if (!user) return;
  user.lastLoginAt = Date.now();
  // opportunistically upgrade an old, cheaper hash now that we have the plaintext
  if (password && needsRehash(user.passwordHash)) {
    user.passwordHash = hashPassword(password);
  }
  writeAll(users);
}

export function changePassword(id, currentPassword, newPassword) {
  const users = readAll();
  const user = users.find((u) => u.id === id);
  if (!user) return { ok: false, error: "Account not found." };
  if (!checkPassword(currentPassword, user.passwordHash)) {
    return { ok: false, error: "Current password is wrong." };
  }
  const problem = passwordProblem(newPassword);
  if (problem) return { ok: false, error: problem };

  user.passwordHash = hashPassword(newPassword);
  writeAll(users);
  return { ok: true };
}

const PROVIDERS = ["anthropic", "openai", "deepseek"];

/* ---- stored API keys ----------------------------------------------------
   Encrypted at rest with the server master key (see secretbox.js), decrypted
   only in memory, only while proxying that user's own request.
   ------------------------------------------------------------------------- */

export function saveApiKey(id, provider, plaintextKey) {
  if (!canEncrypt()) return { ok: false, error: "Server has no ENCRYPTION_KEY configured." };
  if (!PROVIDERS.includes(provider)) return { ok: false, error: "Unknown provider." };
  const key = String(plaintextKey || "").trim();
  if (key.length < 8) return { ok: false, error: "That doesn't look like an API key." };
  if (key.length > 512) return { ok: false, error: "Key is too long." };

  const users = readAll();
  const user = users.find((u) => u.id === id);
  if (!user) return { ok: false, error: "Account not found." };

  user.apiKeys ??= {};
  user.apiKeys[provider] = { blob: encrypt(key), hint: hint(key), savedAt: Date.now() };
  writeAll(users);
  return { ok: true, hint: user.apiKeys[provider].hint };
}

export function deleteApiKey(id, provider) {
  if (!PROVIDERS.includes(provider)) return false;   // never index with arbitrary input
  const users = readAll();
  const user = users.find((u) => u.id === id);
  if (!user?.apiKeys?.[provider]) return false;
  delete user.apiKeys[provider];
  writeAll(users);
  return true;
}

/** Masked summary for the UI, never returns key material. */
export function listApiKeys(id) {
  const user = findById(id);
  const out = {};
  for (const [provider, rec] of Object.entries(user?.apiKeys ?? {})) {
    out[provider] = { hint: rec.hint, savedAt: rec.savedAt };
  }
  return out;
}

/** @returns the decrypted key, or null if absent or undecryptable */
export function getApiKey(id, provider) {
  const user = findById(id);
  const rec = user?.apiKeys?.[provider];
  return rec ? decrypt(rec.blob) : null;
}

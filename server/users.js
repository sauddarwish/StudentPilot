/* ==========================================================================
   users.js — a tiny JSON-file user store.

   One process, small user counts, no dependencies. Writes are atomic
   (tmp file + rename) so a crash mid-write cannot truncate the store.
   ========================================================================== */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const USERS_FILE = process.env.USERS_FILE || path.join(HERE, "users.json");

const MIN_PASSWORD = 8;

/* ---- hashing ------------------------------------------------------------ */

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export function checkPassword(password, stored) {
  const [scheme, saltHex, keyHex] = String(stored || "").split("$");
  if (scheme !== "scrypt" || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  let actual;
  try {
    actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  } catch {
    return false;
  }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
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

/* Deliberately permissive — enough to catch typos, not a spec implementation. */
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

export function noteLogin(id) {
  const users = readAll();
  const user = users.find((u) => u.id === id);
  if (!user) return;
  user.lastLoginAt = Date.now();
  writeAll(users);
}

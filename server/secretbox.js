/* ==========================================================================
   secretbox.js, authenticated encryption for secrets held at rest.

   Used for API keys, which we must be able to read back to call the provider.
   NOT used for passwords: those are hashed in users.js, because nothing should
   ever be able to turn a stored password back into the original.

   Format: v1$<iv b64url>$<tag b64url>$<ciphertext b64url>
   AES-256-GCM, random 12-byte IV per encryption, 16-byte auth tag.
   ========================================================================== */

import crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const VERSION = "v1";

let masterKey = null;

/** @param {string} raw base64 or hex encoding of 32 bytes */
export function initMasterKey(raw) {
  if (!raw) { masterKey = null; return false; }
  let buf;
  try {
    buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  } catch {
    return false;
  }
  if (buf.length !== 32) return false;
  masterKey = buf;
  return true;
}

export const canEncrypt = () => masterKey !== null;

export const generateKey = () => crypto.randomBytes(32).toString("base64");

export function encrypt(plaintext) {
  if (!masterKey) throw new Error("ENCRYPTION_KEY is not configured");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, masterKey, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join("$");
}

/** @returns the plaintext, or null if it can't be decrypted or was tampered with */
export function decrypt(blob) {
  if (!masterKey || typeof blob !== "string") return null;
  const [version, ivB64, tagB64, ctB64] = blob.split("$");
  if (version !== VERSION || !ivB64 || !tagB64 || !ctB64) return null;
  try {
    const decipher = crypto.createDecipheriv(ALGO, masterKey, Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // wrong master key, or the ciphertext was modified, both land here
    return null;
  }
}

/** "sk-ant-…9f2c", safe to show in a UI or a log */
export function hint(secret) {
  const s = String(secret ?? "");
  if (s.length <= 8) return "…";
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

#!/usr/bin/env node
/* Fill in any missing secrets in server/.env. Existing values are left alone. */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { generateKey } from "./secretbox.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENV = path.join(HERE, ".env");

let env = fs.existsSync(ENV) ? fs.readFileSync(ENV, "utf8") : "";
const added = [];

function ensure(key, value) {
  const re = new RegExp(`^${key}=(.*)$`, "m");
  const match = env.match(re);
  if (match && match[1].trim()) return;                 // already set
  if (match) env = env.replace(re, `${key}=${value}`);
  else env = `${env.replace(/\n*$/, "\n")}${key}=${value}\n`;
  added.push(key);
}

ensure("SESSION_SECRET", crypto.randomBytes(48).toString("base64url"));
ensure("ENCRYPTION_KEY", generateKey());

fs.writeFileSync(ENV, env, { mode: 0o600 });
fs.chmodSync(ENV, 0o600);

console.log(added.length
  ? `\n  Generated: ${added.join(", ")}\n  Written to ${ENV} (mode 600).\n`
  : `\n  Nothing to do — both secrets are already set in ${ENV}.\n`);
console.log("  Note: changing ENCRYPTION_KEY makes every saved API key undecryptable.");
console.log("  Restart to apply:  sudo systemctl restart cram\n");

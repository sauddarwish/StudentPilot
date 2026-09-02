#!/usr/bin/env node
/* Generate a site password and write its scrypt hash into server/.env.
   The plaintext is printed once and never stored.

   Usage:
     node set-password.js              # generate a random password
     node set-password.js "my pass"    # use a specific one
*/

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENV = path.join(HERE, ".env");

const WORDS = [
  "amber", "basalt", "cobalt", "dune", "ember", "fjord", "granite", "harbor",
  "indigo", "juniper", "kelp", "lantern", "meridian", "nimbus", "onyx", "prism",
  "quartz", "ridge", "summit", "tundra", "umber", "vertex", "willow", "zenith",
];

const randomPassword = () => {
  const pick = () => WORDS[crypto.randomInt(WORDS.length)];
  return `${pick()}-${pick()}-${crypto.randomInt(1000, 10000)}`;
};

const hash = (password) => {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
};

function upsert(text, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  return re.test(text) ? text.replace(re, line) : `${text.replace(/\n*$/, "\n")}${line}\n`;
}

const password = process.argv[2] || randomPassword();
let env = fs.existsSync(ENV) ? fs.readFileSync(ENV, "utf8") : "";

env = upsert(env, "SITE_PASSWORD_HASH", hash(password));
env = env.replace(/^SITE_PASSWORD=.*$\n?/m, "");           // drop any plaintext
if (!/^SESSION_SECRET=.+$/m.test(env)) {
  env = upsert(env, "SESSION_SECRET", crypto.randomBytes(48).toString("base64url"));
}

fs.writeFileSync(ENV, env, { mode: 0o600 });
fs.chmodSync(ENV, 0o600);

console.log("\n  Site password:  " + password);
console.log("\n  Hash written to " + ENV + " (mode 600).");
console.log("  This plaintext is not stored anywhere — save it now.\n");
console.log("  Restart to apply:  sudo systemctl restart cram\n");

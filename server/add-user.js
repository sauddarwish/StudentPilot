#!/usr/bin/env node
/* Create or list accounts from the command line, useful when signups are
   closed, or to seed the first account.

   Usage:
     node add-user.js you@example.com                 # generates a password
     node add-user.js you@example.com "my password"   # uses yours
     node add-user.js --list
*/

import crypto from "node:crypto";
import { createUser, findByEmail, USERS_FILE } from "./users.js";
import fs from "node:fs";

const WORDS = [
  "amber", "basalt", "cobalt", "dune", "ember", "fjord", "granite", "harbor",
  "indigo", "juniper", "kelp", "lantern", "meridian", "nimbus", "onyx", "prism",
  "quartz", "ridge", "summit", "tundra", "umber", "vertex", "willow", "zenith",
];
const randomPassword = () => {
  const pick = () => WORDS[crypto.randomInt(WORDS.length)];
  return `${pick()}-${pick()}-${crypto.randomInt(1000, 10000)}`;
};

const [arg, given] = process.argv.slice(2);

if (arg === "--list") {
  try {
    const { users } = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
    if (!users.length) console.log("\n  No accounts yet.\n");
    else {
      console.log(`\n  ${users.length} account(s) in ${USERS_FILE}:\n`);
      for (const u of users) {
        const last = u.lastLoginAt ? new Date(u.lastLoginAt).toISOString().slice(0, 16).replace("T", " ") : "never";
        console.log(`    ${u.email.padEnd(34)} created ${new Date(u.createdAt).toISOString().slice(0, 10)}  last login ${last}`);
      }
      console.log();
    }
  } catch {
    console.log("\n  No user store yet, nobody has signed up.\n");
  }
  process.exit(0);
}

if (!arg) {
  console.error("\n  Usage: node add-user.js <email> [password]\n         node add-user.js --list\n");
  process.exit(1);
}

if (findByEmail(arg)) {
  console.error(`\n  An account for ${arg} already exists.\n`);
  process.exit(1);
}

const password = given || randomPassword();
const result = createUser(arg, password);

if (!result.ok) {
  console.error(`\n  ${result.error}\n`);
  process.exit(1);
}

console.log(`\n  Account created: ${result.user.email}`);
if (!given) console.log(`  Password:        ${password}`);
console.log(`\n  Stored (hashed) in ${USERS_FILE}. The plaintext is not saved anywhere.\n`);

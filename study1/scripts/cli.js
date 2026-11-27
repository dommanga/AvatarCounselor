// Shared helpers for the scripts/ CLIs.

import fs from "node:fs";
import readline from "node:readline/promises";
import roles from "./db-roles.json" with { type: "json" };

// Neon endpoint id of DATABASE_URL (e.g. ep-frosty-hall-b70i06ci), which tells the branches apart.
export function dbEndpoint() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  return new URL(process.env.DATABASE_URL).hostname.split(".")[0].replace(/-pooler$/, "");
}

// Destructive scripts run only when the caller names the endpoint they expect to hit.
export function requireEndpoint(expected) {
  const actual = dbEndpoint();
  if (expected !== actual) {
    console.error(`refusing: DATABASE_URL points at ${actual}. Re-run with --host ${actual} if that is the intended branch.`);
    process.exit(1);
  }
}

export function fail(msg) {
  console.error(msg);
  process.exit(1);
}

// ---------- which database is this? ----------
// test = automated tests only, dev = the researcher's rehearsals, main = anything else (production). Unknown means main.
export function dbRole() {
  const ep = dbEndpoint();
  return ep === roles.test ? "test" : ep === roles.dev ? "dev" : "main";
}

// Every automated test starts with this: it runs only on the test branch, and its Blob files go under test/.
export function requireTestDb() {
  if (!roles.test) fail("refusing: no test branch is registered in scripts/db-roles.json (create the Neon branch `test`, put its endpoint id there and its DATABASE_URL in .env.test).");
  const role = dbRole();
  if (role !== "test") fail(`refusing: tests run only on the Neon test branch (${roles.test}); DATABASE_URL points at ${dbEndpoint()} (${role}). Use npm run test:* so that .env.test is loaded.`);
  if (!/^test(\/|$)/.test(process.env.BLOB_PREFIX || "")) fail("refusing: BLOB_PREFIX must be test/ for tests (set in .env.test).");
}

// Destructive scripts (db:reset, gen-slots, purge execute): dev / test need --host <endpoint>, the main branch needs --prod
// and the count typed in by a person at the terminal.
// count: a number, or a function returning one (called only after the flag checks, so refusals never touch the database).
export async function guardDestructive({ host, prod, what, count }) {
  const role = dbRole();
  if (role === "main") {
    if (!prod) fail(`refusing: DATABASE_URL points at ${dbEndpoint()}, which is not a dev/test branch (main). Add --prod to run this on the main branch.`);
    if (!process.stdin.isTTY) fail(`refusing: the main branch needs a person at the terminal to type the number of ${what}.`);
    await typeCount(what, typeof count === "function" ? await count() : count);
    return role;
  }
  if (prod) fail("refusing: --prod is only for the main branch.");
  requireEndpoint(host);
  return role;
}

async function typeCount(what, count) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`MAIN branch ${dbEndpoint()}: ${count} ${what}. Type ${count} to continue: `)).trim();
  rl.close();
  if (answer !== String(count)) fail("not confirmed; nothing was changed.");
}

// ---------- purge plans (files) ----------
export function writePlanFile(plan, out = null) {
  const dir = new URL("../purge-plans/", import.meta.url);
  fs.mkdirSync(dir, { recursive: true });
  const file = out || new URL(`${plan.kind}-${plan.created_at.replace(/[:.]/g, "-")}.json`, dir).pathname;
  fs.writeFileSync(file, JSON.stringify(plan, null, 2) + "\n");
  return file;
}
export const readPlanFile = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

// Issues participant links. Prints CSV (participant_id,link) to stdout — the only place the tokens
// ever appear (the DB keeps their sha256), so save the output.
//   npm run issue-tokens -- --n 5 --batch W1 [--expires 2026-12-06T23:59:59+09:00] [--base-url https://…]
//   npm run issue-tokens -- --n 1 --batch W1 --test --stance direct --modality voice    (T1-xxx, no slot)
// Default expiry: Sunday 23:59:59 KST of the current week. Base URL: --base-url, else STUDY1_BASE_URL.

import crypto from "crypto";
import { parseArgs } from "node:util";
import { db } from "../lib/db.js";
import { newParticipantToken } from "../lib/auth.js";
import { weekEndKST } from "../lib/lifecycle.js";
import { MODALITIES } from "../lib/config.js";
import { CONDITIONS } from "../src/questions.js";
import { dbEndpoint, fail } from "./cli.js";

const { values: v } = parseArgs({
  options: {
    n: { type: "string" }, batch: { type: "string" }, expires: { type: "string" }, "base-url": { type: "string" },
    test: { type: "boolean", default: false }, stance: { type: "string" }, modality: { type: "string" },
  },
});
const n = Number(v.n);
if (!Number.isInteger(n) || n < 1 || n > 200) fail("--n must be an integer 1–200");
if (!/^[A-Za-z0-9_-]{1,16}$/.test(v.batch || "")) fail("--batch required (e.g. W1)");
const expires = v.expires ? new Date(v.expires) : weekEndKST();
if (Number.isNaN(expires.getTime())) fail("--expires must be an ISO date");
if (expires <= new Date()) fail(`expiry ${expires.toISOString()} is in the past`);
if (v.test ? !CONDITIONS.includes(v.stance) || !MODALITIES.includes(v.modality) : v.stance || v.modality) {
  fail(v.test ? `--test needs --stance (${CONDITIONS.join("|")}) and --modality (${MODALITIES.join("|")})`
              : "--stance/--modality are only for --test sessions (real ones are assigned at consent)");
}
const base = (v["base-url"] || process.env.STUDY1_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");

const sql = db();
const prefix = v.test ? "T1" : "S1";
const [{ max }] = await sql`
  SELECT coalesce(max(substring(participant_id from '\\d+$')::int), 0) AS max
  FROM sessions WHERE participant_id LIKE ${prefix + "-%"}`;

const out = [];
const statements = [];
for (let i = 1; i <= n; i++) {
  const pid = `${prefix}-${String(max + i).padStart(3, "0")}`;
  const id = crypto.randomUUID();
  const { token, hash } = newParticipantToken();
  statements.push(
    sql`INSERT INTO sessions (id, participant_id, batch_id, is_test, token_hash, expires_at, stance, modality)
        VALUES (${id}, ${pid}, ${v.batch}, ${v.test}, ${hash}, ${expires.toISOString()},
                ${v.test ? v.stance : null}, ${v.test ? v.modality : null})`,
    sql`INSERT INTO audit_log (actor, action, session_id, detail)
        VALUES ('script', 'issued', ${id}, ${JSON.stringify({ batch: v.batch, expires_at: expires.toISOString(), is_test: v.test })}::jsonb)`,
  );
  out.push(`${pid},${base}/s/${token}`);
}
await sql.transaction(statements);

console.log("participant_id,link");
for (const line of out) console.log(line);
const kst = new Date(expires.getTime() + 9 * 3600_000).toISOString().replace("T", " ").slice(0, 16);
console.error(`issued ${n} ${v.test ? "test " : ""}link(s), batch ${v.batch}, expires ${kst} KST, db ${dbEndpoint()}`);

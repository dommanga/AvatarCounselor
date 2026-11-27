// Issues participant links (the same code as /admin: lib/issue.js). Prints CSV (participant_id,link) to stdout —
// the only place the tokens ever appear (the DB keeps their sha256), so save the output.
//   npm run issue-tokens -- --n 5 --batch W1 [--expires 2026-12-06T23:59:59+09:00] [--base-url https://…]
//   npm run issue-tokens -- --n 1 --batch W1 --test --stance direct --modality voice    (T1-xxx, no slot)
// Default expiry: Sunday 23:59:59 KST of the current week. Base URL: --base-url, else STUDY1_BASE_URL.

import { parseArgs } from "node:util";
import { issueTokens } from "../lib/issue.js";
import { dbEndpoint, fail } from "./cli.js";

const { values: v } = parseArgs({
  options: {
    n: { type: "string" }, batch: { type: "string" }, expires: { type: "string" }, "base-url": { type: "string" },
    test: { type: "boolean", default: false }, stance: { type: "string" }, modality: { type: "string" },
  },
});
const base = (v["base-url"] || process.env.STUDY1_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");

let result;
try {
  result = await issueTokens({ n: v.n, batch: v.batch, expires: v.expires ?? null, test: v.test, stance: v.stance ?? null, modality: v.modality ?? null, actor: "script" });
} catch (e) { fail(e.message); }

console.log("participant_id,link");
for (const r of result.rows) console.log(`${r.participant_id},${base}/s/${r.token}`);
const kst = new Date(result.expires_at.getTime() + 9 * 3600_000).toISOString().replace("T", " ").slice(0, 16);
console.error(`issued ${result.rows.length} ${result.test ? "test " : ""}link(s), batch ${v.batch}, expires ${kst} KST, db ${dbEndpoint()}`);

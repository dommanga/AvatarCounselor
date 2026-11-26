// Runs the expiry / abandonment sweep over every session now (the app also sweeps lazily on access
// and before every assignment) and prints what it changed.
//   npm run sweep

import { db } from "../lib/db.js";
import { sweep } from "../lib/lifecycle.js";
import { dbEndpoint } from "./cli.js";

const sql = db();
const [{ last }] = await sql`SELECT coalesce(max(id), 0) AS last FROM audit_log`;
await sweep(null);
const rows = await sql`
  SELECT a.action, s.participant_id, a.slot_seq, a.detail FROM audit_log a LEFT JOIN sessions s ON s.id = a.session_id
  WHERE a.id > ${last} ORDER BY a.id`;
console.log(`db: ${dbEndpoint()} — ${rows.length} change(s)`);
for (const r of rows) console.log(`  ${r.action} ${r.participant_id ?? ""} ${r.slot_seq ?? ""} ${r.detail ? JSON.stringify(r.detail) : ""}`);

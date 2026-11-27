// Drops every Study 1 table (and the pilot-era ones) and re-applies lib/schema.sql. Destroys all data:
// archive first (pg_dump / Neon branch).
//   npm run db:reset -- --host <neon endpoint id>        (dev / test branch)
//   npm run db:reset -- --prod                           (main branch: the number of sessions is typed in at the terminal)

import fs from "fs";
import { parseArgs } from "node:util";
import { db } from "../lib/db.js";
import { guardDestructive } from "./cli.js";

const { values } = parseArgs({ options: { host: { type: "string" }, prod: { type: "boolean", default: false } } });

const TABLES = [
  "audit_log", "audio_chunks", "answer_segments", "responses", "feedback_timing", "feedback_audio", "answers", "events", "slot_assignments",
  "session_clients", "sessions", "slots", "slot_meta", "cell_targets", "admin_login_failures",
  "notes", "block_sequence", // pilot-era
];
const sql = db();
await guardDestructive({
  host: values.host, prod: values.prod, what: "sessions that will be destroyed",
  count: async () => (await sql`SELECT CASE WHEN to_regclass('sessions') IS NULL THEN 0 ELSE (SELECT count(*)::int FROM sessions) END AS n`)[0].n,
});
for (const t of TABLES) await sql.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
console.log(`dropped: ${TABLES.join(", ")}`);

const ddl = fs.readFileSync(new URL("../lib/schema.sql", import.meta.url), "utf8");
const statements = ddl.replace(/--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean);
for (const stmt of statements) await sql.query(stmt);
console.log(`schema: ${statements.length} statements applied`);

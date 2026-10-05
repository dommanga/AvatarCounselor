// Creates the schema and, if empty, fills block_sequence: 10 blocks x 3 slots, each block an
// independent random permutation of the 3 conditions. Safe to re-run — never regenerates an
// existing sequence.
//   npm run db:init        (reads DATABASE_URL from .env.local)

import crypto from "crypto";
import fs from "fs";
import { db } from "../lib/db.js";
import { CONDITIONS } from "../src/questions.js";

const BLOCKS = 10;

function permutation(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const sql = db();
const ddl = fs.readFileSync(new URL("../lib/schema.sql", import.meta.url), "utf8");
// strip comments first: they contain ';' and would otherwise break the naive split
const statements = ddl.replace(/--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean);
for (const stmt of statements) await sql.query(stmt);
console.log(`schema: ${statements.length} statements applied`);

const [{ n }] = await sql`SELECT count(*)::int AS n FROM block_sequence`;
if (n > 0) {
  console.log(`block_sequence already has ${n} slots — left unchanged`);
} else {
  const rows = [];
  for (let b = 1; b <= BLOCKS; b++) {
    permutation(CONDITIONS).forEach((c, i) => rows.push({ slot: (b - 1) * 3 + i + 1, block: b, condition: c }));
  }
  await sql.transaction(rows.map((r) =>
    sql`INSERT INTO block_sequence (slot, block, condition) VALUES (${r.slot}, ${r.block}, ${r.condition})`));
  console.log(`block_sequence: generated ${rows.length} slots`);
}

const seq = await sql`SELECT block, condition FROM block_sequence ORDER BY slot`;
for (let b = 1; b <= BLOCKS; b++) {
  console.log(`  block ${String(b).padStart(2)}: ${seq.filter((r) => r.block === b).map((r) => r.condition).join(" → ")}`);
}

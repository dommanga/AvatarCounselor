// Generates the condition slot sequence once: SLOT_BLOCKS blocks, each a seeded permutation of the
// 6 stance x modality cells. Refuses if a sequence already exists. Prints and stores the seed.
//   npm run gen-slots -- --host <neon endpoint id> [--seed <hex>]     (dev / test branch)
//   npm run gen-slots -- --prod [--seed <hex>]                        (main branch: the slot count is typed in at the terminal)

import crypto from "crypto";
import { parseArgs } from "node:util";
import { db } from "../lib/db.js";
import { generateSlots, ALGORITHM, CELLS } from "../lib/slots.js";
import { SLOT_BLOCKS, SLOT_BLOCK_SIZE } from "../lib/config.js";
import { dbEndpoint, fail, guardDestructive } from "./cli.js";

const { values } = parseArgs({ options: { seed: { type: "string" }, host: { type: "string" }, prod: { type: "boolean", default: false } } });
if (CELLS.length !== SLOT_BLOCK_SIZE) fail(`cells (${CELLS.length}) != SLOT_BLOCK_SIZE (${SLOT_BLOCK_SIZE})`);

await guardDestructive({ host: values.host, prod: values.prod, what: "slots to be generated", count: SLOT_BLOCKS * SLOT_BLOCK_SIZE });
const sql = db();
const [{ n }] = await sql`SELECT count(*)::int AS n FROM slots`;
if (n > 0) fail(`slots already exist (${n}) on ${dbEndpoint()} — left unchanged`);

const seed = values.seed || crypto.randomBytes(32).toString("hex");
const rows = generateSlots(seed, SLOT_BLOCKS);
await sql.transaction([
  sql`INSERT INTO slot_meta (id, seed, block_size, blocks, algorithm) VALUES (1, ${seed}, ${SLOT_BLOCK_SIZE}, ${SLOT_BLOCKS}, ${ALGORITHM})`,
  sql`INSERT INTO slots (seq, block, stance, modality)
      SELECT * FROM unnest(${rows.map((r) => r.seq)}::int[], ${rows.map((r) => r.block)}::int[],
                           ${rows.map((r) => r.stance)}::text[], ${rows.map((r) => r.modality)}::text[])`,
  sql`INSERT INTO audit_log (actor, action, detail)
      VALUES ('script', 'slots_generated', ${JSON.stringify({ seed, blocks: SLOT_BLOCKS, block_size: SLOT_BLOCK_SIZE })}::jsonb)`,
]);

console.log(`db: ${dbEndpoint()}`);
console.log(`seed: ${seed}`);
console.log(`slots: ${rows.length} (${SLOT_BLOCKS} blocks x ${SLOT_BLOCK_SIZE})`);
for (const b of [1, 2, SLOT_BLOCKS]) {
  console.log(`  block ${String(b).padStart(2)}: ${rows.filter((r) => r.block === b).map((r) => `${r.stance}/${r.modality}`).join("  ")}`);
}

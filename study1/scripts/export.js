// Exports the data as one zip (the same code as the /admin export button: lib/export.js). Read-only.
//   npm run export [-- --out exports/file.zip] [--include-incomplete] [--include-test]
// Default: completed, non-test sessions. The zip holds CSVs (UTF-8 with BOM), codebook, survey_items.json and manifest.json.
// Answer transcripts may contain proper nouns the participant said; keep the file with the research data, not in the repo.

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { exportZip } from "../lib/export.js";
import { dbEndpoint } from "./cli.js";

const { values: v } = parseArgs({ options: { out: { type: "string" }, "include-incomplete": { type: "boolean", default: false }, "include-test": { type: "boolean", default: false } } });
const { zip, manifest, name } = await exportZip({ includeIncomplete: v["include-incomplete"], includeTest: v["include-test"], actor: "script" });
const out = path.resolve(v.out || path.join("exports", name));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, zip);
console.log(`db: ${dbEndpoint()}  export_schema ${manifest.export_schema}  filter ${JSON.stringify(manifest.filter)}`);
for (const [f, m] of Object.entries(manifest.files)) if (m.rows !== undefined) console.log(`  ${f}: ${m.rows} row(s)`);
console.log(`${out} (${zip.length} bytes)`);

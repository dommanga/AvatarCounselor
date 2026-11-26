// Deletes the data of participants who chose 'destroy' at consent and ended without completing
// (sessions.destroy_pending): responses, answers, answer segments, events, tab records, audio.
// Keeps the session row (status, condition) and slot_assignments; logs each session in audit_log.
// Never runs automatically.
//   npm run purge-withdrawn [-- --dry-run]
// Audio blobs need Blob credentials, as in scripts/purge-audio.js.

import { parseArgs } from "node:util";
import { purgeWithdrawn } from "../lib/purge.js";
import { dbEndpoint } from "./cli.js";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
const rows = await purgeWithdrawn({ dryRun: values["dry-run"] });
console.log(`db: ${dbEndpoint()}${values["dry-run"] ? " (dry run — nothing deleted)" : ""}`);
if (!rows.length) console.log("no withdrawn sessions pending");
for (const r of rows) {
  console.log(`  ${r.participant_id} (${r.status}): ${Object.entries(r.deleted).map(([t, n]) => `${t}=${n}`).join(" ")}`);
}

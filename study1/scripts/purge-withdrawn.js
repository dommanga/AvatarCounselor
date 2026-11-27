// Deletes the data of participants who chose 'destroy' at consent and ended without completing
// (sessions.destroy_pending): responses, answers, answer segments, events, tab records, audio.
// Keeps the session row (status, condition) and slot_assignments; logs each session in audit_log.
// Two steps, never automatic:
//   npm run purge-withdrawn -- --plan [--batch W1] [--include-test] [--out file]       lists the sessions and rows that would go, writes purge-plans/withdrawn-*.json
//   npm run purge-withdrawn -- --dry-run                 prints the same list without writing a file
//   npm run purge-withdrawn -- --execute <plan file> --host <endpoint>   [--prod on the main branch]
// --execute processes only the sessions in the plan; one whose data changed since is skipped and reported.
// Audio blobs need Blob credentials, as in scripts/purge-audio.js.

import { runPurgeCli } from "./purge-cli.js";
await runPurgeCli("withdrawn");

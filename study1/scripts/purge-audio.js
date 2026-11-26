// Destroys the audio blobs of sessions whose transcripts have been checked (sessions.audio_verified_at),
// as the consent form requires. audio_chunks rows stay (purged_at set); each session is logged in audit_log.
//   npm run purge-audio [-- --dry-run]
// Needs Blob credentials: `vercel env pull .env.blob --environment=preview` (or production) and run with
//   node --env-file=.env --env-file=.env.blob scripts/purge-audio.js

import { parseArgs } from "node:util";
import { purgeVerifiedAudio } from "../lib/purge.js";
import { dbEndpoint } from "./cli.js";

const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
const rows = await purgeVerifiedAudio({ dryRun: values["dry-run"] });
console.log(`db: ${dbEndpoint()}${values["dry-run"] ? " (dry run — nothing deleted)" : ""}`);
if (!rows.length) console.log("no verified sessions with audio left to purge");
for (const r of rows) console.log(`  ${r.participant_id}: ${r.chunks} chunk(s), ${r.bytes} bytes`);

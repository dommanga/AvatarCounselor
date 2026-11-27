// Destroys the audio blobs of sessions whose transcripts have been checked (sessions.audio_verified_at),
// as the consent form requires. audio_chunks rows stay (purged_at set); each session is logged in audit_log.
// Two steps, never automatic:
//   npm run purge-audio -- --plan [--out file]           lists the sessions and chunks that would go, writes purge-plans/audio-*.json
//   npm run purge-audio -- --dry-run                     prints the same list without writing a file
//   npm run purge-audio -- --execute <plan file> --host <endpoint>   [--prod on the main branch]
// Needs Blob credentials: `vercel env pull .env.blob --environment=preview` (or production) and run with
//   node --env-file=.env --env-file=.env.blob scripts/purge-audio.js --plan ...

import { runPurgeCli } from "./purge-cli.js";
await runPurgeCli("audio");

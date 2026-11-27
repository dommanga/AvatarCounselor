// Data destruction run by the researcher (never automatically):
//  - purgeVerifiedAudio: consent form — audio is destroyed once its transcript has been checked
//    (sessions.audio_verified_at). Blobs go; audio_chunks rows stay as the record (purged_at).
//  - purgeWithdrawn: participants who chose 'destroy' and ended without completing (destroy_pending).
//    Their responses, answers, segments, events, tab records and audio go; the session row with its
//    status and condition plus slot_assignments stay, since the assignment bookkeeping needs them.
// Blob credentials: BLOB_STORE_ID + VERCEL_OIDC_TOKEN (vercel env pull), or BLOB_READ_WRITE_TOKEN.

import { db } from "./db.js";

async function deleteBlobs(pathnames) {
  if (!pathnames.length) return;
  const { del } = await import("@vercel/blob");
  for (let i = 0; i < pathnames.length; i += 100) await del(pathnames.slice(i, i + 100));
}

// -> [{ participant_id, chunks, bytes }]
// only: restrict to these session ids (tests pass the sessions they created, so they cannot touch anyone else's data)
export async function purgeVerifiedAudio({ dryRun = false, only = null } = {}) {
  const sql = db();
  const sessions = await sql`
    SELECT id, participant_id FROM sessions
    WHERE audio_verified_at IS NOT NULL AND audio_purged_at IS NULL AND (${only}::uuid[] IS NULL OR id = ANY(${only}::uuid[]))
    ORDER BY participant_id`;
  const out = [];
  for (const s of sessions) {
    const chunks = await sql`
      SELECT question_id, attempt, seq, pathname, bytes FROM audio_chunks
      WHERE session_id = ${s.id} AND purged_at IS NULL`;
    const bytes = chunks.reduce((n, c) => n + c.bytes, 0);
    out.push({ participant_id: s.participant_id, chunks: chunks.length, bytes });
    if (dryRun) continue;
    await deleteBlobs(chunks.map((c) => c.pathname));
    await sql.transaction([
      sql`UPDATE audio_chunks SET purged_at = now() WHERE session_id = ${s.id} AND purged_at IS NULL`,
      sql`UPDATE sessions SET audio_purged_at = now(), updated_at = now() WHERE id = ${s.id}`,
      sql`INSERT INTO audit_log (actor, action, session_id, detail)
          VALUES ('script', 'audio_purged', ${s.id}, ${JSON.stringify({ chunks: chunks.length, bytes })}::jsonb)`,
    ]);
  }
  return out;
}

const DATA_TABLES = ["responses", "feedback_timing", "feedback_audio", "answers", "answer_segments", "events", "session_clients", "audio_chunks"];

// -> [{ participant_id, status, deleted: { table: rows } }]
export async function purgeWithdrawn({ dryRun = false, only = null } = {}) {
  const sql = db();
  const sessions = await sql`
    SELECT id, participant_id, status FROM sessions
    WHERE destroy_pending AND data_purged_at IS NULL AND (${only}::uuid[] IS NULL OR id = ANY(${only}::uuid[]))
    ORDER BY participant_id`;
  const out = [];
  for (const s of sessions) {
    const deleted = {};
    for (const t of DATA_TABLES) {
      const [{ n }] = await sql.query(`SELECT count(*)::int AS n FROM ${t} WHERE session_id = $1`, [s.id]);
      deleted[t] = n;
    }
    out.push({ participant_id: s.participant_id, status: s.status, deleted });
    if (dryRun) continue;
    const blobs = await sql`SELECT pathname FROM audio_chunks WHERE session_id = ${s.id} AND purged_at IS NULL`;
    const spoken = await sql`SELECT pathname FROM feedback_audio WHERE session_id = ${s.id}`; // the voice feedback file
    await deleteBlobs([...blobs, ...spoken].map((b) => b.pathname));
    await sql.transaction([
      ...DATA_TABLES.map((t) => sql.query(`DELETE FROM ${t} WHERE session_id = $1`, [s.id])),
      sql`UPDATE sessions SET data_purged_at = now(), audio_purged_at = coalesce(audio_purged_at, now()), updated_at = now()
          WHERE id = ${s.id}`,
      sql`INSERT INTO audit_log (actor, action, session_id, detail)
          VALUES ('script', 'withdrawn_data_purged', ${s.id}, ${JSON.stringify({ deleted })}::jsonb)`,
    ]);
  }
  return out;
}

// Data destruction run by the researcher (never automatically), always in two steps:
//   1. plan*  : read-only. Lists the sessions that qualify now (session id, participant_id, rows / chunks to delete).
//   2. executePlan(plan): processes exactly the sessions of that plan. A session whose state changed since the plan
//      (flags, row counts) is skipped and reported. There is no code path that purges "everything that qualifies".
//  - audio plan: the researcher chooses the scope (all / one batch / chosen sessions) and the time; nothing about the
//    voice check (stt_quality) is a condition. Blobs go; audio_chunks rows stay as the record (purged_at).
//  - withdrawn plan: participants who chose 'destroy' and ended without completing (destroy_pending).
//    Their responses, answers, segments, events, tab records and audio go; the session row with its
//    status and condition plus slot_assignments stay, since the assignment bookkeeping needs them.
// Blob credentials: BLOB_STORE_ID + VERCEL_OIDC_TOKEN (vercel env pull), or BLOB_READ_WRITE_TOKEN.

import { db } from "./db.js";

async function deleteBlobs(pathnames) {
  if (!pathnames.length) return;
  const { del } = await import("@vercel/blob");
  for (let i = 0; i < pathnames.length; i += 100) await del(pathnames.slice(i, i + 100));
}

const endpointOfEnv = () => new URL(process.env.DATABASE_URL).hostname.split(".")[0].replace(/-pooler$/, "");
const DATA_TABLES = ["responses", "feedback_timing", "feedback_audio", "answers", "answer_segments", "events", "session_clients", "audio_chunks"];

async function audioState(sql, id) {
  const chunks = await sql`SELECT pathname, bytes FROM audio_chunks WHERE session_id = ${id} AND purged_at IS NULL`;
  return { chunks, count: chunks.length, bytes: chunks.reduce((n, c) => n + c.bytes, 0) };
}
async function rowCounts(sql, id) {
  const rows = {};
  for (const t of DATA_TABLES) rows[t] = (await sql.query(`SELECT count(*)::int AS n FROM ${t} WHERE session_id = $1`, [id]))[0].n;
  return rows;
}
// Scope of a plan: only = these session ids (tests, /admin 'selected'); batch = one batch; includeTest = test sessions too
// (without `only`, test sessions are left out). ttlMs: /admin plans expire (30 minutes), command-line plans do not.
export const PLAN_TTL_MS = 30 * 60_000;
const newPlan = (kind, sessions, { only = null, batch = null, includeTest = false } = {}, ttlMs = null) => ({
  kind, db_endpoint: endpointOfEnv(), created_at: new Date().toISOString(),
  ...(ttlMs && { expires_at: new Date(Date.now() + ttlMs).toISOString() }),
  scope: { mode: only ? "sessions" : batch ? "batch" : "all", batch, include_test: includeTest, ...(only && { ids: only }) }, sessions,
});
const scopeSql = (sql, { only, batch, includeTest }) => sql`(${only}::uuid[] IS NULL OR id = ANY(${only}::uuid[]))
  AND (${batch}::text IS NULL OR batch_id = ${batch}) AND (${includeTest}::boolean OR ${only}::uuid[] IS NOT NULL OR NOT is_test)`;

export async function planAudio({ only = null, batch = null, includeTest = false, ttlMs = null } = {}) {
  const sql = db();
  const sessions = await sql`
    SELECT id, participant_id, issued_at FROM sessions s
    WHERE EXISTS (SELECT 1 FROM audio_chunks c WHERE c.session_id = s.id AND c.purged_at IS NULL)
      AND ${scopeSql(sql, { only, batch, includeTest })}
    ORDER BY participant_id`;
  const out = [];
  for (const s of sessions) {
    const a = await audioState(sql, s.id);
    out.push({ id: s.id, participant_id: s.participant_id, issued_at: s.issued_at, chunks: a.count, bytes: a.bytes });
  }
  return newPlan("audio", out, { only, batch, includeTest }, ttlMs);
}

export async function planWithdrawn({ only = null, batch = null, includeTest = false, ttlMs = null } = {}) {
  const sql = db();
  const sessions = await sql`
    SELECT id, participant_id, status, issued_at FROM sessions
    WHERE destroy_pending AND data_purged_at IS NULL AND ${scopeSql(sql, { only, batch, includeTest })}
    ORDER BY participant_id`;
  const out = [];
  for (const s of sessions) out.push({ id: s.id, participant_id: s.participant_id, status: s.status, issued_at: s.issued_at, deleted: await rowCounts(sql, s.id) });
  return newPlan("withdrawn", out, { only, batch, includeTest }, ttlMs);
}

export function checkPlan(plan) {
  if (!plan || !["audio", "withdrawn"].includes(plan.kind) || !Array.isArray(plan.sessions) || !plan.db_endpoint || !plan.created_at) throw new Error("not a purge plan");
  if (plan.expires_at && new Date(plan.expires_at) < new Date()) throw new Error("plan expired: make a new one");
  if (plan.db_endpoint !== endpointOfEnv()) throw new Error(`plan was made for ${plan.db_endpoint}, DATABASE_URL points at ${endpointOfEnv()}`);
  return plan;
}

// -> { done: [...], skipped: [{ participant_id, reason }] }
export async function executePlan(plan) {
  checkPlan(plan);
  const sql = db();
  const done = [], skipped = [];
  for (const p of plan.sessions) {
    const [s] = await sql`SELECT participant_id, status, destroy_pending, data_purged_at FROM sessions WHERE id = ${p.id}`;
    if (!s || s.participant_id !== p.participant_id) { skipped.push({ participant_id: p.participant_id, reason: "session not found" }); continue; }
    if (plan.kind === "audio") {
      const a = await audioState(sql, p.id);
      if (!a.count) { skipped.push({ participant_id: p.participant_id, reason: "no audio left (already purged)" }); continue; }
      if (a.count !== p.chunks || a.bytes !== p.bytes) { skipped.push({ participant_id: p.participant_id, reason: `audio changed since the plan (${p.chunks} -> ${a.count} chunks)` }); continue; }
      await deleteBlobs(a.chunks.map((c) => c.pathname));
      await sql.transaction([
        sql`UPDATE audio_chunks SET purged_at = now() WHERE session_id = ${p.id} AND purged_at IS NULL`,
        sql`UPDATE sessions SET audio_purged_at = now(), updated_at = now() WHERE id = ${p.id}`,
        sql`INSERT INTO audit_log (actor, action, session_id, detail)
            VALUES ('script', 'audio_purged', ${p.id}, ${JSON.stringify({ chunks: a.count, bytes: a.bytes })}::jsonb)`,
      ]);
      done.push({ participant_id: p.participant_id, chunks: a.count, bytes: a.bytes });
    } else {
      if (!s.destroy_pending || s.data_purged_at) { skipped.push({ participant_id: p.participant_id, reason: "no longer pending / already purged" }); continue; }
      const deleted = await rowCounts(sql, p.id);
      if (JSON.stringify(deleted) !== JSON.stringify(p.deleted) || s.status !== p.status) { skipped.push({ participant_id: p.participant_id, reason: "data or status changed since the plan" }); continue; }
      const blobs = await sql`SELECT pathname FROM audio_chunks WHERE session_id = ${p.id} AND purged_at IS NULL`;
      const spoken = await sql`SELECT pathname FROM feedback_audio WHERE session_id = ${p.id}`; // the voice feedback file
      await deleteBlobs([...blobs, ...spoken].map((b) => b.pathname));
      await sql.transaction([
        ...DATA_TABLES.map((t) => sql.query(`DELETE FROM ${t} WHERE session_id = $1`, [p.id])),
        sql`UPDATE sessions SET data_purged_at = now(), audio_purged_at = coalesce(audio_purged_at, now()), updated_at = now() WHERE id = ${p.id}`,
        sql`INSERT INTO audit_log (actor, action, session_id, detail)
            VALUES ('script', 'withdrawn_data_purged', ${p.id}, ${JSON.stringify({ deleted })}::jsonb)`,
      ]);
      done.push({ participant_id: p.participant_id, status: s.status, deleted });
    }
  }
  return { done, skipped };
}

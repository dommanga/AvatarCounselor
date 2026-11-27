// /admin data screens: voice check (STT quality verdict), purge (plan -> typed count -> execute), export.
// Same rules as lib/admin.js: no personal data, every change needs a reason or is logged, purge only through a stored plan.

import crypto from "crypto";
import { db } from "./db.js";
import { planAudio, planWithdrawn, executePlan, PLAN_TTL_MS } from "./purge.js";

const httpError = (status, message) => Object.assign(new Error(message), { status });
export const STT_QUALITY = ["none", "minor", "severe"];
const MAX_AUDIO_BYTES = 4 * 1024 * 1024; // Vercel function response limit is 4.5 MB

// ---------- voice check ----------
// Sessions with audio on file (not destroyed). judged = false: not judged yet; true: judged too.
export async function sttList({ includeTest = false, includeJudged = false } = {}) {
  return db()`
    SELECT s.id, s.participant_id, s.batch_id, s.is_test, s.status, s.stance, s.modality, s.stt_quality, s.stt_judged_at, s.audio_purged_at,
           (SELECT count(*)::int FROM audio_chunks c WHERE c.session_id = s.id AND c.purged_at IS NULL) AS chunks,
           (SELECT coalesce(sum(c.bytes), 0)::int FROM audio_chunks c WHERE c.session_id = s.id AND c.purged_at IS NULL) AS bytes
    FROM sessions s
    WHERE EXISTS (SELECT 1 FROM audio_chunks c WHERE c.session_id = s.id AND c.purged_at IS NULL)
      AND (${includeTest}::boolean OR NOT s.is_test) AND (${includeJudged}::boolean OR s.stt_judged_at IS NULL)
    ORDER BY s.participant_id`;
}

export async function sttSession(id) {
  const sql = db();
  const [s] = await sql`SELECT id, participant_id, batch_id, is_test, status, stt_quality, stt_note, stt_judged_at, audio_purged_at FROM sessions WHERE id = ${id}`;
  if (!s) throw httpError(404, "세션을 찾을 수 없습니다.");
  const [answers, segments, audio, restarts] = await Promise.all([
    sql`SELECT question_id, attempt, status, transcript, answer_truncated, answer_short, created_at FROM answers WHERE session_id = ${id} AND question_id <> 'practice' ORDER BY id`,
    sql`SELECT question_id, attempt, seq, text, server_ts FROM answer_segments WHERE session_id = ${id} AND question_id <> 'practice' ORDER BY question_id, attempt, seq`,
    sql`SELECT question_id, attempt, count(*)::int AS chunks, sum(bytes)::int AS bytes, min(server_ts) AS first_at, max(server_ts) AS last_at
        FROM audio_chunks WHERE session_id = ${id} AND purged_at IS NULL GROUP BY question_id, attempt ORDER BY question_id, attempt`,
    sql`SELECT question_id, count(*)::int AS n FROM events WHERE session_id = ${id} AND type = 'stt_restart' GROUP BY question_id`,
  ]);
  return { session: s, answers, segments, audio, stt_restarts: restarts, stt_restart_total: restarts.reduce((n, r) => n + r.n, 0) };
}

// The chunks of one attempt, joined in order. -> { binary, mime }
export async function sttAudio({ id, question_id, attempt }) {
  const chunks = await db()`SELECT pathname, bytes, mime FROM audio_chunks
    WHERE session_id = ${id} AND question_id = ${question_id} AND attempt = ${attempt} AND purged_at IS NULL ORDER BY seq`;
  if (!chunks.length) throw httpError(404, "원음이 없습니다.");
  if (chunks.reduce((n, c) => n + c.bytes, 0) > MAX_AUDIO_BYTES) throw httpError(413, "원음이 너무 커서 이 화면에서 재생할 수 없습니다.");
  const { get } = await import("@vercel/blob");
  const parts = [];
  for (const c of chunks) {
    const r = await get(c.pathname, { access: "private", useCache: false });
    if (!r || r.statusCode !== 200) throw httpError(404, "원음 조각을 읽을 수 없습니다.");
    parts.push(Buffer.from(await new Response(r.stream).arrayBuffer()));
  }
  return { binary: Buffer.concat(parts), mime: chunks[0].mime || "audio/webm" };
}

export async function sttJudge({ id, quality, note }) {
  if (!STT_QUALITY.includes(quality)) throw httpError(400, "오인식 정도를 선택해 주세요.");
  const memo = String(note ?? "").trim().slice(0, 1000) || null;
  const sql = db();
  const [s] = await sql`SELECT stt_quality, stt_note FROM sessions WHERE id = ${id}`;
  if (!s) throw httpError(404, "세션을 찾을 수 없습니다.");
  const [has] = await sql`SELECT EXISTS (SELECT 1 FROM audio_chunks WHERE session_id = ${id}) AS ok`;
  if (!has.ok) throw httpError(409, "원음이 기록된 적이 없는 세션입니다.");
  await sql.transaction([
    sql`UPDATE sessions SET stt_quality = ${quality}, stt_note = ${memo}, stt_judged_at = now(), updated_at = now() WHERE id = ${id}`,
    sql`INSERT INTO audit_log (actor, action, session_id, detail)
        VALUES ('admin', 'stt_judged', ${id}, ${JSON.stringify({ quality, note: memo, previous: s.stt_quality ? { quality: s.stt_quality, note: s.stt_note } : null })}::jsonb)`,
  ]);
  return { quality };
}

// ---------- purge ----------
const PLANNERS = { audio: planAudio, withdrawn: planWithdrawn };

// What would qualify now (read-only), for choosing sessions. scope is applied by the plan.
export async function purgeCandidates({ kind, includeTest = false }) {
  if (!PLANNERS[kind]) throw httpError(400, "파기 종류가 올바르지 않습니다.");
  const plan = await PLANNERS[kind]({ includeTest });
  const batches = await db()`SELECT id, batch_id FROM sessions WHERE id = ANY(${plan.sessions.map((s) => s.id)}::uuid[])`;
  const batchOf = new Map(batches.map((b) => [b.id, b.batch_id]));
  return { kind, sessions: plan.sessions.map((s) => ({ ...s, batch_id: batchOf.get(s.id) })) };
}

// scope: { mode: 'all' | 'batch' | 'sessions', batch, ids, include_test }. The plan is stored; the response carries its id.
export async function purgePreview({ kind, scope = {} }) {
  if (!PLANNERS[kind]) throw httpError(400, "파기 종류가 올바르지 않습니다.");
  const mode = scope.mode;
  if (!["all", "batch", "sessions"].includes(mode)) throw httpError(400, "범위를 선택해 주세요.");
  if (mode === "batch" && !String(scope.batch || "").trim()) throw httpError(400, "batch를 선택해 주세요.");
  if (mode === "sessions" && (!Array.isArray(scope.ids) || !scope.ids.length || !scope.ids.every((i) => /^[0-9a-f-]{36}$/i.test(i)))) throw httpError(400, "세션을 선택해 주세요.");
  const plan = await PLANNERS[kind]({
    only: mode === "sessions" ? scope.ids : null, batch: mode === "batch" ? String(scope.batch).trim() : null, includeTest: !!scope.include_test, ttlMs: PLAN_TTL_MS,
  });
  const planId = crypto.randomUUID();
  const sql = db();
  await sql.transaction([
    sql`INSERT INTO purge_plans (id, kind, plan, expires_at) VALUES (${planId}, ${kind}, ${JSON.stringify(plan)}::jsonb, ${plan.expires_at})`,
    sql`INSERT INTO audit_log (actor, action, detail) VALUES ('admin', 'purge_planned',
        ${JSON.stringify({ plan_id: planId, kind, scope: plan.scope, count: plan.sessions.length, sessions: plan.sessions.map((s) => s.participant_id) })}::jsonb)`,
  ]);
  return { plan_id: planId, kind, expires_at: plan.expires_at, scope: plan.scope, count: plan.sessions.length, sessions: plan.sessions };
}

// The only way /admin destroys anything: a stored plan + the number of its sessions typed in by the researcher.
export async function purgeExecute({ plan_id, count }) {
  const sql = db();
  const [row] = await sql`SELECT id, kind, plan, expires_at, executed_at FROM purge_plans WHERE id = ${String(plan_id)}::uuid`.catch(() => []);
  if (!row) throw httpError(404, "plan을 찾을 수 없습니다. 대상을 다시 미리보기 해 주세요.");
  if (row.executed_at) throw httpError(409, "이미 실행된 plan입니다.");
  if (new Date(row.expires_at) < new Date()) throw httpError(410, "plan이 만료되었습니다 (30분). 다시 미리보기 해 주세요.");
  const n = row.plan.sessions.length;
  if (!n) throw httpError(409, "대상이 없습니다.");
  if (String(count ?? "").trim() !== String(n)) throw httpError(400, "대상 수가 맞지 않습니다. 입력한 수가 plan의 세션 수와 같아야 합니다.");
  const [claimed] = await sql`UPDATE purge_plans SET executed_at = now() WHERE id = ${row.id} AND executed_at IS NULL RETURNING id`; // one execution per plan
  if (!claimed) throw httpError(409, "이미 실행된 plan입니다.");
  let result;
  try {
    result = await executePlan(row.plan);
  } catch (e) {
    await sql`UPDATE purge_plans SET executed_at = NULL WHERE id = ${row.id}`; // nothing was processed: the plan can be retried
    throw httpError(e.status || 500, e.message);
  }
  await sql.transaction([
    sql`UPDATE purge_plans SET result = ${JSON.stringify(result)}::jsonb WHERE id = ${row.id}`,
    sql`INSERT INTO audit_log (actor, action, detail) VALUES ('admin', 'purge_executed',
        ${JSON.stringify({ plan_id: row.id, kind: row.kind, plan: { created_at: row.plan.created_at, scope: row.plan.scope, sessions: row.plan.sessions.map((s) => s.participant_id) }, done: result.done.length, skipped: result.skipped })}::jsonb)`,
  ]);
  return { done: result.done, skipped: result.skipped };
}

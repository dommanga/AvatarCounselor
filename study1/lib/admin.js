// Server logic of /admin. No personal data: participant ids, link-token states, conditions, progress records.
// Every change an admin makes needs a reason and is written to audit_log (actor 'admin'). What an admin may do
// to a session is decided here once (resumeBlock / conditionBlock / extendBlock): the detail panel shows the
// buttons from the same rules the handlers enforce.

import { db, withTransaction } from "./db.js";
import { configSnapshot } from "./snapshot.js";
import { ACTIVE, pickSlot, sweep } from "./lifecycle.js";
import { CELLS } from "./slots.js";
import { MODALITIES } from "./config.js";
import { CONDITIONS } from "../src/questions.js";

export const DEFAULT_TARGET = 30;
const httpError = (status, message) => Object.assign(new Error(message), { status });

export function needReason(reason) {
  const r = String(reason ?? "").trim();
  if (r.length < 2 || r.length > 500) throw httpError(400, "사유를 입력해 주세요 (2–500자).");
  return r;
}
const checkCell = (stance, modality) => {
  if (!CONDITIONS.includes(stance) || !MODALITIES.includes(modality)) throw httpError(400, "stance 또는 modality가 올바르지 않습니다.");
};

// The participant has met the stimulus: the text was shown / the audio started.
const EXPOSED = `EXISTS (SELECT 1 FROM events e WHERE e.session_id = s.id AND e.type IN ('feedback_shown', 'audio_started'))`;
const HAS_ANSWER = `EXISTS (SELECT 1 FROM answers a WHERE a.session_id = s.id AND a.status IN ('pending', 'done', 'error'))`;

// ---------- what may be done to a session (null = allowed, otherwise the reason) ----------
export const extendBlock = (s) =>
  !s.consented_at && ["issued", "opened", "expired"].includes(s.status) ? null : "동의한 뒤에는 만료일을 연장할 수 없습니다.";
export function resumeBlock(s, exposed) {
  if (!["locked", "abandoned"].includes(s.status)) return "잠기거나 이탈한 세션이 아닙니다.";
  if (s.data_purged_at) return "데이터가 파기된 세션입니다.";
  if (exposed) return "피드백에 노출된 뒤 중단된 세션은 재개할 수 없습니다.";
  return null;
}
export function conditionBlock(s, exposed, hasAnswer) {
  if (!ACTIVE.includes(s.status)) return "진행 중인 세션에서만 바꿀 수 있습니다.";
  if (exposed) return "피드백에 노출된 세션은 조건을 바꿀 수 없습니다.";
  if (hasAnswer) return "답변이 제출된 뒤에는 바꿀 수 없습니다 (피드백이 이미 만들어집니다).";
  return null;
}

// ---------- participants ----------
export async function listParticipants() {
  await sweep(null); // expiry / abandonment are decided lazily: make the table current
  return db().query(`
    SELECT s.id, s.participant_id, s.batch_id, s.is_test, s.status, s.current_stage, s.issued_at, s.expires_at, s.opened_at, s.consented_at,
           s.last_activity_at, s.completed_at, s.valid, s.resume_count, s.retry_used, s.lock_reason, s.destroy_pending, s.data_purged_at,
           s.stance, s.modality,
           COALESCE((SELECT bool_or(a.answer_short) FROM answers a WHERE a.session_id = s.id), false) AS answer_short,
           COALESCE((SELECT bool_or(a.answer_truncated) FROM answers a WHERE a.session_id = s.id), false) AS answer_truncated,
           ${EXPOSED} AS exposed
    FROM sessions s ORDER BY s.issued_at DESC, s.participant_id DESC`);
}

export async function participantDetail(id) {
  const sql = db();
  await sweep(id);
  const [s] = await sql.query(`
    SELECT s.id, s.participant_id, s.batch_id, s.is_test, s.status, s.current_stage, s.issued_at, s.expires_at, s.opened_at, s.consented_at,
           s.last_activity_at, s.completed_at, s.ended_at, s.debriefed_at, s.valid, s.resume_count, s.retry_used, s.attempt_offset, s.lock_reason,
           s.destroy_pending, s.data_purged_at, s.stance, s.modality, s.consent_withdraw_data, s.survey_version,
           s.config -> 'app' ->> 'commit' AS commit, ${EXPOSED} AS exposed, ${HAS_ANSWER} AS has_answer
    FROM sessions s WHERE s.id = $1`, [id]);
  if (!s) throw httpError(404, "세션을 찾을 수 없습니다.");
  const [events, audit, answers, timing, assignments, blocks] = await Promise.all([
    sql`SELECT seq, type, question_id, server_ts, data FROM events WHERE session_id = ${id} ORDER BY seq LIMIT 2000`,
    sql`SELECT id, ts, actor, action, slot_seq, detail FROM audit_log WHERE session_id = ${id} ORDER BY id`,
    sql`SELECT id, question_id, attempt, status, answer_short, answer_truncated, injected, created_at, finished_at FROM answers WHERE session_id = ${id} ORDER BY id`,
    sql`SELECT modality, submitted_at, ready_at, revealed_at, ready_after_ms, reveal_after_ms, min_wait_ms, loading_ms FROM feedback_timing WHERE session_id = ${id}`,
    sql`SELECT a.id, a.slot_seq, a.source, a.assigned_at, a.returned_at, a.return_reason, a.exposed, a.dismissed_at, sl.stance, sl.modality
        FROM slot_assignments a JOIN slots sl ON sl.seq = a.slot_seq WHERE a.session_id = ${id} ORDER BY a.id`,
    sql`SELECT phase, block_id FROM responses WHERE session_id = ${id} GROUP BY phase, block_id ORDER BY phase, block_id`,
  ]);
  const { exposed, has_answer, ...session } = s;
  return {
    session: { ...session, exposed },
    events, audit, answers, timing: timing[0] ?? null, assignments, blocks,
    actions: {
      extend: { why: extendBlock(s) },
      resume: { why: resumeBlock(s, exposed) },
      condition: { why: conditionBlock(s, exposed, has_answer) },
    },
  };
}

// ---------- changes to one session ----------
export async function extendExpiry({ id, expires_at, reason }) {
  const why = needReason(reason);
  const until = new Date(expires_at);
  if (Number.isNaN(until.getTime()) || until <= new Date()) throw httpError(400, "새 만료일은 지금보다 뒤여야 합니다.");
  return withTransaction(async (c) => {
    const { rows: [s] } = await c.query("SELECT * FROM sessions WHERE id = $1 FOR UPDATE", [id]);
    if (!s) throw httpError(404, "세션을 찾을 수 없습니다.");
    const block = extendBlock(s);
    if (block) throw httpError(409, block);
    // an expired link opens again as what it was before: never opened = issued
    await c.query(`UPDATE sessions SET expires_at = $2, updated_at = now(),
                          status = CASE WHEN status = 'expired' THEN (CASE WHEN opened_at IS NULL THEN 'issued' ELSE 'opened' END) ELSE status END,
                          ended_at = CASE WHEN status = 'expired' THEN NULL ELSE ended_at END
                   WHERE id = $1`, [id, until.toISOString()]);
    await c.query("INSERT INTO audit_log (actor, action, session_id, detail) VALUES ('admin', 'expiry_extended', $1, $2)",
      [id, JSON.stringify({ reason: why, from: s.expires_at, to: until.toISOString(), was: s.status })]);
    return { expires_at: until.toISOString() };
  });
}

// A locked / abandoned session that has not met the stimulus goes on from where it stopped: a new slot is assigned the
// normal way (refill queue first), the pre-survey answers stay, the re-answer chance and the resume count start over.
export async function resumeSession({ id, reason }) {
  const why = needReason(reason);
  return withTransaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext('study1_assign'))"); // slots are handed out one at a time
    const { rows: [s] } = await c.query("SELECT * FROM sessions WHERE id = $1 FOR UPDATE", [id]);
    if (!s) throw httpError(404, "세션을 찾을 수 없습니다.");
    const { rows: [{ exposed }] } = await c.query(`SELECT ${EXPOSED.replace(/s\.id/g, "$1::uuid")} AS exposed`, [id]);
    const block = resumeBlock(s, exposed);
    if (block) throw httpError(409, block);

    let stance = s.stance, modality = s.modality, slot = null;
    if (!s.is_test) {
      const { rows: active } = await c.query("SELECT 1 FROM slot_assignments WHERE session_id = $1 AND returned_at IS NULL", [id]);
      if (!active.length) {
        slot = await pickSlot(c, id);
        if (!slot) throw httpError(409, "배정할 슬롯이 남아 있지 않습니다.");
        ({ stance, modality } = slot);
      }
    }
    const { rows: answered } = await c.query("SELECT 1 FROM answers WHERE session_id = $1 AND status IN ('pending', 'done', 'error') LIMIT 1", [id]);
    // With an answer on file (its feedback may only be missing the audio) the attempt number stays; without one a fresh attempt starts.
    const offset = s.attempt_offset + (answered.length ? (s.retry_used ? 1 : 0) : (s.retry_used ? 2 : 1));
    const cellChanged = stance !== s.stance || modality !== s.modality;
    await c.query(`
      UPDATE sessions SET status = 'in_progress', lock_reason = NULL, ended_at = NULL, resume_count = 0, retry_used = false,
             retry_granted_at = now(), attempt_offset = $2, active_client_key = NULL, client_released = false, client_seen_at = NULL,
             last_activity_at = now(), destroy_pending = false, stance = $3, modality = $4,
             config = CASE WHEN $5::boolean THEN $6::jsonb ELSE config END, updated_at = now()
      WHERE id = $1`, [id, offset, stance, modality, cellChanged, JSON.stringify(configSnapshot(stance, modality))]);
    await c.query("INSERT INTO audit_log (actor, action, session_id, slot_seq, detail) VALUES ('admin', 'resumed', $1, $2, $3)",
      [id, slot?.seq ?? null, JSON.stringify({
        reason: why, was: { status: s.status, lock_reason: s.lock_reason, stage: s.current_stage },
        cell: { from: { stance: s.stance, modality: s.modality }, to: { stance, modality } }, attempt_offset: offset,
        ...(cellChanged && { previous_config: s.config }),
      })]);
    return { status: "in_progress", slot: slot?.seq ?? null, stance, modality };
  });
}

export async function changeCondition({ id, stance, modality, reason }) {
  const why = needReason(reason);
  checkCell(stance, modality);
  return withTransaction(async (c) => {
    const { rows: [s] } = await c.query("SELECT * FROM sessions WHERE id = $1 FOR UPDATE", [id]);
    if (!s) throw httpError(404, "세션을 찾을 수 없습니다.");
    const { rows: [f] } = await c.query(`SELECT ${EXPOSED.replace(/s\.id/g, "$1::uuid")} AS exposed, ${HAS_ANSWER.replace(/s\.id/g, "$1::uuid")} AS has_answer`, [id]);
    const block = conditionBlock(s, f.exposed, f.has_answer);
    if (block) throw httpError(409, block);
    if (s.stance === stance && s.modality === modality) throw httpError(400, "지금과 같은 조건입니다.");
    await c.query("UPDATE sessions SET stance = $2, modality = $3, config = $4::jsonb, updated_at = now() WHERE id = $1",
      [id, stance, modality, JSON.stringify(configSnapshot(stance, modality))]);
    await c.query("INSERT INTO audit_log (actor, action, session_id, detail) VALUES ('admin', 'condition_changed', $1, $2)",
      [id, JSON.stringify({ reason: why, from: { stance: s.stance, modality: s.modality }, to: { stance, modality }, previous_config: s.config })]);
    return { stance, modality };
  });
}

// ---------- cells ----------
export async function cellStats() {
  await sweep(null);
  const sql = db();
  const [sess, returns, queue, free, targets, meta] = await Promise.all([
    sql`SELECT stance, modality,
               count(*) FILTER (WHERE status = 'completed' AND valid IS TRUE)::int AS valid_done,
               count(*) FILTER (WHERE status IN ('consented', 'in_progress'))::int AS in_progress
        FROM sessions WHERE NOT is_test AND stance IS NOT NULL GROUP BY stance, modality`,
    sql`SELECT sl.stance, sl.modality, a.return_reason, coalesce(a.exposed, false) AS exposed, count(*)::int AS n
        FROM slot_assignments a JOIN slots sl ON sl.seq = a.slot_seq WHERE a.returned_at IS NOT NULL
        GROUP BY sl.stance, sl.modality, a.return_reason, coalesce(a.exposed, false)`,
    sql`SELECT sl.stance, sl.modality, count(*)::int AS n FROM slot_assignments a JOIN slots sl ON sl.seq = a.slot_seq
        WHERE a.returned_at IS NOT NULL AND a.dismissed_at IS NULL AND NOT EXISTS (SELECT 1 FROM slot_assignments b WHERE b.refill_of = a.id)
        GROUP BY sl.stance, sl.modality`,
    sql`SELECT sl.stance, sl.modality, count(*)::int AS n FROM slots sl
        WHERE NOT EXISTS (SELECT 1 FROM slot_assignments a WHERE a.slot_seq = sl.seq AND a.source = 'sequence') GROUP BY sl.stance, sl.modality`,
    sql`SELECT stance, modality, target FROM cell_targets`,
    sql`SELECT (SELECT count(*)::int FROM slots) AS slots, (SELECT seed FROM slot_meta) AS seed`,
  ]);
  const at = (rows, c) => rows.find((r) => r.stance === c.stance && r.modality === c.modality);
  const cells = CELLS.map((c) => {
    const rs = returns.filter((r) => r.stance === c.stance && r.modality === c.modality);
    const byReason = {};
    for (const r of rs) {
      const k = ["abandoned", "locked", "invalid"].includes(r.return_reason) ? r.return_reason : "other";
      (byReason[k] ??= { before: 0, after: 0 })[r.exposed ? "after" : "before"] += r.n;
    }
    const sum = (key) => rs.reduce((n, r) => n + (key === "all" || (key === "after") === r.exposed ? r.n : 0), 0);
    return {
      ...c, target: at(targets, c)?.target ?? DEFAULT_TARGET, valid_done: at(sess, c)?.valid_done ?? 0, in_progress: at(sess, c)?.in_progress ?? 0,
      returned: { total: sum("all"), before: sum("before"), after: sum("after"), by_reason: byReason },
      queue: at(queue, c)?.n ?? 0, unassigned: at(free, c)?.n ?? 0,
    };
  });
  const total = (f) => cells.reduce((n, c) => n + f(c), 0);
  return {
    cells,
    totals: {
      target: total((c) => c.target), valid_done: total((c) => c.valid_done), in_progress: total((c) => c.in_progress),
      returned: total((c) => c.returned.total), queue: total((c) => c.queue), unassigned: total((c) => c.unassigned),
      remaining: total((c) => Math.max(0, c.target - c.valid_done)), // still to complete
      remaining_if_in_progress_finish: total((c) => Math.max(0, c.target - c.valid_done - c.in_progress)), // still to invite
    },
    slots: meta[0]?.slots ?? 0,
  };
}

export async function setTarget({ stance, modality, target }) {
  checkCell(stance, modality);
  const n = Number(target);
  if (!Number.isInteger(n) || n < 0 || n > 1000) throw httpError(400, "목표 인원은 0–1000의 정수입니다.");
  const [old] = await db()`SELECT target FROM cell_targets WHERE stance = ${stance} AND modality = ${modality}`;
  await db().transaction([
    db()`INSERT INTO cell_targets (stance, modality, target) VALUES (${stance}, ${modality}, ${n})
         ON CONFLICT (stance, modality) DO UPDATE SET target = EXCLUDED.target, updated_at = now()`,
    db()`INSERT INTO audit_log (actor, action, detail) VALUES ('admin', 'target_set', ${JSON.stringify({ stance, modality, from: old?.target ?? DEFAULT_TARGET, to: n })}::jsonb)`,
  ]);
  return { stance, modality, target: n };
}

// ---------- slots (emergency adjustments) ----------
export async function listSlots() {
  const sql = db();
  const [queue, upcoming, counts] = await Promise.all([
    sql`SELECT a.id, a.slot_seq, sl.stance, sl.modality, a.returned_at, a.return_reason, coalesce(a.exposed, false) AS exposed, s.participant_id
        FROM slot_assignments a JOIN slots sl ON sl.seq = a.slot_seq JOIN sessions s ON s.id = a.session_id
        WHERE a.returned_at IS NOT NULL AND a.dismissed_at IS NULL AND NOT EXISTS (SELECT 1 FROM slot_assignments b WHERE b.refill_of = a.id)
        ORDER BY a.returned_at, a.id`,
    sql`SELECT sl.seq, sl.block, sl.stance, sl.modality FROM slots sl
        WHERE NOT EXISTS (SELECT 1 FROM slot_assignments a WHERE a.slot_seq = sl.seq) ORDER BY sl.seq LIMIT 30`,
    sql`SELECT count(*)::int AS slots, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM slot_assignments a WHERE a.slot_seq = slots.seq))::int AS assigned FROM slots`,
  ]);
  return { queue, upcoming, counts: counts[0] };
}

export async function addSlot({ stance, modality, reason }) {
  const why = needReason(reason);
  checkCell(stance, modality);
  return withTransaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext('study1_assign'))");
    const { rows: [slot] } = await c.query(
      `INSERT INTO slots (seq, block, stance, modality)
       SELECT coalesce(max(seq), 0) + 1, coalesce(max(block), 0) + 1, $1, $2 FROM slots RETURNING seq, block`, [stance, modality]);
    await c.query("INSERT INTO audit_log (actor, action, slot_seq, detail) VALUES ('admin', 'slot_added', $1, $2)",
      [slot.seq, JSON.stringify({ reason: why, stance, modality, block: slot.block })]);
    return slot;
  });
}

// Only a slot nobody has been assigned (it would otherwise leave the sequence's record incomplete).
export async function deleteSlot({ seq, reason }) {
  const why = needReason(reason);
  return withTransaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext('study1_assign'))");
    const { rows: [slot] } = await c.query("SELECT * FROM slots WHERE seq = $1 FOR UPDATE", [seq]);
    if (!slot) throw httpError(404, "슬롯을 찾을 수 없습니다.");
    const { rows: used } = await c.query("SELECT 1 FROM slot_assignments WHERE slot_seq = $1 LIMIT 1", [seq]);
    if (used.length) throw httpError(409, "이미 배정된 적이 있는 슬롯은 삭제할 수 없습니다.");
    await c.query("DELETE FROM slots WHERE seq = $1", [seq]);
    await c.query("INSERT INTO audit_log (actor, action, slot_seq, detail) VALUES ('admin', 'slot_deleted', $1, $2)",
      [seq, JSON.stringify({ reason: why, stance: slot.stance, modality: slot.modality, block: slot.block })]);
    return { seq };
  });
}

// Takes a returned slot out of the refill queue (it is not handed out again).
export async function dismissQueueEntry({ assignment_id, reason }) {
  const why = needReason(reason);
  return withTransaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext('study1_assign'))");
    const { rows: [a] } = await c.query(
      `SELECT a.*, sl.stance, sl.modality FROM slot_assignments a JOIN slots sl ON sl.seq = a.slot_seq WHERE a.id = $1 FOR UPDATE OF a`, [assignment_id]);
    if (!a || !a.returned_at) throw httpError(404, "재충전 대기 중인 슬롯이 아닙니다.");
    const { rows: refilled } = await c.query("SELECT 1 FROM slot_assignments WHERE refill_of = $1", [assignment_id]);
    if (a.dismissed_at || refilled.length) throw httpError(409, "이미 다른 세션에 쓰였거나 제거된 슬롯입니다.");
    await c.query("UPDATE slot_assignments SET dismissed_at = now() WHERE id = $1", [assignment_id]);
    await c.query("INSERT INTO audit_log (actor, action, session_id, slot_seq, detail) VALUES ('admin', 'queue_dismissed', $1, $2, $3)",
      [a.session_id, a.slot_seq, JSON.stringify({ reason: why, assignment_id, stance: a.stance, modality: a.modality })]);
    return { assignment_id };
  });
}

// ---------- audit log ----------
export async function listAudit({ actor = null, action = null, participant_id = null, limit = 300 } = {}) {
  const n = Math.min(Math.max(Number(limit) || 300, 1), 1000);
  const sql = db();
  const [rows, actions] = await Promise.all([
    sql`SELECT a.id, a.ts, a.actor, a.action, s.participant_id, a.slot_seq, a.detail
        FROM audit_log a LEFT JOIN sessions s ON s.id = a.session_id
        WHERE (${actor}::text IS NULL OR a.actor = ${actor}) AND (${action}::text IS NULL OR a.action = ${action})
          AND (${participant_id}::text IS NULL OR s.participant_id ILIKE ${(participant_id ?? "") + "%"})
        ORDER BY a.id DESC LIMIT ${n}`,
    sql`SELECT DISTINCT actor, action FROM audit_log ORDER BY actor, action`,
  ]);
  return { rows, actions };
}

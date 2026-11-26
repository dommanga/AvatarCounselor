// Session lifecycle: expiry / abandonment sweeps, slot return, condition assignment at consent,
// browser-tab claims (one active tab per session, one resume), and the single re-answer chance.

import crypto from "crypto";
import { db, withTransaction } from "./db.js";
import * as C from "./config.js";
import { configSnapshot } from "./snapshot.js";
import { SURVEY, buildSurveyOrder } from "./survey.js";

export const ACTIVE = ["consented", "in_progress"];
export const ENDED = ["completed", "expired", "abandoned", "locked"];

// Which screen the participant page shows for a status. A lock caused by a technical failure (an
// empty answer after the re-answer chance) gets its own screen.
export function screenFor(status, lockReason = null) {
  if (status === "issued" || status === "opened") return "consent";
  if (ACTIVE.includes(status)) return "active";
  if (status === "locked" && lockReason === "empty_answer") return "locked_error";
  return status; // completed | expired | abandoned | locked
}

export const CONSENT_WITHDRAW_DATA = ["use", "destroy"];
export const CONSENT_NOTIFY = ["yes", "no"];

// End of the issuing week: Sunday 23:59:59 KST.
export function weekEndKST(from = new Date()) {
  const KST = 9 * 3600_000;
  const k = new Date(from.getTime() + KST);
  const daysToSunday = (7 - k.getUTCDay()) % 7;
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() + daysToSunday, 23, 59, 59) - KST);
}

export const meaningfulLength = (t) => (t || "").replace(/\s+/g, "").length;
export const currentAttempt = (s) => (s.retry_used ? 2 : 1);

// ---------- sweeps ----------
// Each entry is one statement (data-modifying CTE), so a sweep runs over HTTP as a batch or on a
// transaction client. Rows are re-checked under their row lock, so concurrent sweeps can't double-apply.
// sessionId = null sweeps every session.

// Return the slot of every session that ended without a valid completion.
function returnSlotsStatement(sessionId = null) {
  return [`
    WITH r AS (
      UPDATE slot_assignments a
      SET returned_at = now(),
          return_reason = CASE WHEN s.status = 'completed' THEN 'invalid' ELSE s.status END,
          exposed = EXISTS (SELECT 1 FROM events e WHERE e.session_id = a.session_id AND e.type = 'feedback_shown')
      FROM sessions s
      WHERE s.id = a.session_id AND a.returned_at IS NULL
        AND (s.status IN ('abandoned', 'locked', 'expired') OR (s.status = 'completed' AND s.valid = false))
        AND ($1::uuid IS NULL OR s.id = $1)
      RETURNING a.id, a.session_id, a.slot_seq, a.return_reason, a.exposed)
    INSERT INTO audit_log (actor, action, session_id, slot_seq, detail)
    SELECT 'system', 'slot_returned', session_id, slot_seq,
           jsonb_build_object('assignment_id', id, 'reason', return_reason, 'exposed', exposed)
    FROM r`, [sessionId]];
}

// Ended without completing and chose 'destroy' at consent: flag for scripts/purge-withdrawn.js.
function markDestroyStatement(sessionId = null) {
  return [`
    WITH x AS (
      UPDATE sessions SET destroy_pending = true, updated_at = now()
      WHERE status IN ('abandoned', 'locked') AND consent_withdraw_data = 'destroy'
        AND NOT destroy_pending AND data_purged_at IS NULL AND ($1::uuid IS NULL OR id = $1)
      RETURNING id, status)
    INSERT INTO audit_log (actor, action, session_id, detail)
    SELECT 'system', 'destroy_pending', id, jsonb_build_object('status', status) FROM x`, [sessionId]];
}

// Run after any session may have ended: slot return + withdrawal flag.
export const afterEndStatements = (sessionId = null) => [returnSlotsStatement(sessionId), markDestroyStatement(sessionId)];

// Lock a session (technical failure / limits) and release its slot, as one batch.
export async function lockSession(sessionId, reason, detail = {}) {
  const sql = db();
  await sql.transaction([
    sql`UPDATE sessions SET status = 'locked', lock_reason = ${reason}, ended_at = now(), updated_at = now()
        WHERE id = ${sessionId} AND status IN ('consented', 'in_progress')`,
    sql`INSERT INTO audit_log (actor, action, session_id, detail)
        VALUES ('system', 'locked', ${sessionId}, ${JSON.stringify({ reason, ...detail })}::jsonb)`,
    ...afterEndStatements(sessionId).map(([t, p]) => sql.query(t, p)),
  ]);
}

function sweepStatements(sessionId = null) {
  return [
    [`WITH x AS (
        UPDATE sessions SET status = 'expired', ended_at = now(), updated_at = now()
        WHERE status IN ('issued', 'opened') AND expires_at < now() AND ($1::uuid IS NULL OR id = $1)
        RETURNING id, expires_at)
      INSERT INTO audit_log (actor, action, session_id, detail)
      SELECT 'system', 'expired', id, jsonb_build_object('expires_at', expires_at) FROM x`, [sessionId]],
    [`WITH x AS (
        UPDATE sessions SET status = 'abandoned', ended_at = now(), updated_at = now()
        WHERE status IN ('consented', 'in_progress') AND last_activity_at < now() - make_interval(secs => $2)
          AND ($1::uuid IS NULL OR id = $1)
        RETURNING id, last_activity_at)
      INSERT INTO audit_log (actor, action, session_id, detail)
      SELECT 'system', 'abandoned', id, jsonb_build_object('last_activity_at', last_activity_at) FROM x`,
      [sessionId, C.ABANDON_AFTER_MS / 1000]],
    ...afterEndStatements(sessionId),
  ];
}

export async function sweep(sessionId = null) {
  const sql = db();
  await sql.transaction(sweepStatements(sessionId).map(([t, p]) => sql.query(t, p)));
}

// ---------- activity ----------
// Any participant write: refreshes the abandonment clock and moves consented -> in_progress.
export const touchStatement = (sql, sessionId) => sql`
  UPDATE sessions SET last_activity_at = now(), updated_at = now(),
         status = CASE WHEN status = 'consented' THEN 'in_progress' ELSE status END
  WHERE id = ${sessionId} AND status IN ('consented', 'in_progress')`;

export const idleTooLong = (s) =>
  !!s.last_activity_at && Date.now() - new Date(s.last_activity_at).getTime() > C.ABANDON_AFTER_MS;

// ---------- condition assignment (at consent) ----------
// Serialized by a transaction-scoped advisory lock; the session row is locked FOR UPDATE so a double
// click can't assign twice. Refill queue first (oldest return), then the next never-used sequence slot.
// choices: { withdraw_data: use | destroy, notify: yes | no } (validated by the caller)
// -> { status, assigned, exhausted? }
export async function consent(sessionId, choices) {
  return withTransaction(async (c) => {
    // sweep first (frees slots before choosing; safe concurrently), then serialize only the pick itself
    for (const [t, p] of sweepStatements(null)) await c.query(t, p);
    await c.query("SELECT pg_advisory_xact_lock(hashtext('study1_assign'))");
    const { rows: [s] } = await c.query("SELECT * FROM sessions WHERE id = $1 FOR UPDATE", [sessionId]);
    if (!s) throw new Error("session not found");
    if (s.status !== "opened") return { status: s.status, assigned: false };

    let { stance, modality } = s; // test sessions: preset at issuance, no slot
    if (!s.is_test) {
      const slot = await pickSlot(c, s.id);
      if (!slot) {
        await c.query("INSERT INTO audit_log (actor, action, session_id) VALUES ('system', 'slots_exhausted', $1)", [s.id]);
        return { status: s.status, assigned: false, exhausted: true };
      }
      ({ stance, modality } = slot);
    }
    await c.query(`
      UPDATE sessions SET status = 'consented', consented_at = now(), last_activity_at = now(), updated_at = now(),
             stance = $2, modality = $3, current_stage = 'device_test', config = $4, survey_version = $5,
             consent_withdraw_data = $6, consent_notify = $7, survey_order = $8
      WHERE id = $1`, [s.id, stance, modality, JSON.stringify(configSnapshot(stance)), SURVEY.version ?? null,
                       choices.withdraw_data, choices.notify, JSON.stringify(buildSurveyOrder())]);
    await c.query("INSERT INTO events (id, session_id, type) VALUES ($1, $2, 'consented')", [crypto.randomUUID(), s.id]);
    await c.query("INSERT INTO audit_log (actor, action, session_id, detail) VALUES ('system', 'consented', $1, $2)",
      [s.id, JSON.stringify({ stance, modality, is_test: s.is_test, ...choices })]);
    return { status: "consented", assigned: true };
  });
}

async function pickSlot(c, sessionId) {
  let source, refillOf = null, seq;
  const { rows: [ret] } = await c.query(`
    SELECT a.id, a.slot_seq FROM slot_assignments a
    WHERE a.returned_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM slot_assignments b WHERE b.refill_of = a.id)
    ORDER BY a.returned_at, a.id LIMIT 1 FOR UPDATE OF a`);
  if (ret) {
    source = "refill"; refillOf = ret.id; seq = ret.slot_seq;
  } else {
    const { rows: [next] } = await c.query(`
      SELECT s.seq FROM slots s
      WHERE NOT EXISTS (SELECT 1 FROM slot_assignments a WHERE a.slot_seq = s.seq AND a.source = 'sequence')
      ORDER BY s.seq LIMIT 1 FOR UPDATE OF s`);
    if (!next) return null;
    source = "sequence"; seq = next.seq;
  }
  const { rows: [slot] } = await c.query("SELECT stance, modality FROM slots WHERE seq = $1", [seq]);
  const { rows: [a] } = await c.query(
    "INSERT INTO slot_assignments (slot_seq, session_id, source, refill_of) VALUES ($1, $2, $3, $4) RETURNING id",
    [seq, sessionId, source, refillOf]);
  await c.query("INSERT INTO audit_log (actor, action, session_id, slot_seq, detail) VALUES ('system', 'slot_assigned', $1, $2, $3)",
    [sessionId, seq, JSON.stringify({ assignment_id: a.id, source, refill_of: refillOf, ...slot })]);
  return { seq, ...slot };
}

// ---------- browser-tab claims ----------
// key = per-tab random id (sessionStorage). Same key = reload. A different key may take over only when
// the holding tab released (pagehide) or went silent for CLIENT_STALE_MS; after consent that counts as
// a resume, and one more than MAX_RESUMES locks the session.
// -> { kind: first | reload | takeover | resume | other_window | locked | ended, status }
export async function claim(sessionId, key, info) {
  return withTransaction(async (c) => {
    const { rows: [s] } = await c.query(`
      SELECT *, (client_seen_at IS NULL OR client_seen_at < now() - make_interval(secs => $2)) AS client_stale
      FROM sessions WHERE id = $1 FOR UPDATE`, [sessionId, C.CLIENT_STALE_MS / 1000]);
    if (ENDED.includes(s.status)) {
      // a completed session can still be opened (debriefing, payment form link): give this tab the key
      if (s.status === "completed" && s.active_client_key !== key) {
        await c.query("UPDATE sessions SET active_client_key = $2, client_seen_at = now(), client_released = false WHERE id = $1", [s.id, key]);
      }
      return { kind: "ended", status: s.status };
    }

    let kind;
    if (s.active_client_key === key) kind = "reload";
    else if (!s.active_client_key) kind = "first";
    else if (!s.client_released && !s.client_stale) kind = "other_window";
    else if (ACTIVE.includes(s.status)) kind = s.resume_count >= C.MAX_RESUMES ? "locked" : "resume";
    else kind = "takeover"; // re-opened before consent: not counted

    await c.query("INSERT INTO session_clients (session_id, client_key, kind, user_agent, screen) VALUES ($1, $2, $3, $4, $5)",
      [s.id, key, kind, info.user_agent, info.screen ? JSON.stringify(info.screen) : null]);
    if (kind === "other_window") return { kind, status: s.status };
    if (kind === "locked") {
      await c.query("UPDATE sessions SET status = 'locked', lock_reason = 'resume_limit', ended_at = now(), updated_at = now() WHERE id = $1", [s.id]);
      await c.query("INSERT INTO audit_log (actor, action, session_id, detail) VALUES ('system', 'locked', $1, $2)",
        [s.id, JSON.stringify({ reason: "resume_limit", resume_count: s.resume_count })]);
      for (const [t, p] of afterEndStatements(s.id)) await c.query(t, p);
      return { kind, status: "locked" };
    }

    await c.query(`
      UPDATE sessions SET active_client_key = $2, client_seen_at = now(), client_released = false,
             resume_count = resume_count + $3, updated_at = now(),
             status = CASE WHEN status = 'issued' THEN 'opened' ELSE status END,
             opened_at = COALESCE(opened_at, now())
      WHERE id = $1`, [s.id, key, kind === "resume" ? 1 : 0]);
    if (s.status === "issued") {
      await c.query("INSERT INTO audit_log (actor, action, session_id) VALUES ('system', 'opened', $1)", [s.id]);
    }
    if (kind === "resume") {
      await c.query("INSERT INTO audit_log (actor, action, session_id, detail) VALUES ('system', 'resumed', $1, $2)",
        [s.id, JSON.stringify({ resume_count: s.resume_count + 1, stage: s.current_stage })]);
    }
    return { kind, status: s.status === "issued" ? "opened" : s.status };
  });
}

// ---------- the one re-answer chance (shared by empty-answer retry and resume re-answer) ----------
// -> true if granted now, false if it was already used.
export async function grantRetry(sessionId, reason, detail = {}) {
  const rows = await db()`
    WITH x AS (
      UPDATE sessions SET retry_used = true, retry_granted_at = now(), updated_at = now()
      WHERE id = ${sessionId} AND NOT retry_used RETURNING id)
    INSERT INTO audit_log (actor, action, session_id, detail)
    SELECT 'system', 'retry_granted', id, ${JSON.stringify({ reason, ...detail })}::jsonb FROM x
    RETURNING session_id`;
  return rows.length > 0;
}

export async function savedTranscript(sessionId, questionId, attempt) {
  const [r] = await db()`
    SELECT coalesce(string_agg(text, ' ' ORDER BY seq), '') AS t FROM answer_segments
    WHERE session_id = ${sessionId} AND question_id = ${questionId} AND attempt = ${attempt}`;
  return r.t.trim();
}

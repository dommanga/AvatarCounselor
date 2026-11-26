// Participant-device API. Auth: `Authorization: Bearer <link token>` (the token in /s/{token}).
// Calls that drive the session also send `X-Client-Key`: only the tab holding the session's claim may act.
//   GET  /api/session/state      -> { screen, ... } (no claim; sweeps expiry/abandonment)
//   POST /api/session/claim      { user_agent, screen } -> claims this tab, then same payload as state
//   POST /api/session/heartbeat | release
//   POST /api/session/consent    { agree: true, withdraw_data: use|destroy, notify: yes|no }
//                                -> assigns the condition, then same payload as state
//   POST /api/session/event      { id, type, question_id?, client_ts }
//   POST /api/session/survey     { phase, block, answers }   one survey block (re-submitting overwrites)
//   POST /api/session/answer     { question_id, transcript, injected?, from_saved? }
//                                -> { feedback } | { retry, attempt } | 202 { pending }
//   POST /api/session/segment    { question_id, attempt, seq, text, client_ts }   finalized STT segment
//   POST /api/session/audio?question_id&attempt&seq&client_ts   raw audio body (off unless AUDIO_UPLOAD_ENABLED)
// The stance never leaves the server for real sessions (test sessions get it for dev mode).

import { db, isUniqueViolation } from "../../lib/db.js";
import { requireParticipant } from "../../lib/auth.js";
import { assess, generateFeedback, MODEL } from "../../lib/llm.js";
import { CLIENT_EVENT_TYPES, QUESTION_EVENT_TYPES, stageAfter } from "../../lib/stages.js";
import { SURVEY, validateBlock, evaluateChecks } from "../../lib/survey.js";
import * as C from "../../lib/config.js";
import {
  ACTIVE, screenFor, sweep, claim, consent, grantRetry, savedTranscript, touchStatement, idleTooLong,
  afterEndStatements, lockSession, meaningfulLength, currentAttempt, CONSENT_WITHDRAW_DATA, CONSENT_NOTIFY,
} from "../../lib/lifecycle.js";
import { QUESTIONS, PRACTICE_ID, LAST_QUESTION, QUESTION_SEQUENCE } from "../../src/questions.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_TRANSCRIPT = 20000;
const MAX_SEGMENT = 5000;
const AUDIO_TYPES = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/wav": "wav" };

// guard: none = token only | client = this tab holds the claim | active = client + consented/in-progress
const ROUTES = {
  "GET state": [state, "none"],
  "POST claim": [claimRoute, "none"],
  "POST heartbeat": [heartbeat, "client"],
  "POST release": [release, "client"],
  "POST consent": [consentRoute, "client"],
  "POST event": [event, "active"],
  "POST survey": [survey, "active"],
  "POST answer": [answer, "active"],
  "POST segment": [segment, "active"],
  "POST audio": [audio, "active"],
};

export default async function handler(req, res) {
  const action = req.query.action;
  const route = ROUTES[`${req.method} ${action}`];
  if (!route) return res.status(404).json({ error: "not found" });
  const [fn, guard] = route;
  try {
    const s = await requireParticipant(req, res);
    if (!s) return;
    if (guard !== "none" && req.headers["x-client-key"] !== s.active_client_key) {
      return res.status(409).json({ error: "another window holds this session", screen: "other_window" });
    }
    if (guard === "active" && (!ACTIVE.includes(s.status) || idleTooLong(s))) {
      await sweep(s.id);
      const [cur] = await db()`SELECT status, lock_reason FROM sessions WHERE id = ${s.id}`;
      if (!ACTIVE.includes(cur.status)) {
        return res.status(410).json({ error: "session ended", screen: screenFor(cur.status, cur.lock_reason) });
      }
    }
    return await fn(req, res, s);
  } catch (e) {
    console.error(`[session/${action}]`, e);
    return res.status(e.status || 500).json({ error: String(e?.message || e) });
  }
}

const reload = async (id) => (await db()`SELECT * FROM sessions WHERE id = ${id}`)[0];

// ---------- screen + resume payload ----------

async function payload(s) {
  const screen = screenFor(s.status, s.lock_reason);
  const base = { screen, is_test: s.is_test, heartbeat_ms: C.HEARTBEAT_MS };
  if (screen !== "active") return base;
  const sql = db();
  // the live answer per question (pending or done) — feedback is never generated twice
  const rows = await sql`
    SELECT DISTINCT ON (question_id) question_id, transcript, status, feedback, scores, strong, weak
    FROM answers WHERE session_id = ${s.id} AND status IN ('pending', 'done')
    ORDER BY question_id, id DESC`;
  const answers = {};
  for (const r of rows) {
    answers[r.question_id] = { transcript: r.transcript, feedback: r.feedback, pending: r.status === "pending" };
    if (s.is_test) Object.assign(answers[r.question_id], { scores: r.scores, strong: r.strong, weak: r.weak });
  }
  // survey blocks already submitted, so a reload resumes at the first unanswered block
  const done = await sql`SELECT DISTINCT phase, scale_id FROM responses WHERE session_id = ${s.id}`;
  const surveys = { pre: [], post: [] };
  for (const r of done) surveys[r.phase].push(r.scale_id);
  const resume_to = await resumeTarget(s, answers);
  return {
    ...base,
    modality: s.modality,
    attempt: s.retry_used || resume_to.reanswer ? 2 : 1,
    resume_to,
    answers,
    surveys,
    ...(s.is_test && { stance: s.stance }),
  };
}

// Where a (re)loaded page continues.
//   { to: pre_survey | scenario | practice | post_survey | done }
//   { to: question, question_id, reanswer? }   ask (again); reanswer = the retry chance was just spent
//   { to: submit_saved, question_id }          interrupted mid-answer: submit the saved segments
//   { to: feedback, question_id, replay_audio? }
async function resumeTarget(s, answers) {
  const m = /^(.+)_(answering|feedback)$/.exec(s.current_stage);
  if (!m || !QUESTIONS[m[1]]) return { to: s.current_stage };
  const q = m[1];
  const sql = db();

  if (answers[q]) {
    if (s.modality === "voice" && answers[q].feedback) {
      const ended = await sql`SELECT 1 FROM events WHERE session_id = ${s.id} AND type = 'audio_ended' AND question_id = ${q} LIMIT 1`;
      if (ended.length) {
        return q === LAST_QUESTION
          ? { to: "post_survey" }
          : { to: "question", question_id: QUESTION_SEQUENCE[QUESTION_SEQUENCE.indexOf(q) + 1] };
      }
      return { to: "feedback", question_id: q, replay_audio: true };
    }
    return { to: "feedback", question_id: q };
  }

  // answer_start of the current attempt (anything before the retry grant belongs to the old attempt)
  const started = await sql`
    SELECT 1 FROM events WHERE session_id = ${s.id} AND type = 'answer_start' AND question_id = ${q}
      AND server_ts > coalesce(${s.retry_granted_at}::timestamptz, '-infinity'::timestamptz) LIMIT 1`;
  if (!started.length) return { to: "question", question_id: q };

  const saved = await savedTranscript(s.id, q, currentAttempt(s));
  if (meaningfulLength(saved) < C.EMPTY_ANSWER_MIN_CHARS && !s.retry_used &&
      await grantRetry(s.id, "resume", { question_id: q, saved_chars: meaningfulLength(saved) })) {
    return { to: "question", question_id: q, reanswer: true };
  }
  return { to: "submit_saved", question_id: q };
}

async function state(req, res, s) {
  await sweep(s.id);
  return res.status(200).json(await payload(await reload(s.id)));
}

async function claimRoute(req, res, s) {
  const key = req.headers["x-client-key"];
  if (!KEY_RE.test(key || "")) return res.status(400).json({ error: "x-client-key required" });
  const { user_agent = null, screen = null } = req.body || {};
  const info = {
    user_agent: typeof user_agent === "string" ? user_agent.slice(0, 500) : null,
    screen: screen && typeof screen === "object"
      ? Object.fromEntries(["w", "h", "vw", "vh", "dpr"].map((k) => [k, Number.isFinite(screen[k]) ? screen[k] : null]))
      : null,
  };
  await sweep(s.id);
  const r = await claim(s.id, key, info);
  if (r.kind === "other_window") return res.status(200).json({ screen: "other_window" });
  return res.status(200).json({ ...(await payload(await reload(s.id))), claim: r.kind });
}

async function heartbeat(req, res, s) {
  const rows = await db()`
    UPDATE sessions SET client_seen_at = now(), client_released = false
    WHERE id = ${s.id} AND active_client_key = ${req.headers["x-client-key"]} RETURNING status, lock_reason`;
  if (!rows.length) return res.status(409).json({ error: "another window holds this session", screen: "other_window" });
  return res.status(200).json({ ok: true, screen: screenFor(rows[0].status, rows[0].lock_reason) });
}

// pagehide: lets another tab take over right away instead of waiting CLIENT_STALE_MS.
async function release(req, res, s) {
  await db()`UPDATE sessions SET client_released = true WHERE id = ${s.id} AND active_client_key = ${req.headers["x-client-key"]}`;
  return res.status(200).json({ ok: true });
}

async function consentRoute(req, res, s) {
  const { agree, withdraw_data, notify } = req.body || {};
  if (agree !== true) return res.status(400).json({ error: "동의가 필요합니다." });
  if (!CONSENT_WITHDRAW_DATA.includes(withdraw_data) || !CONSENT_NOTIFY.includes(notify)) {
    return res.status(400).json({ error: "필수 선택 항목에 모두 응답해 주세요." });
  }
  const r = await consent(s.id, { withdraw_data, notify });
  if (r.exhausted) {
    return res.status(503).json({ error: "배정할 조건이 남아 있지 않습니다. 연구자에게 문의해 주세요.", screen: "consent" });
  }
  return res.status(200).json(await payload(await reload(s.id)));
}

// ---------- activity ----------

async function event(req, res, s) {
  const { id, type, question_id = null, client_ts } = req.body || {};
  if (!UUID_RE.test(id || "")) return res.status(400).json({ error: "id must be a uuid" });
  if (!CLIENT_EVENT_TYPES.includes(type)) return res.status(400).json({ error: "unknown event type" });
  const needsQ = QUESTION_EVENT_TYPES.includes(type);
  if (needsQ ? !QUESTIONS[question_id] : question_id !== null) {
    return res.status(400).json({ error: needsQ ? "question_id required" : "question_id not allowed" });
  }
  if (!Number.isSafeInteger(client_ts)) return res.status(400).json({ error: "client_ts must be Date.now()" });

  const sql = db();
  const insert = sql`
    INSERT INTO events (id, session_id, type, question_id, client_ts)
    VALUES (${id}, ${s.id}, ${type}, ${question_id}, ${client_ts})
    ON CONFLICT (id) DO NOTHING`;
  if (type === "survey_post_submitted") return complete(res, s, insert);

  const stage = stageAfter(type, question_id);
  await sql.transaction([
    insert,
    sql`UPDATE sessions SET current_stage = coalesce(${stage}::text, current_stage) WHERE id = ${s.id}`,
    touchStatement(sql, s.id),
  ]);
  return res.status(200).json({ ok: true, stage: stage ?? s.current_stage });
}

// End of the post-survey: completed, validity from the attention checks, slot returned if invalid.
async function complete(res, s, insertEvent) {
  const sql = db();
  const saved = await sql`SELECT phase, item_id, value, scale_id FROM responses WHERE session_id = ${s.id}`;
  const missing = (SURVEY.post || []).map((b) => b.block)
    .filter((b) => !saved.some((r) => r.phase === "post" && r.scale_id === b));
  if (missing.length) return res.status(400).json({ error: `post-survey blocks missing: ${missing.join(", ")}` });

  const checks = evaluateChecks(saved);
  await sql.transaction([
    insertEvent,
    sql`UPDATE sessions SET status = 'completed', completed_at = now(), ended_at = now(), valid = ${checks.valid},
               current_stage = 'done', last_activity_at = now(), updated_at = now()
        WHERE id = ${s.id} AND status IN ('consented', 'in_progress')`,
    sql`INSERT INTO audit_log (actor, action, session_id, detail)
        VALUES ('system', 'completed', ${s.id}, ${JSON.stringify(checks)}::jsonb)`,
    ...afterEndStatements(s.id).map(([t, p]) => sql.query(t, p)),
  ]);
  return res.status(200).json({ ok: true, stage: "done" });
}

async function survey(req, res, s) {
  const { phase, block, answers } = req.body || {};
  const { rows, clear, error } = validateBlock(phase, block, answers);
  if (error) return res.status(400).json({ error });
  const sql = db();
  await sql.transaction([
    ...clear.map((id) => sql`DELETE FROM responses WHERE session_id = ${s.id} AND phase = ${phase} AND item_id = ${id}`),
    ...rows.map((r) => sql`
      INSERT INTO responses (session_id, phase, scale_id, item_id, value)
      VALUES (${s.id}, ${phase}, ${r.scale_id}, ${r.item_id}, ${JSON.stringify(r.value)}::jsonb)
      ON CONFLICT (session_id, phase, item_id) DO UPDATE SET value = EXCLUDED.value, created_at = now()`),
    touchStatement(sql, s.id),
  ]);
  return res.status(200).json({ ok: true });
}

// ---------- answers ----------

const feedbackPayload = (s, a) => ({
  feedback: a.feedback,
  ...(s.is_test && { stance: s.stance, scores: a.scores, strong: a.strong, weak: a.weak }),
});

async function answer(req, res, s) {
  const { question_id, transcript: sent, injected = false, from_saved = false } = req.body || {};
  const isPractice = question_id === PRACTICE_ID;
  if (!isPractice && !QUESTIONS[question_id]) return res.status(400).json({ error: "unknown question_id" });
  if (injected && !s.is_test) return res.status(403).json({ error: "injection is only allowed in test sessions" });
  if (!from_saved && (typeof sent !== "string" || sent.length > MAX_TRANSCRIPT)) {
    return res.status(400).json({ error: "transcript required" });
  }
  const sql = db();

  if (isPractice) { // STT check only: no feedback, no retry accounting
    if (!sent.trim()) return res.status(400).json({ error: "transcript required" });
    await sql.transaction([
      sql`INSERT INTO answers (session_id, question_id, transcript, injected, status, finished_at)
          VALUES (${s.id}, ${PRACTICE_ID}, ${sent}, ${!!injected}, 'done', now())`,
      touchStatement(sql, s.id),
    ]);
    return res.status(200).json({ ok: true });
  }

  // Feedback is generated once per question: a finished one is returned as is, a running one waited on.
  const [live] = await sql`
    SELECT id, status, feedback, scores, strong, weak, created_at FROM answers
    WHERE session_id = ${s.id} AND question_id = ${question_id} AND status IN ('pending', 'done') LIMIT 1`;
  if (live?.status === "done") return res.status(200).json(feedbackPayload(s, live));
  if (live) {
    if (Date.now() - new Date(live.created_at).getTime() < C.ANSWER_PENDING_STALE_MS) {
      return res.status(202).json({ pending: true });
    }
    // orphaned by a function that died mid-generation: nothing was ever shown, so generate now
    await sql`UPDATE answers SET status = 'stale', finished_at = now() WHERE id = ${live.id} AND status = 'pending'`;
  }

  const attempt = currentAttempt(s);
  let transcript, truncated = false;
  if (from_saved) {
    transcript = await savedTranscript(s.id, question_id, attempt);
    truncated = true;
  } else {
    transcript = sent.trim();
    const chars = meaningfulLength(transcript);
    if (chars < C.EMPTY_ANSWER_MIN_CHARS && !injected && await grantRetry(s.id, "empty_answer", { question_id, chars })) {
      await touchStatement(sql, s.id);
      return res.status(200).json({ retry: true, attempt: attempt + 1 });
    }
  }
  // The re-answer chance is spent. Short: give feedback, flagged. Nothing at all: a technical failure —
  // no feedback (so no exposure), lock, and return the slot.
  const chars = meaningfulLength(transcript);
  if (chars === 0 && !injected) {
    await lockSession(s.id, "empty_answer", { question_id, attempt, from_saved });
    return res.status(410).json({ error: "empty answer", screen: "locked_error" });
  }
  const short = chars < C.EMPTY_ANSWER_MIN_CHARS;

  let row;
  try {
    [row] = await sql`
      INSERT INTO answers (session_id, question_id, attempt, transcript, answer_truncated, answer_short, injected, status, stance, model)
      VALUES (${s.id}, ${question_id}, ${attempt}, ${transcript}, ${truncated}, ${short}, ${!!injected}, 'pending', ${s.stance}, ${MODEL})
      RETURNING id`;
  } catch (e) {
    if (isUniqueViolation(e)) return res.status(202).json({ pending: true }); // a concurrent request is generating
    throw e;
  }
  await touchStatement(sql, s.id);

  let a = null, f = null, error = null;
  try {
    a = await assess(QUESTIONS[question_id], transcript);
    f = await generateFeedback(a.context, s.stance);
  } catch (e) {
    error = String(e?.message || e);
  }
  // persist partial results too (e.g. Stage 1 succeeded, Stage 2 failed) — useful when debugging
  await sql`
    UPDATE answers SET status = ${error ? "error" : "done"}, finished_at = now(),
           stage1_raw = ${a?.raw ?? null}, scores = ${a ? JSON.stringify(a.scores) : null}::jsonb,
           strong = ${a?.strong ?? null}, weak = ${a?.weak ?? null}, context = ${a?.context ?? null},
           stage2_raw = ${f?.raw ?? null}, feedback = ${f?.feedback ?? null}, error = ${error}
    WHERE id = ${row.id}`;
  if (error) return res.status(502).json({ error });
  return res.status(200).json(feedbackPayload(s, { feedback: f.feedback, ...a }));
}

// ---------- mid-answer saves (clients connect in Phase 3) ----------

function partKey(question_id, attempt, seq) {
  if (!QUESTIONS[question_id]) return "unknown question_id";
  if (attempt !== 1 && attempt !== 2) return "attempt must be 1 or 2";
  if (!Number.isInteger(seq) || seq < 0 || seq > 100000) return "seq must be an integer 0–100000";
  return null;
}

async function segment(req, res, s) {
  const { question_id, attempt, seq, text, client_ts = null } = req.body || {};
  const bad = partKey(question_id, attempt, seq) ||
    (typeof text !== "string" || text.length > MAX_SEGMENT ? "text required" : null) ||
    (client_ts !== null && !Number.isSafeInteger(client_ts) ? "client_ts must be Date.now()" : null);
  if (bad) return res.status(400).json({ error: bad });
  const sql = db();
  await sql.transaction([
    sql`INSERT INTO answer_segments (session_id, question_id, attempt, seq, text, client_ts)
        VALUES (${s.id}, ${question_id}, ${attempt}, ${seq}, ${text}, ${client_ts})
        ON CONFLICT DO NOTHING`,
    touchStatement(sql, s.id),
  ]);
  return res.status(200).json({ ok: true });
}

async function readRaw(req, max) {
  const chunks = [];
  let n = 0;
  for await (const chunk of req) {
    n += chunk.length;
    if (n > max) throw Object.assign(new Error("audio chunk too large"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Bytes go to a private Vercel Blob store (BLOB_READ_WRITE_TOKEN); the path carries no participant_id.
// BLOB_PREFIX separates environments, since Blob stores aren't branched like the database.
async function audio(req, res, s) {
  if (!C.AUDIO_UPLOAD_ENABLED) return res.status(403).json({ error: "audio upload is disabled" });
  const q = req.query;
  const question_id = q.question_id, attempt = Number(q.attempt), seq = Number(q.seq);
  const client_ts = q.client_ts ? Number(q.client_ts) : null;
  const bad = partKey(question_id, attempt, seq) ||
    (client_ts !== null && !Number.isSafeInteger(client_ts) ? "client_ts must be Date.now()" : null);
  if (bad) return res.status(400).json({ error: bad });
  const mime = String(req.headers["content-type"] || "").split(";")[0].trim();
  const ext = AUDIO_TYPES[mime];
  if (!ext) return res.status(415).json({ error: `unsupported audio type ${mime}` });

  const body = await readRaw(req, C.AUDIO_MAX_BYTES);
  if (!body.length) return res.status(400).json({ error: "empty audio chunk" });
  const prefix = process.env.BLOB_PREFIX || process.env.VERCEL_ENV || "local";
  const pathname = `${prefix}/${s.id}/${question_id}/a${attempt}/${seq}.${ext}`;
  const { put } = await import("@vercel/blob");
  await put(pathname, body, { access: "private", contentType: mime, allowOverwrite: true });

  const sql = db();
  await sql.transaction([
    sql`INSERT INTO audio_chunks (session_id, question_id, attempt, seq, pathname, bytes, mime, client_ts)
        VALUES (${s.id}, ${question_id}, ${attempt}, ${seq}, ${pathname}, ${body.length}, ${mime}, ${client_ts})
        ON CONFLICT (session_id, question_id, attempt, seq)
        DO UPDATE SET pathname = EXCLUDED.pathname, bytes = EXCLUDED.bytes, mime = EXCLUDED.mime, server_ts = clock_timestamp()`,
    touchStatement(sql, s.id),
  ]);
  return res.status(200).json({ ok: true });
}

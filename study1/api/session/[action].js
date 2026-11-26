// Participant-device API. Auth: `Authorization: Bearer <link token>` (the token in /s/{token}).
// Calls that drive the session also send `X-Client-Key`: only the tab holding the session's claim may act.
//   GET  /api/session/state      -> { screen, ... } (no claim; sweeps expiry/abandonment)
//   POST /api/session/claim      { user_agent, screen } -> claims this tab, then same payload as state
//   POST /api/session/heartbeat | release
//   POST /api/session/consent    { agree: true, withdraw_data: use|destroy, notify: yes|no }
//                                -> assigns the condition, then same payload as state
//   POST /api/session/event      { id, type, question_id?, client_ts, data? }
//   POST /api/session/survey     { phase: pre|mid|post, block, answers }   one block (re-submitting overwrites)
//   POST /api/session/segment    { question_id, attempt, seq, text, client_ts }   finalized STT segment
//   POST /api/session/audio?question_id&attempt&seq&client_ts   raw audio body (off unless AUDIO_UPLOAD_ENABLED)
//   POST /api/session/answer     { question_id, client_transcript?, interrupted?, injected?, transcript? }
//                                Confirms the answer from the saved segments and starts the feedback
//                                right away (it keeps running after the response):
//                                -> { state: pending|done } | { retry, attempt } | 410 locked_error
//   GET  /api/session/feedback?question_id   -> { state: none|pending|done|error, feedback? }
//                                (voice condition: never the text; pending until the audio is stored)
//   GET  /api/session/feedback_audio?question_id   the spoken feedback (mp3) of a voice session, from private Blob
//   POST /api/session/debrief    { kind: shown|confirmed, id, client_ts }   after completion
// The stance never leaves the server for real sessions (test sessions get it for dev mode).

import { waitUntil } from "@vercel/functions";
import { db, isUniqueViolation } from "../../lib/db.js";
import { requireParticipant } from "../../lib/auth.js";
import { assess, generateFeedback, MODEL } from "../../lib/llm.js";
import { CLIENT_EVENT_TYPES, QUESTION_EVENT_TYPES, MAX_EVENT_DATA_CHARS, QUESTION_STAGE_RE, stageAfter } from "../../lib/stages.js";
import { SURVEY, PHASES, findBlock, blockHasConditional, CONDITION_SOURCE_IDS, validateBlock, evaluateChecks } from "../../lib/survey.js";
import * as C from "../../lib/config.js";
import { blobPrefix } from "../../lib/config.js";
import {
  ACTIVE, screenFor, sweep, claim, consent, grantRetry, savedTranscript, touchStatement, idleTooLong,
  afterEndStatements, lockSession, meaningfulLength, currentAttempt, CONSENT_WITHDRAW_DATA, CONSENT_NOTIFY,
} from "../../lib/lifecycle.js";
import { QUESTIONS, LAST_QUESTION, QUESTION_SEQUENCE } from "../../src/questions.js";
import { COPY } from "../../src/copy.js";
import { normalizeForTts, synthesize, withRetries, mp3DurationSeconds } from "../../lib/tts.js";

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
  "GET feedback": [feedbackRoute, "active"],
  "GET feedback_audio": [feedbackAudio, "active"],
  "POST segment": [segment, "active"],
  "POST audio": [audio, "active"],
  "POST debrief": [debrief, "client"], // after completion: the session is no longer 'active'
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
  // a completed link still opens: debriefing if not yet confirmed, then the completion screen
  if (s.status === "completed") return { ...base, participant_id: s.participant_id, resume_to: { to: s.debriefed_at ? "done" : "debrief" } };
  if (screen !== "active") return base;
  const sql = db();
  // latest answer row per question: pending (feedback being generated) | done | error
  const rows = await sql`
    SELECT DISTINCT ON (question_id) question_id, status FROM answers
    WHERE session_id = ${s.id} AND status IN ('pending', 'done', 'error') ORDER BY question_id, id DESC`;
  const answers = Object.fromEntries(rows.map((r) => [r.question_id, { state: r.status }]));
  // survey blocks already submitted, so a reload resumes at the first unanswered block
  const done = await sql`SELECT DISTINCT phase, block_id FROM responses WHERE session_id = ${s.id}`;
  const surveys = Object.fromEntries(PHASES.map((p) => [p, []]));
  for (const r of done) surveys[r.phase]?.push(r.block_id);
  const resume_to = await resumeTarget(s, answers, surveys);
  return {
    ...base,
    modality: s.modality,
    attempt: currentAttempt(s) + (resume_to.reanswer ? 1 : 0),
    resume_to,
    surveys,
    survey_order: s.survey_order,
    values: await conditionValues(s.id), // earlier answers that later questions quote (OE1 shows both self-ratings)
    rules: { oe_min_chars: C.OE_MIN_CHARS },
    audio_upload: C.AUDIO_UPLOAD_ENABLED,
    timing: {
      think_ms: C.THINK_TIME_MS,
      answer_max_ms: C.ANSWER_MAX_MS,
      feedback_min_wait_ms: C.FEEDBACK_MIN_WAIT_MS,
      text_min_dwell_ms_per_char: C.TEXT_MIN_DWELL_MS_PER_CHAR,
      audio_chunk_ms: C.AUDIO_CHUNK_MS,
    },
    ...(s.is_test && { stance: s.stance }),
  };
}

// Where a (re)loaded page continues.
//   { to: device_test | notice | pre_survey | scenario | post_survey }
//   { to: question_guide, question_id, reanswer? }  the answering instructions come first, the thinking time starts
//                                              over after them; reanswer = the re-answer chance was just spent
//   { to: submit_saved, question_id }          interrupted mid-answer with enough text: confirm what was saved
//   { to: self_rating, question_id }           answer confirmed, self-rating still to do
//   { to: feedback, question_id, seen, replay_audio? }
async function resumeTarget(s, answers, surveys) {
  if (s.current_stage === "question_guide") return { to: "question_guide", question_id: QUESTION_SEQUENCE[0] };
  const m = QUESTION_STAGE_RE.exec(s.current_stage);
  if (!m || !QUESTIONS[m[1]]) return { to: s.current_stage };
  const q = m[1];
  const sql = db();

  if (answers[q]) {
    if (!surveys.mid.length) return { to: "self_rating", question_id: q };
    if (s.modality === "voice" && answers[q].state === "done") {
      const ended = await sql`SELECT 1 FROM events WHERE session_id = ${s.id} AND type = 'audio_ended' AND question_id = ${q} LIMIT 1`;
      if (ended.length) {
        return q === LAST_QUESTION
          ? { to: "post_survey" }
          : { to: "question", question_id: QUESTION_SEQUENCE[QUESTION_SEQUENCE.indexOf(q) + 1] };
      }
      return { to: "feedback", question_id: q, seen: true, replay_audio: true };
    }
    const seen = await sql`SELECT 1 FROM events WHERE session_id = ${s.id} AND type = 'feedback_shown' AND question_id = ${q} LIMIT 1`;
    return { to: "feedback", question_id: q, seen: seen.length > 0 };
  }

  // answer_start of the current attempt (anything before the retry grant belongs to the old attempt)
  const started = await sql`
    SELECT 1 FROM events WHERE session_id = ${s.id} AND type = 'answer_start' AND question_id = ${q}
      AND server_ts > coalesce(${s.retry_granted_at}::timestamptz, '-infinity'::timestamptz) LIMIT 1`;
  if (!started.length) return { to: "question_guide", question_id: q }; // left the question screen: the instructions again, the countdown starts over

  const saved = await savedTranscript(s.id, q, currentAttempt(s));
  if (meaningfulLength(saved) < C.EMPTY_ANSWER_MIN_CHARS && !s.retry_used &&
      await grantRetry(s.id, "resume", { question_id: q, saved_chars: meaningfulLength(saved) })) {
    return { to: "question_guide", question_id: q, reanswer: true };
  }
  return { to: "submit_saved", question_id: q };
}

// { item_id: value } of the answers conditional questions depend on, as stored so far.
async function conditionValues(sessionId) {
  if (!CONDITION_SOURCE_IDS.length) return {};
  const rows = await db()`SELECT item_id, value FROM responses WHERE session_id = ${sessionId} AND item_id = ANY(${CONDITION_SOURCE_IDS}::text[])`;
  return Object.fromEntries(rows.map((r) => [r.item_id, r.value]));
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
  if (agree !== true) return res.status(400).json({ error: COPY.consentRequired });
  if (!CONSENT_WITHDRAW_DATA.includes(withdraw_data) || !CONSENT_NOTIFY.includes(notify)) {
    return res.status(400).json({ error: COPY.consentChoicesRequired });
  }
  const r = await consent(s.id, { withdraw_data, notify });
  if (r.exhausted) return res.status(503).json({ error: COPY.slotsExhausted, screen: "consent" });
  return res.status(200).json(await payload(await reload(s.id)));
}

// ---------- activity ----------

async function event(req, res, s) {
  const { id, type, question_id = null, client_ts, data = null } = req.body || {};
  if (!UUID_RE.test(id || "")) return res.status(400).json({ error: "id must be a uuid" });
  if (!CLIENT_EVENT_TYPES.includes(type)) return res.status(400).json({ error: "unknown event type" });
  const needsQ = QUESTION_EVENT_TYPES.includes(type);
  if (needsQ ? !QUESTIONS[question_id] : question_id !== null) {
    return res.status(400).json({ error: needsQ ? "question_id required" : "question_id not allowed" });
  }
  if (!Number.isSafeInteger(client_ts)) return res.status(400).json({ error: "client_ts must be Date.now()" });
  if (data !== null && (typeof data !== "object" || Array.isArray(data) || JSON.stringify(data).length > MAX_EVENT_DATA_CHARS)) {
    return res.status(400).json({ error: "data must be a small object" });
  }

  const sql = db();
  const insert = sql`
    INSERT INTO events (id, session_id, type, question_id, client_ts, data)
    VALUES (${id}, ${s.id}, ${type}, ${question_id}, ${client_ts}, ${data ? JSON.stringify(data) : null}::jsonb)
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
// The debriefing follows (current_stage 'debrief'); its confirmation is recorded by /debrief.
async function complete(res, s, insertEvent) {
  const sql = db();
  const saved = await sql`SELECT phase, item_id, value, block_id FROM responses WHERE session_id = ${s.id}`;
  const missing = (SURVEY.post || []).map((b) => b.block)
    .filter((b) => !saved.some((r) => r.phase === "post" && r.block_id === b));
  if (missing.length) return res.status(400).json({ error: `post-survey blocks missing: ${missing.join(", ")}` });

  const checks = evaluateChecks(saved);
  await sql.transaction([
    insertEvent,
    sql`UPDATE sessions SET status = 'completed', completed_at = now(), ended_at = now(), valid = ${checks.valid},
               current_stage = 'debrief', last_activity_at = now(), updated_at = now()
        WHERE id = ${s.id} AND status IN ('consented', 'in_progress')`,
    sql`INSERT INTO audit_log (actor, action, session_id, detail)
        VALUES ('system', 'completed', ${s.id}, ${JSON.stringify(checks)}::jsonb)`,
    ...afterEndStatements(s.id).map(([t, p]) => sql.query(t, p)),
  ]);
  return res.status(200).json({ ok: true, stage: "debrief", participant_id: s.participant_id });
}

async function debrief(req, res, s) {
  const { kind, id, client_ts = null } = req.body || {};
  if (s.status !== "completed") return res.status(400).json({ error: "session is not completed" });
  if (!["shown", "confirmed"].includes(kind) || !UUID_RE.test(id || "")) return res.status(400).json({ error: "kind and id required" });
  const sql = db();
  const insert = sql`
    INSERT INTO events (id, session_id, type, client_ts)
    VALUES (${id}, ${s.id}, ${kind === "shown" ? "debrief_shown" : "debrief_confirmed"}, ${Number.isSafeInteger(client_ts) ? client_ts : null})
    ON CONFLICT (id) DO NOTHING`;
  if (kind === "shown") {
    await insert;
  } else {
    await sql.transaction([
      insert,
      sql`WITH x AS (UPDATE sessions SET debriefed_at = now(), updated_at = now() WHERE id = ${s.id} AND debriefed_at IS NULL RETURNING id)
          INSERT INTO audit_log (actor, action, session_id) SELECT 'system', 'debriefed', id FROM x`,
      sql`UPDATE sessions SET current_stage = 'done' WHERE id = ${s.id}`,
    ]);
  }
  return res.status(200).json({ ok: true });
}

async function survey(req, res, s) {
  const { phase, block, answers } = req.body || {};
  if (!PHASES.includes(phase)) return res.status(400).json({ error: "unknown survey phase" });
  const blk = findBlock(phase, block);
  const values = blk && blockHasConditional(blk) ? await conditionValues(s.id) : {};
  const { rows, clear, error } = validateBlock(phase, block, answers, s.survey_order?.[phase]?.[block] ?? null, values);
  if (error) return res.status(400).json({ error });
  const sql = db();
  await sql.transaction([
    ...clear.map((id) => sql`DELETE FROM responses WHERE session_id = ${s.id} AND phase = ${phase} AND item_id = ${id}`),
    ...rows.map((r) => sql`
      INSERT INTO responses (session_id, phase, scale_id, block_id, item_id, value, display_order, shown_text)
      VALUES (${s.id}, ${phase}, ${r.scale_id}, ${r.block_id}, ${r.item_id}, ${JSON.stringify(r.value)}::jsonb, ${r.display_order}, ${r.shown_text})
      ON CONFLICT (session_id, phase, item_id)
      DO UPDATE SET value = EXCLUDED.value, display_order = EXCLUDED.display_order, shown_text = EXCLUDED.shown_text, created_at = now()`),
    touchStatement(sql, s.id),
  ]);
  return res.status(200).json({ ok: true });
}

// ---------- answers + feedback ----------

const msBetween = (a, b) => new Date(b).getTime() - new Date(a).getTime();

// Voice condition: the participant's page gets no text at all, only that the audio is ready (test sessions get
// it as dev_text for the dev panel).
const feedbackPayload = (s, a) => ({
  state: "done",
  generation_ms: msBetween(a.created_at, a.finished_at), // real generation latency (the page may hold it back longer)
  ...(s.modality === "voice"
    ? { modality: "voice", audio_seconds: Number(a.audio_seconds), ...(s.is_test && { dev_text: a.feedback }) }
    : { feedback: a.feedback }),
  ...(s.is_test && { stance: s.stance, scores: a.scores, strong: a.strong, weak: a.weak }),
});

// New 'pending' row for a confirmed answer. null if another request already created the live row.
async function insertPending(s, a) {
  try {
    const [row] = await db()`
      INSERT INTO answers (session_id, question_id, attempt, transcript, answer_truncated, answer_short, injected,
                           client_transcript, status, stance, model,
                           stage1_raw, scores, strong, weak, context, stage2_raw, feedback)
      VALUES (${s.id}, ${a.question_id}, ${a.attempt}, ${a.transcript}, ${!!a.truncated}, ${!!a.short}, ${!!a.injected},
              ${a.client_transcript ?? null}, 'pending', ${s.stance}, ${MODEL},
              ${a.reuse?.stage1_raw ?? null}, ${a.reuse?.scores ? JSON.stringify(a.reuse.scores) : null}::jsonb, ${a.reuse?.strong ?? null},
              ${a.reuse?.weak ?? null}, ${a.reuse?.context ?? null}, ${a.reuse?.stage2_raw ?? null}, ${a.reuse?.feedback ?? null})
      RETURNING id`;
    return row.id;
  } catch (e) {
    if (isUniqueViolation(e)) return null;
    throw e;
  }
}

// Spoken feedback: normalize the text (minimal), synthesize it (retrying), store the mp3 in the private Blob store and
// record text before / after, rules, model, settings, length and latency. Throws when it still fails after the retries.
async function makeVoice(s, rowId, question_id, text) {
  const { text: spoken, rules } = normalizeForTts(text);
  const t0 = performance.now();
  const r = await synthesize(spoken);
  const pathname = `${blobPrefix()}/${s.id}/${question_id}/feedback.mp3`;
  const { put } = await import("@vercel/blob");
  await withRetries(() => put(pathname, r.audio, { access: "private", contentType: "audio/mpeg", allowOverwrite: true }));
  const totalMs = Math.round(performance.now() - t0); // every TTS attempt + storing the file
  await db()`
    INSERT INTO feedback_audio (answer_id, session_id, question_id, text_original, text_tts, rules, pathname, chars, audio_seconds,
                                tts_latency_ms, tts_total_ms, attempts, model_id, voice_id, voice_settings, output_format, request_id)
    VALUES (${rowId}, ${s.id}, ${question_id}, ${text}, ${spoken}, ${JSON.stringify({ version: C.TTS.textRulesVersion, applied: rules })}::jsonb,
            ${pathname}, ${[...spoken].length}, ${mp3DurationSeconds(r.audio).toFixed(3)}, ${r.latency_ms}, ${totalMs},
            ${r.attempts}, ${r.model_id}, ${r.voice_id}, ${JSON.stringify(r.voice_settings)}::jsonb, ${r.output_format}, ${r.request_id})
    ON CONFLICT (answer_id) DO NOTHING`;
}

// Stage 1 + Stage 2 (+ the audio in the voice condition), then store the outcome. `reuse`: an earlier row's finished
// text, when only the audio is missing. Never rejects: it runs in the background after the response.
// Partial results are kept too (e.g. Stage 1 succeeded, Stage 2 failed) — useful when debugging.
// Voice: the row stays 'pending' until the audio is stored, so the page learns "ready" only when it can play. A TTS
// failure after the retries locks the session (tts_error) — the text is never offered instead, that would change the condition.
async function generate(s, rowId, question_id, transcript, reuse = null) {
  const voice = s.modality === "voice";
  let a = null, f = null, error = null;
  if (reuse) {
    a = { raw: reuse.stage1_raw, scores: reuse.scores, strong: reuse.strong, weak: reuse.weak, context: reuse.context };
    f = { raw: reuse.stage2_raw, feedback: reuse.feedback };
  } else {
    try {
      a = await assess(QUESTIONS[question_id], transcript);
      f = await generateFeedback(a.context, s.stance);
    } catch (e) {
      error = String(e?.message || e);
      console.error("[feedback] generation failed:", error);
    }
  }
  const final = !!error || !voice;
  try {
    await db()`
      UPDATE answers SET status = CASE WHEN ${error !== null}::boolean THEN 'error' WHEN ${voice}::boolean THEN 'pending' ELSE 'done' END,
             finished_at = CASE WHEN ${final}::boolean THEN now() ELSE NULL END,
             stage1_raw = ${a?.raw ?? null}, scores = ${a ? JSON.stringify(a.scores) : null}::jsonb,
             strong = ${a?.strong ?? null}, weak = ${a?.weak ?? null}, context = ${a?.context ?? null},
             stage2_raw = ${f?.raw ?? null}, feedback = ${f?.feedback ?? null}, error = ${error}
      WHERE id = ${rowId}`;
  } catch (e) {
    console.error("[feedback] could not store the result:", e);
    return;
  }
  if (final) return;
  try {
    await makeVoice(s, rowId, question_id, f.feedback);
    await db()`UPDATE answers SET status = 'done', finished_at = now() WHERE id = ${rowId}`;
  } catch (e) {
    const msg = `tts: ${String(e?.message || e).slice(0, 300)}`;
    console.error("[feedback] voice failed:", msg);
    try {
      // lock first: a poll between the two steps must find the locked session, not a retryable error row
      await lockSession(s.id, "tts_error", { question_id, error: msg, attempts: e?.attempts ?? null });
      await db()`UPDATE answers SET status = 'error', finished_at = now(), error = ${msg} WHERE id = ${rowId}`;
    } catch (e2) {
      console.error("[feedback] could not lock the session after the TTS failure:", e2);
    }
  }
}

const startGeneration = (s, rowId, question_id, transcript, reuse = null) => waitUntil(generate(s, rowId, question_id, transcript, reuse));

const isStale = (row) => Date.now() - new Date(row.created_at).getTime() >= C.ANSWER_PENDING_STALE_MS;

// A 'pending' row older than ANSWER_PENDING_STALE_MS was orphaned by a function that died: nothing was
// ever shown, so retire it and generate from the same stored answer.
async function restartStale(s, live) {
  const sql = db();
  await sql`UPDATE answers SET status = 'stale', finished_at = now() WHERE id = ${live.id} AND status = 'pending'`;
  // voice: the text may already exist (the function died during the TTS): keep it, only the audio is missing
  const reuse = live.feedback ? live : null;
  const rowId = await insertPending(s, {
    question_id: live.question_id, attempt: live.attempt, transcript: live.transcript, truncated: live.answer_truncated,
    short: live.answer_short, injected: live.injected, client_transcript: live.client_transcript, reuse,
  });
  if (rowId) startGeneration(s, rowId, live.question_id, live.transcript, reuse);
}

async function answer(req, res, s) {
  const { question_id, transcript: sent, injected = false, client_transcript = null, interrupted = false } = req.body || {};
  if (!QUESTIONS[question_id]) return res.status(400).json({ error: "unknown question_id" });
  if (injected && !s.is_test) return res.status(403).json({ error: "injection is only allowed in test sessions" });
  if (injected && (typeof sent !== "string" || !sent.trim() || sent.length > MAX_TRANSCRIPT)) {
    return res.status(400).json({ error: "transcript required" });
  }
  if (client_transcript !== null && (typeof client_transcript !== "string" || client_transcript.length > MAX_TRANSCRIPT)) {
    return res.status(400).json({ error: "client_transcript must be a string" });
  }
  const sql = db();
  const attempt = currentAttempt(s);

  // Feedback is generated once per question: a finished one stands, a running one is waited on.
  const [live] = await sql`
    SELECT * FROM answers WHERE session_id = ${s.id} AND question_id = ${question_id} AND status IN ('pending', 'done') LIMIT 1`;
  if (live?.status === "done") return res.status(200).json({ state: "done" });
  if (live) {
    if (isStale(live)) await restartStale(s, live);
    return res.status(200).json({ state: "pending" });
  }

  // An earlier generation failed: run it again on the same confirmed answer (no new answer, no retry accounting).
  const [failed] = await sql`
    SELECT * FROM answers WHERE session_id = ${s.id} AND question_id = ${question_id} AND attempt = ${attempt} AND status = 'error'
    ORDER BY id DESC LIMIT 1`;
  if (failed) {
    const rowId = await insertPending(s, {
      question_id, attempt, transcript: failed.transcript, truncated: failed.answer_truncated, short: failed.answer_short,
      injected: failed.injected, client_transcript: failed.client_transcript,
    });
    if (rowId) startGeneration(s, rowId, question_id, failed.transcript);
    return res.status(200).json({ state: "pending" });
  }

  // A new answer: what the server has saved for this attempt (dev injection sends its own text).
  const transcript = injected ? sent.trim() : await savedTranscript(s.id, question_id, attempt);
  const chars = meaningfulLength(transcript);
  if (!injected && chars < C.EMPTY_ANSWER_MIN_CHARS && await grantRetry(s.id, "empty_answer", { question_id, chars })) {
    await touchStatement(sql, s.id);
    return res.status(200).json({ retry: true, attempt: attempt + 1 });
  }
  // The re-answer chance is spent. Short: feedback anyway, flagged. Nothing at all: a technical failure —
  // no feedback (so no exposure), lock, and return the slot.
  if (chars === 0 && !injected) {
    await lockSession(s.id, "empty_answer", { question_id, attempt });
    return res.status(410).json({ error: "empty answer", screen: "locked_error" });
  }

  const rowId = await insertPending(s, {
    question_id, attempt, transcript, truncated: !!interrupted, short: chars < C.EMPTY_ANSWER_MIN_CHARS, injected, client_transcript,
  });
  await touchStatement(sql, s.id);
  if (rowId) startGeneration(s, rowId, question_id, transcript);
  return res.status(200).json({ state: "pending" });
}

async function feedbackRoute(req, res, s) {
  const question_id = req.query.question_id;
  if (!QUESTIONS[question_id]) return res.status(400).json({ error: "unknown question_id" });
  const [row] = await db()`
    SELECT a.*, fa.audio_seconds FROM answers a LEFT JOIN feedback_audio fa ON fa.answer_id = a.id
    WHERE a.session_id = ${s.id} AND a.question_id = ${question_id} AND a.status IN ('pending', 'done', 'error')
    ORDER BY a.id DESC LIMIT 1`;
  if (!row) return res.status(200).json({ state: "none" });
  if (row.status === "done") return res.status(200).json(feedbackPayload(s, row));
  if (row.status === "error") return res.status(200).json({ state: "error" }); // details stay in answers.error
  if (isStale(row)) await restartStale(s, row);
  return res.status(200).json({ state: "pending" });
}

// The spoken feedback of a voice session. Only the tab holding the session's claim gets it (the guard), and it
// is never regenerated here: this just hands out the stored file.
async function feedbackAudio(req, res, s) {
  const question_id = req.query.question_id;
  if (!QUESTIONS[question_id]) return res.status(400).json({ error: "unknown question_id" });
  if (s.modality !== "voice") return res.status(404).json({ error: "no audio for this session" });
  const [row] = await db()`
    SELECT fa.pathname FROM feedback_audio fa JOIN answers a ON a.id = fa.answer_id
    WHERE fa.session_id = ${s.id} AND fa.question_id = ${question_id} AND a.status = 'done' ORDER BY fa.created_at DESC LIMIT 1`;
  if (!row) return res.status(404).json({ error: "audio not ready" });
  const { get } = await import("@vercel/blob");
  const file = await get(row.pathname, { access: "private", useCache: false });
  if (!file || file.statusCode !== 200) return res.status(502).json({ error: "audio unavailable" });
  const bytes = Buffer.from(await new Response(file.stream).arrayBuffer());
  res.setHeader("content-type", "audio/mpeg");
  res.setHeader("cache-control", "private, no-store");
  res.setHeader("content-length", String(bytes.length));
  res.status(200);
  res.end(bytes);
}

// ---------- mid-answer saves ----------

function partKey(s, question_id, attempt, seq) {
  if (!QUESTIONS[question_id]) return "unknown question_id";
  if (attempt !== currentAttempt(s)) return "stale attempt"; // 400, not 409: the page treats 409 as another window
  if (!Number.isInteger(seq) || seq < 0 || seq > 100000) return "seq must be an integer 0–100000";
  return null;
}

async function segment(req, res, s) {
  const { question_id, attempt, seq, text, client_ts = null } = req.body || {};
  const bad = partKey(s, question_id, attempt, seq) ||
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

// Bytes go to a private Vercel Blob store (BLOB_READ_WRITE_TOKEN, or OIDC with BLOB_STORE_ID); the path
// carries no participant_id. BLOB_PREFIX separates environments, since Blob stores aren't branched like the database.
async function audio(req, res, s) {
  if (!C.AUDIO_UPLOAD_ENABLED) return res.status(403).json({ error: "audio upload is disabled" });
  const q = req.query;
  const question_id = q.question_id, attempt = Number(q.attempt), seq = Number(q.seq);
  const client_ts = q.client_ts ? Number(q.client_ts) : null;
  const bad = partKey(s, question_id, attempt, seq) ||
    (client_ts !== null && !Number.isSafeInteger(client_ts) ? "client_ts must be Date.now()" : null);
  if (bad) return res.status(400).json({ error: bad });
  const mime = String(req.headers["content-type"] || "").split(";")[0].trim();
  const ext = AUDIO_TYPES[mime];
  if (!ext) return res.status(415).json({ error: `unsupported audio type ${mime}` });

  const body = await readRaw(req, C.AUDIO_MAX_BYTES);
  if (!body.length) return res.status(400).json({ error: "empty audio chunk" });
  const pathname = `${blobPrefix()}/${s.id}/${question_id}/a${attempt}/${seq}.${ext}`;
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

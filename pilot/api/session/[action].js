// Participant-device API. Auth: `Authorization: Bearer <token>` issued by /api/researcher/create.
//   GET  /api/session/state   -> where to resume after a reload
//   POST /api/session/event   { id, type, question_id?, client_ts }
//   POST /api/session/answer  { question_id, transcript, injected? }  -> { feedback }
//   POST /api/session/survey  { phase, block, answers }   one survey block (re-submitting overwrites)
// The session's condition never leaves the server for real sessions (test sessions get it for dev mode).

import { db } from "../../lib/db.js";
import { requireParticipant } from "../../lib/auth.js";
import { assess, generateFeedback, MODEL } from "../../lib/llm.js";
import { CLIENT_EVENT_TYPES, QUESTION_EVENT_TYPES, stageAfter } from "../../lib/stages.js";
import { validateBlock } from "../../lib/survey.js";
import { QUESTIONS, PRACTICE_ID } from "../../src/questions.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TRANSCRIPT = 20000;

export default async function handler(req, res) {
  const action = req.query.action;
  const route = { "GET state": state, "POST event": event, "POST answer": answer, "POST survey": survey }[`${req.method} ${action}`];
  if (!route) return res.status(404).json({ error: "not found" });
  try {
    const session = await requireParticipant(req, res);
    if (!session) return;
    return await route(req, res, session);
  } catch (e) {
    console.error(`[session/${action}]`, e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}

async function state(req, res, s) {
  // latest successful answer per question, so a reload on a feedback screen shows the same feedback
  const rows = await db()`
    SELECT DISTINCT ON (question_id) question_id, transcript, feedback, scores, strong, weak
    FROM answers WHERE session_id = ${s.id} AND (feedback IS NOT NULL OR question_id = ${PRACTICE_ID})
    ORDER BY question_id, id DESC`;
  const answers = {};
  for (const r of rows) {
    answers[r.question_id] = { transcript: r.transcript, feedback: r.feedback };
    if (s.is_test) Object.assign(answers[r.question_id], { scores: r.scores, strong: r.strong, weak: r.weak });
  }
  // survey blocks already submitted, so a reload resumes at the first unanswered block
  const done = await db()`SELECT DISTINCT phase, scale_id FROM responses WHERE session_id = ${s.id}`;
  const surveys = { pre: [], post: [] };
  for (const r of done) surveys[r.phase].push(r.scale_id);
  return res.status(200).json({
    stage: s.current_stage,
    is_test: s.is_test,
    ...(s.is_test && { condition: s.condition }),
    answers,
    surveys,
  });
}

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
  const stage = stageAfter(type, question_id);
  const insert = sql`
    INSERT INTO events (id, session_id, type, question_id, client_ts)
    VALUES (${id}, ${s.id}, ${type}, ${question_id}, ${client_ts})
    ON CONFLICT (id) DO NOTHING`;
  if (stage) {
    await sql.transaction([
      insert,
      sql`UPDATE sessions SET current_stage = ${stage}, updated_at = now() WHERE id = ${s.id}`,
    ]);
  } else {
    await insert;
  }
  return res.status(200).json({ ok: true, stage: stage ?? s.current_stage });
}

async function answer(req, res, s) {
  const { question_id, transcript, injected = false } = req.body || {};
  const isPractice = question_id === PRACTICE_ID;
  if (!isPractice && !QUESTIONS[question_id]) return res.status(400).json({ error: "unknown question_id" });
  if (typeof transcript !== "string" || !transcript.trim() || transcript.length > MAX_TRANSCRIPT) {
    return res.status(400).json({ error: "transcript required" });
  }
  if (injected && !s.is_test) return res.status(403).json({ error: "injection is only allowed in test sessions" });

  const sql = db();
  if (isPractice) {
    await sql`INSERT INTO answers (session_id, question_id, transcript, injected)
              VALUES (${s.id}, ${PRACTICE_ID}, ${transcript}, ${!!injected})`;
    return res.status(200).json({ ok: true });
  }

  let a = null, f = null, error = null;
  try {
    a = await assess(QUESTIONS[question_id], transcript);
    f = await generateFeedback(a.context, s.condition);
  } catch (e) {
    error = String(e?.message || e);
  }
  // persist partial results too (e.g. Stage 1 succeeded, Stage 2 failed) — useful when debugging
  await sql`
    INSERT INTO answers (session_id, question_id, transcript, injected, condition, model,
                         stage1_raw, scores, strong, weak, context, stage2_raw, feedback, error)
    VALUES (${s.id}, ${question_id}, ${transcript}, ${!!injected}, ${s.condition}, ${MODEL},
            ${a?.raw ?? null}, ${a ? JSON.stringify(a.scores) : null}::jsonb, ${a?.strong ?? null},
            ${a?.weak ?? null}, ${a?.context ?? null}, ${f?.raw ?? null}, ${f?.feedback ?? null}, ${error})`;
  if (error) return res.status(502).json({ error });

  return res.status(200).json({
    feedback: f.feedback,
    ...(s.is_test && { condition: s.condition, scores: a.scores, strong: a.strong, weak: a.weak }),
  });
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
  ]);
  return res.status(200).json({ ok: true });
}

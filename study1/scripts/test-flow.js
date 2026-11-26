// End-to-end participant API test: calls api/session/[action].js the way the browser does, against a
// scratch database branch. Makes two real LLM calls (Stage 1 + Stage 2 each). Deletes what it created.
//   npm run test:flow -- --host <neon endpoint id of the dev branch>
// The audio upload / purge part runs only with Blob credentials (BLOB_STORE_ID + VERCEL_OIDC_TOKEN, e.g.
// `vercel env pull .env.blob --environment=preview` then add `--env-file=.env.blob`) and AUDIO_UPLOAD_ENABLED=true.

import crypto from "crypto";
import { parseArgs } from "node:util";
import { db } from "../lib/db.js";
import { SURVEY } from "../lib/survey.js";
import { newParticipantToken } from "../lib/auth.js";
import { sweep } from "../lib/lifecycle.js";
import { purgeWithdrawn, purgeVerifiedAudio } from "../lib/purge.js";
import { AUDIO_UPLOAD_ENABLED } from "../lib/config.js";
import { OTHER_LABEL, optionsOf } from "../src/survey-shared.js";
import handler from "../api/session/[action].js";
import { requireEndpoint } from "./cli.js";

const { values } = parseArgs({ options: { host: { type: "string" } } });
requireEndpoint(values.host);

const sql = db();
const created = [];
let passed = 0, failed = 0;
function check(name, ok, info = "") {
  if (ok) passed++; else failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? `  (${info})` : ""}`);
}

async function issue(pid, { expiresInMs = 86400_000, test = false } = {}) {
  const id = crypto.randomUUID();
  const { token, hash } = newParticipantToken();
  await sql`INSERT INTO sessions (id, participant_id, batch_id, is_test, token_hash, expires_at, stance, modality)
            VALUES (${id}, ${pid}, 'TEST', ${test}, ${hash}, ${new Date(Date.now() + expiresInMs).toISOString()},
                    ${test ? "direct" : null}, ${test ? "text" : null})`;
  created.push(id);
  return { id, token };
}

// one browser tab
function tab({ token }) {
  const key = crypto.randomUUID();
  const call = (method, action, body) => new Promise((resolve, reject) => {
    const res = {
      code: 200,
      status(c) { this.code = c; return this; },
      json(d) { resolve({ code: this.code, ...d }); },
    };
    handler({ query: { action }, method, body, headers: { authorization: `Bearer ${token}`, "x-client-key": key } }, res).catch(reject);
  });
  // raw-body upload: the handler reads the request as a stream
  const upload = (query, bytes, mime) => new Promise((resolve, reject) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(d) { resolve({ code: this.code, ...d }); } };
    const req = {
      query: { action: "audio", ...query }, method: "POST",
      headers: { authorization: `Bearer ${token}`, "x-client-key": key, "content-type": mime },
      async *[Symbol.asyncIterator]() { yield bytes; },
    };
    handler(req, res).catch(reject);
  });
  return {
    claim: () => call("POST", "claim", { user_agent: "test-flow", screen: { w: 1440, h: 900, vw: 1200, vh: 800, dpr: 2 } }),
    consent: (choices = { withdraw_data: "use", notify: "no" }) => call("POST", "consent", { agree: true, ...choices }),
    audio: (question_id, attempt, seq, bytes) =>
      upload({ question_id, attempt: String(attempt), seq: String(seq), client_ts: String(Date.now()) }, bytes, "audio/webm"),
    release: () => call("POST", "release", {}),
    heartbeat: () => call("POST", "heartbeat", {}),
    event: (type, question_id = null) => call("POST", "event", { id: crypto.randomUUID(), type, question_id, client_ts: Date.now() }),
    survey: (phase, block, answers) => call("POST", "survey", { phase, block, answers }),
    answer: (question_id, transcript, from_saved = false) => call("POST", "answer", { question_id, transcript, from_saved }),
    segment: (question_id, attempt, seq, text) => call("POST", "segment", { question_id, attempt, seq, text, client_ts: Date.now() }),
  };
}

// a valid answer for every item of a block; attention checks correct unless failChecks
function fill(block, { failChecks = false } = {}) {
  const a = {};
  for (const item of block.items) {
    if (item.check) {
      const correct = [].concat(item.check.correct)[0];
      a[item.id] = failChecks ? (correct === block.scale.min ? correct + 1 : correct - 1) : correct;
      continue;
    }
    switch (item.type) {
      case undefined: a[item.id] = block.scale.min; break;
      case "single": a[item.id] = optionsOf(item).find((o) => o !== OTHER_LABEL); break;
      case "multi": a[item.id] = [optionsOf(item).find((o) => o !== OTHER_LABEL)]; break;
      case "number": a[item.id] = 25; break;
    }
  }
  return a;
}
const GOOD_ANSWER = "작년 학과 학생회에서 신입생 멘토링 프로그램을 제가 처음 기획했습니다. 지원자가 적어서 직접 공지를 돌리고 "
  + "선배 열두 명을 모아 일정을 짰고, 한 학기 동안 운영해서 신입생 만족도 조사에서 평균 4.5점을 받았습니다.";

try {
  // 1. expired link
  const ex = await issue("TF-EXP", { expiresInMs: -60_000 });
  check("expired link -> expired screen", (await tab(ex).claim()).screen === "expired");

  // 2. main path
  const s = await issue("TF-001");
  const A = tab(s), B = tab(s);
  const c1 = await A.claim();
  check("first open -> consent screen", c1.screen === "consent" && c1.claim === "first");
  check("second window -> other_window", (await B.claim()).screen === "other_window");
  check("second window can't act", (await B.consent()).code === 409);
  check("consent without the choices refused", (await A.consent({ withdraw_data: "use" })).code === 400);
  const c2 = await A.consent({ withdraw_data: "use", notify: "yes" });
  check("consent -> active, pre_survey", c2.screen === "active" && c2.resume_to.to === "pre_survey" && !("stance" in c2));
  const [row] = await sql`SELECT * FROM sessions WHERE id = ${s.id}`;
  check("consented with a cell + snapshot", row.status === "consented" && row.stance && row.modality && row.config?.prompts?.stage1_sha256);
  check("snapshot records the temperatures", row.config.llm.stage1_temperature === 0 && row.config.llm.stage2_temperature === 0.3);
  check("consent choices stored", row.consent_withdraw_data === "use" && row.consent_notify === "yes");

  for (const b of SURVEY.pre) await A.survey("pre", b.block, fill(b));
  await A.event("survey_pre_submitted");
  await A.event("scenario_shown");
  check("in_progress after first activity", (await sql`SELECT status FROM sessions WHERE id = ${s.id}`)[0].status === "in_progress");
  await A.event("practice_start"); await A.event("practice_end");
  await A.answer("practice", "안녕하세요 저는 테스트입니다");
  await A.event("question_shown", "q2"); await A.event("answer_start", "q2"); await A.event("answer_end", "q2");

  const r1 = await A.answer("q2", "음");
  check("empty answer -> retry granted", r1.retry === true && r1.attempt === 2);
  await A.event("question_shown", "q2"); await A.event("answer_start", "q2"); await A.event("answer_end", "q2");
  const t0 = Date.now();
  const r2 = await A.answer("q2", GOOD_ANSWER);
  check("answer -> feedback", typeof r2.feedback === "string" && r2.feedback.length > 20, `${Date.now() - t0} ms`);
  const r3 = await A.answer("q2", "다른 답변");
  const [{ n: generated }] = await sql`SELECT count(*)::int AS n FROM answers WHERE session_id = ${s.id} AND question_id = 'q2' AND status = 'done'`;
  check("re-submit returns the same feedback, no regeneration", r3.feedback === r2.feedback && generated === 1);
  await A.event("feedback_shown", "q2");

  // reload of the same tab mid-flow resumes at the stored feedback
  const c3 = await A.claim();
  check("reload -> same feedback, not a resume", c3.claim === "reload" && c3.resume_to.to === "feedback" && c3.answers.q2.feedback === r2.feedback);
  check("reload didn't count", (await sql`SELECT resume_count FROM sessions WHERE id = ${s.id}`)[0].resume_count === 0);

  await A.event("next_clicked", "q2");
  for (const b of SURVEY.post) await A.survey("post", b.block, fill(b));
  await A.event("survey_post_submitted");
  const [fin] = await sql`SELECT status, valid, current_stage FROM sessions WHERE id = ${s.id}`;
  check("completed, AT1+AT2 correct -> valid", fin.status === "completed" && fin.valid === true && fin.current_stage === "done");
  check("valid completion keeps its slot", !(await sql`SELECT returned_at FROM slot_assignments WHERE session_id = ${s.id}`)[0].returned_at);
  check("completed link -> completed screen", (await tab(s).claim()).screen === "completed");
  check("writes after completion rejected", (await A.event("next_clicked", "q2")).code === 410);

  // 3. interrupted mid-answer with almost nothing saved -> re-answer (spends the retry chance)
  const r = await issue("TF-002");
  const R1 = tab(r);
  await R1.claim(); await R1.consent();
  await sql`UPDATE sessions SET current_stage = 'q2_answering' WHERE id = ${r.id}`;
  await R1.event("question_shown", "q2"); await R1.event("answer_start", "q2");
  await R1.segment("q2", 1, 0, "음 저는");
  await R1.release();
  const R2 = tab(r);
  const rc = await R2.claim();
  check("resume after short partial -> re-answer", rc.claim === "resume" && rc.resume_to.to === "question" && rc.resume_to.reanswer && rc.attempt === 2);

  // 4. interrupted again (retry used, enough saved) -> but that is the second exit: locked
  await R2.event("question_shown", "q2"); await R2.event("answer_start", "q2");
  await R2.segment("q2", 2, 0, "제가 주도한 일은 학과 행사였습니다");
  await R2.release();
  check("second resume -> locked", (await tab(r).claim()).screen === "locked");

  // 5. first interruption with enough saved text -> submit the saved transcript (truncated)
  const t = await issue("TF-003");
  const T1 = tab(t);
  await T1.claim(); await T1.consent();
  await sql`UPDATE sessions SET current_stage = 'q2_answering' WHERE id = ${t.id}`;
  await T1.event("question_shown", "q2"); await T1.event("answer_start", "q2");
  await T1.segment("q2", 1, 0, "작년에 학과 행사를 제가 처음부터");
  await T1.segment("q2", 1, 1, "기획해서 끝까지 진행했습니다");
  await T1.release();
  const tc = await tab(t).claim();
  check("resume with enough saved -> submit_saved", tc.claim === "resume" && tc.resume_to.to === "submit_saved");
  const [{ t: savedText }] = await sql`
    SELECT string_agg(text, ' ' ORDER BY seq) AS t FROM answer_segments WHERE session_id = ${t.id} AND attempt = 1`;
  check("segments joined in order", savedText === "작년에 학과 행사를 제가 처음부터 기획해서 끝까지 진행했습니다");

  // 6. audio upload is off by default
  const au = await new Promise((resolve) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(d) { resolve({ code: this.code, ...d }); } };
    handler({ query: { action: "audio", question_id: "q2", attempt: "1", seq: "0" }, method: "POST",
      headers: { authorization: "Bearer x", "x-client-key": "y" } }, res);
  });
  check("audio without a valid token -> 401", au.code === 401);

  // 7. attention check failed -> valid=false, slot returned (not exposed: no feedback was shown)
  const w = await issue("TF-004");
  const W = tab(w);
  await W.claim(); await W.consent();
  for (const b of SURVEY.pre) await W.survey("pre", b.block, fill(b, { failChecks: b.block === "SMI" }));
  for (const b of SURVEY.post) await W.survey("post", b.block, fill(b));
  await W.event("survey_post_submitted");
  const [wv] = await sql`SELECT s.status, s.valid, a.return_reason, a.exposed FROM sessions s JOIN slot_assignments a ON a.session_id = s.id WHERE s.id = ${w.id}`;
  check("AT1 wrong -> completed, valid=false, slot returned (invalid)", wv.status === "completed" && wv.valid === false && wv.return_reason === "invalid" && wv.exposed === false);
  const [audit] = await sql`SELECT detail FROM audit_log WHERE session_id = ${w.id} AND action = 'completed'`;
  check("audit records the failed check", JSON.stringify(audit.detail.failed) === JSON.stringify(["AT1"]));

  // 8. empty string after the re-answer chance -> locked (technical failure), slot returned unexposed
  const e = await issue("TF-005");
  const E = tab(e);
  await E.claim(); await E.consent();
  check("first empty answer -> retry", (await E.answer("q2", "")).retry === true);
  const e2 = await E.answer("q2", "   ");
  const [ev] = await sql`SELECT s.status, s.lock_reason, a.return_reason, a.exposed FROM sessions s JOIN slot_assignments a ON a.session_id = s.id WHERE s.id = ${e.id}`;
  check("second empty answer -> locked_error", e2.code === 410 && e2.screen === "locked_error" && ev.status === "locked" && ev.lock_reason === "empty_answer");
  check("slot returned, exposed=false", ev.return_reason === "locked" && ev.exposed === false);
  check("no feedback generated", (await sql`SELECT count(*)::int AS n FROM answers WHERE session_id = ${e.id}`)[0].n === 0);
  check("reopening shows locked_error", (await tab(e).claim()).screen === "locked_error");

  // 9. short (1–9 chars) after the re-answer chance -> feedback, answer_short=true
  const sh = await issue("TF-006");
  const SH = tab(sh);
  await SH.claim(); await SH.consent();
  await SH.answer("q2", "음");
  const shr = await SH.answer("q2", "네 했어요");
  const [sha] = await sql`SELECT answer_short, status FROM answers WHERE session_id = ${sh.id} AND question_id = 'q2'`;
  check("short answer after retry -> feedback, answer_short", typeof shr.feedback === "string" && sha.answer_short === true && sha.status === "done");

  // 10. withdrawal with 'destroy' -> destroy_pending on abandonment -> purge keeps only the bookkeeping
  const d = await issue("TF-007");
  const Dt = tab(d);
  await Dt.claim(); await Dt.consent({ withdraw_data: "destroy", notify: "no" });
  for (const b of SURVEY.pre) await Dt.survey("pre", b.block, fill(b));
  await Dt.event("survey_pre_submitted");
  await Dt.segment("q2", 1, 0, "중간에 그만둔 답변");
  await sql`UPDATE sessions SET last_activity_at = now() - interval '3 hours' WHERE id = ${d.id}`;
  await sweep(d.id);
  const [dp] = await sql`SELECT status, destroy_pending FROM sessions WHERE id = ${d.id}`;
  check("destroy + abandoned -> destroy_pending", dp.status === "abandoned" && dp.destroy_pending === true);
  const purged = await purgeWithdrawn();
  const mine = purged.find((p) => p.participant_id === "TF-007");
  check("purge-withdrawn found it", !!mine && mine.deleted.responses > 0 && mine.deleted.events > 0);
  const left = {};
  for (const t of ["responses", "answers", "answer_segments", "events", "session_clients", "audio_chunks"]) {
    left[t] = (await sql.query(`SELECT count(*)::int AS n FROM ${t} WHERE session_id = $1`, [d.id]))[0].n;
  }
  const [kept] = await sql`SELECT s.status, s.stance, s.modality, s.data_purged_at, a.slot_seq FROM sessions s JOIN slot_assignments a ON a.session_id = s.id WHERE s.id = ${d.id}`;
  check("participant data deleted", Object.values(left).every((n) => n === 0), JSON.stringify(left));
  check("status, condition, slot assignment kept", kept.status === "abandoned" && kept.stance && kept.modality && kept.slot_seq && kept.data_purged_at);
  check("use-choice sessions untouched", !purged.some((p) => p.participant_id !== "TF-007"));

  // 11. audio upload -> verified -> purge (needs Blob credentials)
  if (!AUDIO_UPLOAD_ENABLED || !(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN)) {
    console.log("SKIP  audio upload / purge (no Blob credentials or AUDIO_UPLOAD_ENABLED is off)");
  } else {
    const v = await issue("TF-008");
    const V = tab(v);
    await V.claim(); await V.consent();
    const bytes = crypto.randomBytes(2048);
    const up = await V.audio("q2", 1, 0, bytes);
    const [chunk] = await sql`SELECT pathname, bytes FROM audio_chunks WHERE session_id = ${v.id}`;
    check("audio chunk uploaded (OIDC / token auth)", up.code === 200 && chunk?.bytes === 2048,
      chunk ? chunk.pathname.replace(v.id, "<session>") : up.error);
    if (chunk) {
      const { get } = await import("@vercel/blob");
      const before = await get(chunk.pathname, { access: "private", useCache: false });
      check("blob is private and readable server-side", before?.statusCode === 200);
      await sql`UPDATE sessions SET audio_verified_at = now() WHERE id = ${v.id}`;
      const pa = await purgeVerifiedAudio();
      const after = await get(chunk.pathname, { access: "private", useCache: false });
      const [vs] = await sql`SELECT s.audio_purged_at, c.purged_at FROM sessions s JOIN audio_chunks c ON c.session_id = s.id WHERE s.id = ${v.id}`;
      check("purge-audio deletes the blob, keeps the metadata", pa.some((p) => p.participant_id === "TF-008") && after === null && vs.audio_purged_at && vs.purged_at);
    }
  }
} finally {
  for (const t of ["audit_log", "events", "session_clients", "answers", "answer_segments", "audio_chunks", "responses"]) {
    await sql.query(`DELETE FROM ${t} WHERE session_id = ANY($1::uuid[])`, [created]);
  }
  const assigns = await sql`SELECT id FROM slot_assignments WHERE session_id = ANY(${created}::uuid[]) ORDER BY id DESC`;
  for (const a of assigns) await sql`DELETE FROM slot_assignments WHERE id = ${a.id}`;
  await sql`DELETE FROM sessions WHERE id = ANY(${created}::uuid[])`;
  console.log(`cleaned up ${created.length} test session(s)`);
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

// End-to-end participant API test: calls api/session/[action].js the way the browser does, against a
// scratch database branch. Makes several real LLM calls (Stage 1 + Stage 2 each). Deletes what it created.
//   npm run test:flow -- --host <neon endpoint id of the dev branch>
// The audio upload / purge part runs only with Blob credentials (BLOB_STORE_ID + VERCEL_OIDC_TOKEN, e.g.
// `vercel env pull .env.blob --environment=development` then add `--env-file=.env.blob`) and AUDIO_UPLOAD_ENABLED=true.

import crypto from "crypto";
import { parseArgs } from "node:util";
import { SURVEY, orderBlock } from "../lib/survey.js";
import { sweep } from "../lib/lifecycle.js";
import { purgeWithdrawn, purgeVerifiedAudio } from "../lib/purge.js";
import { AUDIO_UPLOAD_ENABLED } from "../lib/config.js";
import { requireEndpoint } from "./cli.js";
import { createHarness, fill, sleep } from "./test-lib.js";

const { values } = parseArgs({ options: { host: { type: "string" } } });
requireEndpoint(values.host);

const H = createHarness();
const { sql, check, issue, tab, started } = H;

const GOOD_ANSWER = "작년 학과 학생회에서 신입생 멘토링 프로그램을 제가 처음 기획했습니다. 지원자가 적어서 직접 공지를 돌리고 "
  + "선배 열두 명을 모아 일정을 짰고, 한 학기 동안 운영해서 신입생 만족도 조사에서 평균 4.5점을 받았습니다.";

try {
  // ---------- unit-ish: survey order ----------
  const blk = { items: [{ id: "a" }, { id: "b" }, { id: "FIX", fixed: true }, { id: "c" }, { id: "d" }, { id: "e" }] };
  let keepsFixed = true, distinct = new Set();
  for (let i = 0; i < 200; i++) {
    const o = orderBlock(blk);
    distinct.add(o.join());
    if (o[2] !== "FIX" || new Set(o).size !== 6) keepsFixed = false;
  }
  check("fixed item keeps its position, the rest are shuffled", keepsFixed && distinct.size > 20, `${distinct.size} orders`);
  check("shuffle:false keeps config order", orderBlock({ shuffle: false, items: [{ id: "x" }, { id: "y" }] }).join() === "x,y");

  // ---------- 1. expired link ----------
  const ex = await issue("TF-EXP", { expiresInMs: -60_000 });
  check("expired link -> expired screen", (await tab(ex).claim()).screen === "expired");

  // ---------- 2. main path ----------
  const s = await issue("TF-001");
  const A = tab(s), B = tab(s);
  const c1 = await A.claim();
  check("first open -> consent screen", c1.screen === "consent" && c1.claim === "first");
  check("second window -> other_window", (await B.claim()).screen === "other_window");
  check("second window can't act", (await B.consent()).code === 409);
  check("consent without the choices refused", (await A.consent({ withdraw_data: "use" })).code === 400);
  const c2 = await A.consent({ withdraw_data: "use", notify: "yes" });
  check("consent -> device test first", c2.screen === "active" && c2.resume_to.to === "device_test" && !("stance" in c2));
  check("payload carries timing + survey order", c2.timing?.think_ms === 40000 && c2.timing?.answer_max_ms === 120000 && c2.survey_order?.pre?.pre_ise?.length === 5);
  const [row] = await sql`SELECT * FROM sessions WHERE id = ${s.id}`;
  check("consented with a cell + snapshot", row.status === "consented" && row.stance && row.modality && row.config?.prompts?.stage1_sha256);
  check("snapshot records temperatures + timing", row.config.llm.stage1_temperature === 0 && row.config.llm.stage2_temperature === 0.3
    && row.config.app.think_time_ms === 40000 && row.config.app.answer_max_ms === 120000);
  check("consent choices stored", row.consent_withdraw_data === "use" && row.consent_notify === "yes");
  check("survey order stored; background keeps config order", row.survey_order?.pre?.pre_background?.join() === "D1,D2,D3,E1,E2,AI1,AI2");

  // device test
  await A.event("speaker_tone_played"); await A.event("speaker_tone_played");
  await A.event("mic_test_attempt", null, { attempt: 1, text: "오늘은 하늘이 맑고" });
  const [mt] = await sql`SELECT data FROM events WHERE session_id = ${s.id} AND type = 'mic_test_attempt'`;
  check("mic test attempt stores its result text", mt.data.attempt === 1 && mt.data.text === "오늘은 하늘이 맑고");
  check("tab events accepted (no question id, stage in data)", (await A.event("tab_hidden", null, { stage: "device_test" })).code === 200);
  check("question id refused on a non-question event", (await A.event("tab_visible", "q2", { stage: "x" })).code === 400);
  check("oversized event data refused", (await A.event("tab_hidden", null, { stage: "x".repeat(3000) })).code === 400);
  check("in_progress after the first activity", (await sql`SELECT status FROM sessions WHERE id = ${s.id}`)[0].status === "in_progress");
  await A.event("device_test_done");
  check("device_test_done -> pre_survey", (await sql`SELECT current_stage FROM sessions WHERE id = ${s.id}`)[0].current_stage === "pre_survey");

  // pre survey: responses carry the position they were shown at
  for (const b of SURVEY.pre) await A.survey("pre", b.block, fill(b));
  const mh = await sql`SELECT item_id, display_order FROM responses WHERE session_id = ${s.id} AND block_id = 'pre_ise'`;
  const order = row.survey_order.pre.pre_ise;
  check("display_order matches the stored order", mh.every((r) => order.indexOf(r.item_id) + 1 === r.display_order) && mh.length === 5);
  const reloaded = await A.claim();
  check("reload keeps the same survey order", JSON.stringify(reloaded.survey_order) === JSON.stringify(row.survey_order)
    && reloaded.resume_to.to === "pre_survey" && reloaded.surveys.pre.length === SURVEY.pre.length);
  await A.event("survey_pre_submitted"); await A.event("scenario_shown");

  // question: empty first answer -> the one retry
  await A.event("question_shown", "q2"); await A.event("answer_start", "q2", { auto_started: true });
  await A.segment("q2", 1, 0, "음");
  await A.event("answer_end", "q2", { auto_submitted: false });
  const r1 = await A.answer({ client_transcript: "음" });
  check("empty answer -> retry granted", r1.retry === true && r1.attempt === 2);
  check("segments of a stale attempt refused", (await A.segment("q2", 1, 1, "늦은 조각")).code === 400);
  await A.event("question_shown", "q2"); await A.event("answer_start", "q2", { auto_started: false });
  const parts = GOOD_ANSWER.split(/(?<=\.) /); // final STT results arrive phrase by phrase; the server joins them with a space
  for (const [i, text] of parts.entries()) await A.segment("q2", 2, i, text);
  await A.event("answer_end", "q2", { auto_submitted: true });
  const t0 = Date.now();
  const r2 = await A.answer({ client_transcript: GOOD_ANSWER });
  const ackMs = Date.now() - t0;
  check("answer is acknowledged at once, feedback keeps generating", r2.state === "pending" && !("feedback" in r2), `${ackMs} ms`);
  const [ans] = await sql`SELECT transcript, client_transcript, answer_truncated, attempt FROM answers WHERE session_id = ${s.id} AND question_id = 'q2' AND status IN ('pending','done')`;
  check("answer confirmed from the saved segments", ans.transcript === GOOD_ANSWER && ans.client_transcript === GOOD_ANSWER && ans.attempt === 2 && ans.answer_truncated === false);
  const [{ n: nAns }] = await sql`SELECT count(*)::int AS n FROM answers WHERE session_id = ${s.id}`;
  check("second submit does not generate again", (await A.answer({ client_transcript: GOOD_ANSWER })).state !== undefined
    && (await sql`SELECT count(*)::int AS n FROM answers WHERE session_id = ${s.id}`)[0].n === nAns);

  // reload while the self-rating is due
  await A.event("self_rating_shown", "q2");
  const rs = await A.claim();
  check("reload after the answer -> self-rating", rs.claim === "reload" && rs.resume_to.to === "self_rating" && !JSON.stringify(rs).includes("transcript"));
  check("self-rating needs a value 0-10", (await A.survey("mid", "mid_sa", { SA_pre: 11 })).code === 400);
  check("self-rating saved (phase mid, one item)", (await A.survey("mid", "mid_sa", { SA_pre: 7 })).code === 200
    && (await sql`SELECT value, display_order FROM responses WHERE session_id = ${s.id} AND phase = 'mid'`)[0].display_order === 1);
  await A.event("feedback_loading_shown", "q2");
  const rl = await A.claim();
  check("reload while loading -> feedback screen, not yet seen", rl.resume_to.to === "feedback" && rl.resume_to.seen === false);
  const fb = await A.waitFeedback();
  check("feedback arrives", fb.state === "done" && typeof fb.feedback === "string" && fb.feedback.length > 20 && !("stance" in fb),
    `generation ${fb.generation_ms} ms`);
  check("feedback is stable on re-read", (await A.feedback()).feedback === fb.feedback);
  await A.event("feedback_shown", "q2");
  check("reload on the feedback -> same feedback, seen", (await A.claim()).resume_to.seen === true);
  await A.event("tab_hidden", null, { stage: "q2_feedback" }); await A.event("tab_visible", null, { stage: "q2_feedback" });
  await A.event("next_clicked", "q2", { hidden_ms: 1234, blur_ms: 2000 });
  check("next_clicked -> post_survey", (await sql`SELECT current_stage FROM sessions WHERE id = ${s.id}`)[0].current_stage === "post_survey");

  for (const b of SURVEY.post) await A.survey("post", b.block, fill(b));
  const done = await A.event("survey_post_submitted");
  const [fin] = await sql`SELECT status, valid, current_stage FROM sessions WHERE id = ${s.id}`;
  check("completed, AT1+AT2 correct -> valid, stage debrief", done.code === 200 && fin.status === "completed" && fin.valid === true && fin.current_stage === "debrief");
  check("valid completion keeps its slot", !(await sql`SELECT returned_at FROM slot_assignments WHERE session_id = ${s.id}`)[0].returned_at);
  check("writes after completion rejected", (await A.event("next_clicked", "q2")).code === 410);

  // a completed link still opens: debriefing, then the completion screen (new tab)
  const A2 = tab(s);
  const cd = await A2.claim();
  check("completed link -> debrief, with the participant id", cd.screen === "completed" && cd.resume_to.to === "debrief" && cd.participant_id === "TF-001");
  check("debrief shown is recorded", (await A2.debrief("shown")).code === 200);
  check("debrief confirm recorded", (await A2.debrief("confirmed")).code === 200
    && (await sql`SELECT debriefed_at, current_stage FROM sessions WHERE id = ${s.id}`)[0].debriefed_at !== null);
  const [{ n: deb }] = await sql`SELECT count(*)::int AS n FROM events WHERE session_id = ${s.id} AND type IN ('debrief_shown','debrief_confirmed')`;
  check("debrief events + audit", deb === 2 && (await sql`SELECT count(*)::int AS n FROM audit_log WHERE session_id = ${s.id} AND action = 'debriefed'`)[0].n === 1);
  check("after the debrief -> completion screen", (await tab(s).claim()).resume_to.to === "done");
  check("debrief refused before completion", (await (async () => { const x = await started("TF-NC"); return x.T.debrief("confirmed"); })()).code === 400);

  // ---------- 3. thinking-time exit: question again, the chance is untouched ----------
  const th = await started("TF-002");
  await th.T.event("question_shown", "q2");
  await th.T.release();
  const th2 = await tab(th.s).claim();
  check("exit while thinking -> question again, no chance spent", th2.claim === "resume" && th2.resume_to.to === "question" && !th2.resume_to.reanswer
    && th2.attempt === 1 && (await sql`SELECT retry_used FROM sessions WHERE id = ${th.s.id}`)[0].retry_used === false);

  // ---------- 4. exit while answering, almost nothing saved -> re-answer ----------
  const r = await started("TF-003");
  await r.T.event("question_shown", "q2"); await r.T.event("answer_start", "q2");
  await r.T.segment("q2", 1, 0, "음 저는");
  await r.T.release();
  const R2 = tab(r.s);
  const rc = await R2.claim();
  check("resume after short partial -> re-answer", rc.claim === "resume" && rc.resume_to.to === "question" && rc.resume_to.reanswer && rc.attempt === 2);
  await R2.event("question_shown", "q2"); await R2.event("answer_start", "q2");
  await R2.segment("q2", 2, 0, "제가 주도한 일은 학과 행사였습니다");
  await R2.release();
  check("second resume -> locked", (await tab(r.s).claim()).screen === "locked");

  // ---------- 5. exit while answering with enough saved -> confirm what was saved ----------
  const t = await started("TF-004");
  await t.T.event("question_shown", "q2"); await t.T.event("answer_start", "q2");
  await t.T.segment("q2", 1, 0, "작년에 학과 행사를 제가 처음부터");
  await t.T.segment("q2", 1, 1, "기획해서 끝까지 진행했습니다");
  await t.T.release();
  const T2 = tab(t.s);
  const tc = await T2.claim();
  check("resume with enough saved -> submit_saved", tc.claim === "resume" && tc.resume_to.to === "submit_saved");
  const tr = await T2.answer({ interrupted: true });
  const [ta] = await sql`SELECT transcript, answer_truncated FROM answers WHERE session_id = ${t.s.id} AND question_id = 'q2' AND status IN ('pending','done')`;
  check("saved segments joined in order, flagged truncated", tr.state === "pending" && ta.answer_truncated === true
    && ta.transcript === "작년에 학과 행사를 제가 처음부터 기획해서 끝까지 진행했습니다");
  check("that feedback is generated too", (await T2.waitFeedback()).state === "done");

  // ---------- 6. orphaned pending row (function died) and a failed generation ----------
  const o = await started("TF-005");
  await o.T.event("question_shown", "q2");
  await o.T.segment("q2", 1, 0, GOOD_ANSWER);
  await sql`INSERT INTO answers (session_id, question_id, attempt, transcript, status, stance, created_at)
            VALUES (${o.s.id}, 'q2', 1, ${GOOD_ANSWER}, 'pending', 'direct', now() - interval '10 minutes')`;
  const fo = await o.T.feedback();
  check("orphaned pending row -> restarted", fo.state === "pending"
    && (await sql`SELECT status FROM answers WHERE session_id = ${o.s.id} ORDER BY id`).map((x) => x.status).join() === "stale,pending");
  check("restarted generation finishes", (await o.T.waitFeedback()).state === "done");
  await sql`UPDATE answers SET status = 'error', error = 'simulated' WHERE session_id = ${o.s.id} AND status = 'done'`;
  check("failed generation reported as error (no details)", JSON.stringify(await o.T.feedback()) === JSON.stringify({ code: 200, state: "error" }));
  const rg = await o.T.answer({});
  check("retry after an error regenerates from the same answer", rg.state === "pending" && (await o.T.waitFeedback()).state === "done"
    && (await sql`SELECT count(*)::int AS n FROM answers WHERE session_id = ${o.s.id} AND transcript = ${GOOD_ANSWER}`)[0].n === 3);

  // ---------- 7. attention check failed -> valid=false, slot returned (not exposed) ----------
  const w = await started("TF-006");
  for (const b of SURVEY.pre) await w.T.survey("pre", b.block, fill(b, { failChecks: b.block === "pre_smi" }));
  await w.T.survey("mid", "mid_sa", { SA_pre: 3 });
  for (const b of SURVEY.post) await w.T.survey("post", b.block, fill(b));
  await w.T.event("survey_post_submitted");
  const [wv] = await sql`SELECT s.status, s.valid, a.return_reason, a.exposed FROM sessions s JOIN slot_assignments a ON a.session_id = s.id WHERE s.id = ${w.s.id}`;
  check("AT1 wrong -> completed, valid=false, slot returned (invalid)", wv.status === "completed" && wv.valid === false && wv.return_reason === "invalid" && wv.exposed === false);
  const [audit] = await sql`SELECT detail FROM audit_log WHERE session_id = ${w.s.id} AND action = 'completed'`;
  check("audit records the failed check", JSON.stringify(audit.detail.failed) === JSON.stringify(["AT1"]));

  // ---------- 8. empty answer twice -> locked (technical failure), slot returned unexposed ----------
  const e = await started("TF-007");
  check("first empty answer -> retry", (await e.T.say(1, "")).retry === true);
  const e2 = await e.T.say(2, "");
  const [ev] = await sql`SELECT s.status, s.lock_reason, a.return_reason, a.exposed FROM sessions s JOIN slot_assignments a ON a.session_id = s.id WHERE s.id = ${e.s.id}`;
  check("second empty answer -> locked_error", e2.code === 410 && e2.screen === "locked_error" && ev.status === "locked" && ev.lock_reason === "empty_answer");
  check("slot returned, exposed=false", ev.return_reason === "locked" && ev.exposed === false);
  check("no feedback generated", (await sql`SELECT count(*)::int AS n FROM answers WHERE session_id = ${e.s.id}`)[0].n === 0);
  check("reopening shows locked_error", (await tab(e.s).claim()).screen === "locked_error");

  // ---------- 9. short (1-9 chars) after the retry -> feedback, answer_short ----------
  const sh = await started("TF-008");
  await sh.T.say(1, "음");
  const shr = await sh.T.say(2, "네 했어요");
  const shf = await sh.T.waitFeedback();
  const [sha] = await sql`SELECT answer_short, status FROM answers WHERE session_id = ${sh.s.id} AND question_id = 'q2' AND status = 'done'`;
  check("short answer after retry -> feedback, answer_short", shr.state === "pending" && shf.state === "done" && sha.answer_short === true);

  // ---------- 10. dev injection: test sessions only ----------
  const real = await started("TF-009");
  check("injection refused in a real session", (await real.T.answer({ injected: true, transcript: GOOD_ANSWER })).code === 403);
  const ts = await started("TF-TEST", { test: true });
  const inj = await ts.T.answer({ injected: true, transcript: GOOD_ANSWER });
  const injf = await ts.T.waitFeedback();
  check("test session: injected answer -> feedback with scores + stance", inj.state === "pending" && injf.state === "done" && injf.stance === "direct" && injf.scores?.situation);

  // ---------- 11. withdrawal with 'destroy' -> destroy_pending on abandonment -> purge keeps the bookkeeping ----------
  const d = await started("TF-010", {});
  await tab(d.s).claim();
  await sql`UPDATE sessions SET consent_withdraw_data = 'destroy' WHERE id = ${d.s.id}`;
  for (const b of SURVEY.pre) await d.T.survey("pre", b.block, fill(b));
  await d.T.event("survey_pre_submitted");
  await d.T.segment("q2", 1, 0, "중간에 그만둔 답변");
  await sql`UPDATE sessions SET last_activity_at = now() - interval '3 hours' WHERE id = ${d.s.id}`;
  await sweep(d.s.id);
  const [dp] = await sql`SELECT status, destroy_pending FROM sessions WHERE id = ${d.s.id}`;
  check("destroy + abandoned -> destroy_pending", dp.status === "abandoned" && dp.destroy_pending === true);
  const purged = await purgeWithdrawn();
  const mine = purged.find((p) => p.participant_id === "TF-010");
  check("purge-withdrawn found it", !!mine && mine.deleted.responses > 0 && mine.deleted.events > 0);
  const left = {};
  for (const tb of ["responses", "answers", "answer_segments", "events", "session_clients", "audio_chunks"]) {
    left[tb] = (await sql.query(`SELECT count(*)::int AS n FROM ${tb} WHERE session_id = $1`, [d.s.id]))[0].n;
  }
  const [kept] = await sql`SELECT s.status, s.stance, s.modality, s.data_purged_at, a.slot_seq FROM sessions s JOIN slot_assignments a ON a.session_id = s.id WHERE s.id = ${d.s.id}`;
  check("participant data deleted", Object.values(left).every((n) => n === 0), JSON.stringify(left));
  check("status, condition, slot assignment kept", kept.status === "abandoned" && kept.stance && kept.modality && kept.slot_seq && kept.data_purged_at);
  check("use-choice sessions untouched", !purged.some((p) => p.participant_id !== "TF-010"));

  // ---------- 12. audio upload -> verified -> purge (needs Blob credentials) ----------
  if (!AUDIO_UPLOAD_ENABLED || !(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN)) {
    console.log("SKIP  audio upload / purge (no Blob credentials or AUDIO_UPLOAD_ENABLED is off)");
  } else {
    const v = await started("TF-011");
    const bytes = crypto.randomBytes(2048);
    const up = await v.T.audio("q2", 1, 0, bytes);
    const [chunk] = await sql`SELECT pathname, bytes FROM audio_chunks WHERE session_id = ${v.s.id}`;
    check("audio chunk uploaded (OIDC / token auth)", up.code === 200 && chunk?.bytes === 2048,
      chunk ? chunk.pathname.replace(v.s.id, "<session>") : up.error);
    if (chunk) {
      const { get } = await import("@vercel/blob");
      const before = await get(chunk.pathname, { access: "private", useCache: false });
      check("blob is private and readable server-side", before?.statusCode === 200);
      await sql`UPDATE sessions SET audio_verified_at = now() WHERE id = ${v.s.id}`;
      const pa = await purgeVerifiedAudio();
      const after = await get(chunk.pathname, { access: "private", useCache: false });
      const [vs] = await sql`SELECT s.audio_purged_at, c.purged_at FROM sessions s JOIN audio_chunks c ON c.session_id = s.id WHERE s.id = ${v.s.id}`;
      check("purge-audio deletes the blob, keeps the metadata", pa.some((p) => p.participant_id === "TF-011") && after === null && vs.audio_purged_at && vs.purged_at);
    }
  }
} finally {
  await sleep(1500); // let background generations settle before their rows disappear
  await H.cleanup();
}
H.finish();

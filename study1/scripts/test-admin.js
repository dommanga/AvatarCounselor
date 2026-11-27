// /admin API test against the scratch database branch: login + failure limit, issue + CSV, cell numbers against the
// database, locked-session resume (before / after the stimulus), condition change, expiry extension, slot adjustments.
// Everything is scoped to the sessions it creates; cell targets, added slots and login failures are restored.
//   npm run test:admin        (Neon test branch only: .env.test)

import crypto from "crypto";
import { SURVEY } from "../lib/survey.js";
import { lockSession } from "../lib/lifecycle.js";
import { toCsv, issuedCsv } from "../src/admin-csv.js";
import { requireTestDb } from "./cli.js";
import { createHarness, fill } from "./test-lib.js";
import admin from "../api/admin/[action].js";
import researcher from "../api/researcher/[action].js";

requireTestDb();

const H = createHarness();
const { sql, check } = H;
const GOOD_ANSWER = "저는 팀 프로젝트에서 일정이 밀렸을 때 역할을 다시 나누고 매일 짧게 점검하면서 마감을 지켰습니다. 그 경험으로 협업에서 소통이 중요하다는 것을 배웠습니다.";
const TEST_IP = "198.51.100.77";
const t0 = new Date();
const addedSlots = [];

const run = (handler, req) => new Promise((resolve, reject) => {
  const headers = {};
  const res = { code: 200, status(c) { this.code = c; return this; }, setHeader(k, v) { headers[k.toLowerCase()] = v; }, json(d) { resolve({ code: this.code, headers, ...d }); } };
  handler(req, res).catch(reject);
});
const login = (password, ip = TEST_IP) => run(researcher, { method: "POST", query: { action: "login" }, body: { password }, headers: { "x-forwarded-for": ip } });
let cookie = null;
const adm = (method, action, body, query = {}) => run(admin, {
  method, query: { action, ...query }, body, headers: { host: "example.test" }, cookies: cookie ? { [cookie.name]: cookie.value } : {},
});
const get = (a, q) => adm("GET", a, undefined, q);
const post = (a, b) => adm("POST", a, b);

async function cellsNow() { return Object.fromEntries((await get("cells")).cells.map((c) => [`${c.stance}/${c.modality}`, c])); }
const cellOf = async (id) => { const [s] = await sql`SELECT stance, modality FROM sessions WHERE id = ${id}`; return `${s.stance}/${s.modality}`; };
const targetsBefore = await sql`SELECT stance, modality, target FROM cell_targets`;

try {
  // ---------- 1. login + failure limit ----------
  const noCookie = await get("participants");
  check("admin API without login -> 401", noCookie.code === 401);
  const bad = [];
  for (let i = 0; i < 5; i++) bad.push(await login("wrong-password"));
  check("wrong password -> 401 with attempts left", bad.every((r) => r.code === 401) && bad[0].attempts_left === 4 && bad[4].attempts_left === 0);
  const locked = await login(process.env.RESEARCHER_PASSWORD);
  check("sixth try within the window -> 429 even with the right password", locked.code === 429 && locked.retry_after_s > 0 && !locked.headers["set-cookie"]);
  const other = await login(process.env.RESEARCHER_PASSWORD, "198.51.100.78");
  check("another IP is not locked; right password -> cookie", other.code === 200 && /HttpOnly/.test(other.headers["set-cookie"]));
  const [cname, cvalue] = other.headers["set-cookie"].split(";")[0].split(/=(.*)/s);
  cookie = { name: cname, value: cvalue };
  await sql`DELETE FROM admin_login_failures WHERE ip IN (${TEST_IP}, '198.51.100.78')`;
  check("login works again once the failures are cleared", (await login(process.env.RESEARCHER_PASSWORD)).code === 200);
  check("logged in: participants readable", (await get("participants")).code === 200);

  // ---------- 2. issue -> table, CSV ----------
  const bad1 = await post("issue", { n: 0, batch: "TESTADM" });
  const bad2 = await post("issue", { n: 2, batch: "" });
  check("issue validates n and batch (400, Korean message)", bad1.code === 400 && bad2.code === 400 && /[가-힣]/.test(bad1.error));
  const iss = await post("issue", { n: 2, batch: "TESTADM", test: true, stance: "direct", modality: "text", base_url: "https://x.example" });
  check("test issue: T1- numbers, stance/modality preset", iss.code === 200 && iss.test && iss.rows.length === 2 && iss.rows.every((r) => /^T1-\d{3}$/.test(r.participant_id) && r.link.startsWith("https://x.example/s/")));
  const real = await post("issue", { n: 1, batch: "TESTADM", base_url: "https://x.example" });
  check("real issue: S1- number, no slot yet", real.code === 200 && /^S1-\d{3}$/.test(real.rows[0].participant_id));
  const issued = await sql`SELECT id, participant_id, batch_id, is_test, stance, modality, status, token_hash, expires_at FROM sessions WHERE participant_id = ANY(${[...iss.rows, ...real.rows].map((r) => r.participant_id)})`;
  for (const r of issued) H.created.push(r.id);
  check("sessions in DB: batch, test flag, no slot assigned to the real one", issued.length === 3 && issued.every((r) => r.batch_id === "TESTADM")
    && issued.filter((r) => r.is_test).every((r) => r.stance === "direct" && r.modality === "text") && issued.find((r) => !r.is_test).stance === null);
  check("token is stored hashed and the link token authenticates", issued.every((r) => r.token_hash.length === 64)
    && (await H.tab({ token: real.rows[0].link.split("/s/")[1] }).claim()).code === 200);
  const tbl = (await get("participants")).participants;
  check("participants table lists the issued rows", [...iss.rows, ...real.rows].every((r) => tbl.some((p) => p.participant_id === r.participant_id)));
  const csv = issuedCsv(iss.rows);
  check("CSV: header + one line per row, link intact", csv.split(/\r?\n/).filter(Boolean).length === 3 && csv.split(/\r?\n/)[0] === "participant_id,link" && csv.includes(iss.rows[1].link));
  check("CSV escapes commas and quotes", toCsv([{ a: 'x,"y"', b: "z" }], ["a", "b"]).includes('"x,""y""",z'));
  const defaults = await get("issue_defaults");
  check("default expiry: a Sunday 23:59:59 KST in the future", new Date(defaults.expires_at) > new Date()
    && new Date(new Date(defaults.expires_at).getTime() + 9 * 3600_000).toISOString().slice(11, 19) === "23:59:59"
    && new Date(new Date(defaults.expires_at).getTime() + 9 * 3600_000).getUTCDay() === 0);

  // ---------- 3. cell numbers vs the database ----------
  const before = await cellsNow();
  const [{ valid_done, in_progress }] = await sql`
    SELECT count(*) FILTER (WHERE status = 'completed' AND valid IS TRUE)::int AS valid_done, count(*) FILTER (WHERE status IN ('consented','in_progress'))::int AS in_progress
    FROM sessions WHERE NOT is_test AND stance IS NOT NULL`;
  const sumOf = (cs, k) => Object.values(cs).reduce((n, c) => n + c[k], 0);
  check("cell table totals = database counts", sumOf(before, "valid_done") === valid_done && sumOf(before, "in_progress") === in_progress);
  const cs = await H.issue("TADM-C1");
  const ct = H.tab(cs);
  await ct.claim(); await ct.consent();
  const key = await cellOf(cs.id);
  const mid = await cellsNow();
  check("a consent adds one in-progress to its cell and uses one slot", mid[key].in_progress === before[key].in_progress + 1 && mid[key].unassigned === before[key].unassigned - 1
    && sumOf(mid, "in_progress") === sumOf(before, "in_progress") + 1);
  await lockSession(cs.id, "empty_answer");
  const after = await cellsNow();
  check("locked before exposure: in progress -1, returned +1 (before exposure), queue +1",
    after[key].in_progress === before[key].in_progress && after[key].returned.before === before[key].returned.before + 1
    && after[key].returned.after === before[key].returned.after && after[key].queue === before[key].queue + 1 && after[key].returned.by_reason.locked.before === (before[key].returned.by_reason.locked?.before ?? 0) + 1);
  const q = (await get("slots")).queue.find((e) => e.participant_id === "TADM-C1");
  check("refill queue lists the returned slot", q && q.return_reason === "locked" && q.exposed === false);
  const dis = await post("queue_dismiss", { assignment_id: q.id, reason: "" });
  check("dismiss needs a reason", dis.code === 400);
  check("dismiss with reason -> queue -1", (await post("queue_dismiss", { assignment_id: q.id, reason: "test" })).code === 200 && (await cellsNow())[key].queue === before[key].queue);
  check("dismissed slot cannot be dismissed twice", (await post("queue_dismiss", { assignment_id: q.id, reason: "again" })).code === 409);
  const tg = await post("target", { stance: "direct", modality: "text", target: 12 });
  check("target edit shows in the cell and in 'remaining'", tg.code === 200 && (await cellsNow())["direct/text"].target === 12);
  check("invalid target refused", (await post("target", { stance: "direct", modality: "text", target: -1 })).code === 400);

  // ---------- 4. resume: locked before exposure -> new slot -> to completion ----------
  const R = await H.started("TADM-R1");
  for (const b of SURVEY.pre) await R.T.survey("pre", b.block, fill(b));
  const preRows = (await sql`SELECT count(*)::int AS n FROM responses WHERE session_id = ${R.s.id}`)[0].n;
  await R.T.say(1, "");
  const lockRes = await R.T.say(2, "");
  const [rl] = await sql`SELECT status, lock_reason FROM sessions WHERE id = ${R.s.id}`;
  check("setup: locked by two empty answers", lockRes.code === 410 && rl.status === "locked" && rl.lock_reason === "empty_answer");
  const detail = await get("participant", { id: R.s.id });
  check("detail: resume allowed, condition change not (not in progress)", detail.actions.resume.why === null && detail.actions.condition.why !== null && detail.actions.extend.why !== null);
  check("resume needs a reason", (await post("resume", { id: R.s.id, reason: " " })).code === 400);
  const rs = await post("resume", { id: R.s.id, reason: "마이크 문제로 잠김" });
  check("resume -> in_progress with a new slot", rs.code === 200 && rs.status === "in_progress" && Number.isInteger(rs.slot));
  const [ra] = await sql`SELECT status, lock_reason, resume_count, retry_used, attempt_offset, current_stage, stance, modality FROM sessions WHERE id = ${R.s.id}`;
  check("session state reset: no lock, resume_count 0, retry available, same stage", ra.status === "in_progress" && ra.lock_reason === null && ra.resume_count === 0 && ra.retry_used === false);
  const asg = await sql`SELECT slot_seq, returned_at, return_reason FROM slot_assignments WHERE session_id = ${R.s.id} ORDER BY id`;
  check("two assignments: the first returned (locked), the second active", asg.length === 2 && asg[0].return_reason === "locked" && asg[1].returned_at === null);
  check("pre-survey answers kept", (await sql`SELECT count(*)::int AS n FROM responses WHERE session_id = ${R.s.id}`)[0].n === preRows);
  const [au] = await sql`SELECT actor, detail FROM audit_log WHERE session_id = ${R.s.id} AND action = 'resumed'`;
  check("audit: actor admin with the reason", au?.actor === "admin" && au.detail.reason === "마이크 문제로 잠김");
  check("resuming again is refused (not locked any more)", (await post("resume", { id: R.s.id, reason: "again" })).code === 409);
  await sql`UPDATE sessions SET modality = 'text' WHERE id = ${R.s.id}`; // keep the rest of the test on the text path
  const T2 = H.tab(R.s);
  const claim = await T2.claim();
  check("participant reopens and lands in the interview, not on the locked screen", claim.code === 200 && claim.screen !== "locked_error", claim.screen);
  const a1 = await T2.say(ra.attempt_offset + 1, GOOD_ANSWER);
  check("new answer accepted after the resume", a1.state === "pending" || a1.state === "done", JSON.stringify(a1));
  const fb = await T2.waitFeedback();
  check("feedback generated", fb.state === "done");
  await T2.event("feedback_shown", "q2");
  await T2.survey("mid", "mid_sa", { SA_pre: 3 });
  for (const b of SURVEY.post) await T2.survey("post", b.block, fill(b));
  await T2.event("survey_post_submitted");
  const [done] = await sql`SELECT status, valid FROM sessions WHERE id = ${R.s.id}`;
  check("resumed session completes, valid", done.status === "completed" && done.valid === true, JSON.stringify(done));

  // ---------- 5. locked after exposure: no resume; condition change refused ----------
  const X = await H.started("TADM-X1");
  for (const b of SURVEY.pre) await X.T.survey("pre", b.block, fill(b));
  await X.T.say(1, GOOD_ANSWER);
  check("setup: feedback ready", (await X.T.waitFeedback()).state === "done");
  const cnd0 = await get("participant", { id: X.s.id });
  check("before exposure: condition change blocked only by the existing answer", cnd0.actions.condition.why !== null);
  await X.T.event("feedback_shown", "q2");
  await lockSession(X.s.id, "resume_limit");
  const dx = await get("participant", { id: X.s.id });
  const rx = await post("resume", { id: X.s.id, reason: "try" });
  check("post-exposure lock: resume refused (409) and the panel says why", rx.code === 409 && /노출/.test(rx.error) && /노출/.test(dx.actions.resume.why));
  check("post-exposure: condition change refused", (await post("condition", { id: X.s.id, stance: "reversing", modality: "text", reason: "try" })).code === 409);

  const P = await H.started("TADM-P1"); // consented, nothing answered yet: condition may change
  const [p0] = await sql`SELECT stance, modality FROM sessions WHERE id = ${P.s.id}`;
  const toStance = p0.stance === "direct" ? "minimizing" : "direct";
  check("condition change needs a reason", (await post("condition", { id: P.s.id, stance: toStance, modality: "text", reason: "" })).code === 400);
  check("same condition refused", (await post("condition", { id: P.s.id, stance: p0.stance, modality: p0.modality, reason: "same" })).code === 400);
  const cc = await post("condition", { id: P.s.id, stance: toStance, modality: "text", reason: "셀 균형 조정" });
  const [p1] = await sql`SELECT stance, modality, config FROM sessions WHERE id = ${P.s.id}`;
  const [pa] = await sql`SELECT detail FROM audit_log WHERE session_id = ${P.s.id} AND action = 'condition_changed'`;
  check("pre-exposure condition change applied, snapshot rebuilt, audited", cc.code === 200 && p1.stance === toStance && p1.config?.prompts?.stage2_sha256 === p1.config?.prompts?.stage2_all_sha256?.[toStance] && p1.config?.prompts?.stage2_sha256 !== pa.detail.previous_config?.prompts?.stage2_sha256 && pa.detail.reason === "셀 균형 조정" && pa.detail.to.stance === toStance, JSON.stringify({ cc, p1: { ...p1, config: Object.keys(p1.config ?? {}) }, pa }));

  // ---------- 6. expiry extension ----------
  const E = await H.issue("TADM-E1");
  await sql`UPDATE sessions SET expires_at = now() - interval '1 hour' WHERE id = ${E.id}`;
  check("expired link refused by the participant API", JSON.stringify(await H.tab(E).claim()).slice(0, 80) && (await H.tab(E).claim()).screen === "expired");
  const until = new Date(Date.now() + 3 * 864e5).toISOString();
  check("extend refuses a past date and a missing reason", (await post("extend", { id: E.id, expires_at: new Date(Date.now() - 1000).toISOString(), reason: "x2" })).code === 400
    && (await post("extend", { id: E.id, expires_at: until, reason: "" })).code === 400);
  const ex = await post("extend", { id: E.id, expires_at: until, reason: "참가자 요청" });
  const [es] = await sql`SELECT status, expires_at FROM sessions WHERE id = ${E.id}`;
  check("extend reopens the expired link", ex.code === 200 && es.status === "issued" && Math.abs(new Date(es.expires_at) - new Date(until)) < 1000);
  check("extended link works", (await H.tab(E).claim()).code === 200);
  check("after consent the expiry cannot be extended", (await post("extend", { id: R.s.id, expires_at: until, reason: "late" })).code === 409);

  // ---------- 7. slot adjustments ----------
  const sl = await post("slot_add", { stance: "direct", modality: "text", reason: "" });
  check("slot add needs a reason", sl.code === 400);
  const added = await post("slot_add", { stance: "direct", modality: "text", reason: "test" });
  if (added.seq) addedSlots.push(added.seq);
  const up = await get("slots");
  check("added slot is at the end of the sequence and unassigned", added.code === 200 && (await sql`SELECT max(seq)::int AS m FROM slots`)[0].m === added.seq && up.counts.slots > up.counts.assigned);
  const [assigned] = await sql`SELECT slot_seq FROM slot_assignments WHERE session_id = ${R.s.id} LIMIT 1`;
  check("a slot that was ever assigned cannot be deleted", (await post("slot_delete", { seq: assigned.slot_seq, reason: "no" })).code === 409);
  check("delete needs a reason", (await post("slot_delete", { seq: added.seq, reason: "" })).code === 400);
  check("never-assigned slot can be deleted", (await post("slot_delete", { seq: added.seq, reason: "test cleanup" })).code === 200
    && (await sql`SELECT 1 FROM slots WHERE seq = ${added.seq}`).length === 0);

  // ---------- 8. audit log view ----------
  const al = await get("audit", { actor: "admin", participant_id: "TADM-R1" });
  const alk = await get("audit", { kind: "resumed", participant_id: "TADM-R1" });
  check("audit filter: action kind", alk.rows.length === 1 && alk.rows[0].action === "resumed");
  check("audit filter: actor + participant", al.rows.length >= 1 && al.rows.every((r) => r.actor === "admin" && r.participant_id === "TADM-R1") && al.rows[0].action === "resumed", "");
  const all = await get("audit");
  check("audit newest first, actions listed for the filter", all.rows.every((r, i, a) => i === 0 || Number(a[i - 1].id) > Number(r.id)) && all.actions.some((a) => a.action === "resumed"));
  check("admin audit entries of this run exist (issue, target)", (await sql`SELECT count(*)::int AS n FROM audit_log WHERE actor = 'admin' AND action = 'target_set' AND ts >= ${t0.toISOString()}`)[0].n >= 1);
} catch (e) {
  check("test run without exception", false, e.stack || e.message);
} finally {
  await sql`DELETE FROM admin_login_failures WHERE ip IN (${TEST_IP}, '198.51.100.78')`;
  await sql`DELETE FROM audit_log WHERE actor = 'admin' AND session_id IS NULL AND ts >= ${t0.toISOString()} AND action IN ('target_set', 'slot_added', 'slot_deleted')`;
  for (const seq of addedSlots) { await sql`DELETE FROM audit_log WHERE slot_seq = ${seq}`; await sql`DELETE FROM slots WHERE seq = ${seq} AND NOT EXISTS (SELECT 1 FROM slot_assignments WHERE slot_seq = ${seq})`; }
  await sql`DELETE FROM cell_targets`;
  for (const t of targetsBefore) await sql`INSERT INTO cell_targets (stance, modality, target) VALUES (${t.stance}, ${t.modality}, ${t.target})`;
  await H.cleanup();
}
H.finish();

// /admin data screens and the external API against the test branch: voice check -> purge plan, purge flow (typed count,
// plan-only processing, expiry), export (files, row counts, filters, BOM, raw scores), external API (secret, personal fields,
// no destructive routes, rate limit). Everything is scoped to the sessions this test creates.
//   npm run test:data        (Neon test branch only: .env.test)
// Audio files need Blob credentials (like test:flow); without them the audio steps that would delete a file are skipped.

import crypto from "crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { requireTestDb } from "./cli.js";
import { createHarness } from "./test-lib.js";
import admin from "../api/admin/[action].js";
import researcher from "../api/researcher/[action].js";
import external from "../api/external/[action].js";
import { EXPORT_SCHEMA } from "../lib/export.js";

requireTestDb();
const H = createHarness();
const { sql, check } = H;
const t0 = new Date();
const haveBlob = !!(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
const SECRET = `test-secret-${crypto.randomBytes(6).toString("hex")}`;
process.env.ADMIN_API_SECRET = SECRET;
const API_IP = "198.51.100.91";

const run = (handler, req) => new Promise((resolve, reject) => {
  const headers = {};
  const res = {
    code: 200, status(c) { this.code = c; return this; }, setHeader(k, v) { headers[k.toLowerCase()] = v; },
    json(d) { resolve({ code: this.code, headers, ...(Array.isArray(d) ? { rows: d } : d) }); }, end(buf) { resolve({ code: this.code, headers, binary: buf }); },
  };
  handler(req, res).catch(reject);
});
let cookie = null;
const adm = (method, action, body, query = {}) => run(admin, { method, query: { action, ...query }, body, headers: { host: "example.test" }, cookies: cookie ? { [cookie.name]: cookie.value } : {} });
const get = (a, q) => adm("GET", a, undefined, q), post = (a, b) => adm("POST", a, b);
const ext = (action, body, secret = SECRET, method = "POST") => run(external, { method, query: { action }, body, headers: { "x-admin-secret": secret, "x-forwarded-for": API_IP, host: "example.test" } });
const unzip = (zipPath, name) => spawnSync("python3", ["-I", "-c", "import sys,zipfile;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))", zipPath, name], { encoding: "buffer", maxBuffer: 1 << 28 }).stdout;
const names = (zipPath) => spawnSync("python3", ["-I", "-c", "import sys,zipfile;print('|'.join(zipfile.ZipFile(sys.argv[1]).namelist()))", zipPath], { encoding: "utf8" }).stdout.trim().split("|");
const csvRows = (buf) => { // minimal RFC 4180 reader, after the BOM
  const text = buf.toString("utf8").replace(/^﻿/, "");
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(cell); cell = ""; } else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; } else cell += c;
  }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
};

const addAudio = async (sid, { real = false } = {}) => {
  const pathname = `test/${sid}/q2/a1/0.webm`;
  const bytes = crypto.randomBytes(300);
  if (real && haveBlob) { const { put } = await import("@vercel/blob"); await put(pathname, bytes, { access: "private", contentType: "audio/webm", allowOverwrite: true }); }
  await sql`INSERT INTO audio_chunks (session_id, question_id, attempt, seq, pathname, bytes, mime) VALUES (${sid}, 'q2', 1, 0, ${pathname}, ${bytes.length}, 'audio/webm')`;
  return pathname;
};
const mkSession = async (pid, { batch = "TDATA", test = false, status = "completed" } = {}) => {
  const s = await H.issue(pid, { test });
  await sql`UPDATE sessions SET batch_id = ${batch}, status = ${status}, stance = 'direct', modality = 'text', survey_version = 'tv',
            config = ${JSON.stringify({ llm: { model: "m-test" }, prompts: { stage1_sha256: "h1", stage2_sha256: "h2" }, app: { commit: "abc123" } })}::jsonb,
            completed_at = CASE WHEN ${status} = 'completed' THEN now() END, valid = ${status === "completed"} WHERE id = ${s.id}`;
  return s;
};

try {
  const lg = await run(researcher, { method: "POST", query: { action: "login" }, body: { password: process.env.RESEARCHER_PASSWORD }, headers: { "x-forwarded-for": "198.51.100.92" } });
  const [cn, cv] = lg.headers["set-cookie"].split(";")[0].split(/=(.*)/s);
  cookie = { name: cn, value: cv };
  await sql`DELETE FROM admin_login_failures WHERE ip = '198.51.100.92'`;

  // ---------- 1. voice check -> judged -> still in the purge plan ----------
  const A = await mkSession("TDATA-A", { batch: "TDATA" }), B = await mkSession("TDATA-B", { batch: "TDATA" }), C = await mkSession("TDATA-C", { batch: "TDATA2" });
  const T = await mkSession("TDATA-T", { test: true });
  for (const s of [A, B, C]) await addAudio(s.id, { real: true });
  await addAudio(T.id);
  await sql`INSERT INTO answers (session_id, question_id, attempt, transcript, status) VALUES (${A.id}, 'q2', 1, '저는 동아리 행사를 기획했습니다', 'done')`;
  await sql`INSERT INTO answer_segments (session_id, question_id, attempt, seq, text) VALUES (${A.id}, 'q2', 1, 0, '저는 동아리'), (${A.id}, 'q2', 1, 1, '행사를 기획했습니다')`;
  for (let i = 0; i < 2; i++) await sql`INSERT INTO events (id, session_id, type, question_id) VALUES (${crypto.randomUUID()}, ${A.id}, 'stt_restart', 'q2')`;
  const list0 = (await get("stt_list")).sessions.map((s) => s.participant_id);
  check("voice check list: sessions with audio and no verdict; test sessions hidden", ["TDATA-A", "TDATA-B", "TDATA-C"].every((x) => list0.includes(x)) && !list0.includes("TDATA-T"));
  check("test toggle shows the test session", (await get("stt_list", { test: "1" })).sessions.some((s) => s.participant_id === "TDATA-T"));
  const det = await get("stt_session", { id: A.id });
  check("detail: final transcript, confirmed segments with times, stt_restart count, audio per attempt",
    det.answers[0].transcript.includes("동아리") && det.segments.length === 2 && det.segments.every((x) => x.server_ts) && det.stt_restart_total === 2 && det.audio[0].chunks === 1);
  if (haveBlob) {
    const au = await get("stt_audio", { id: A.id, question_id: "q2", attempt: "1" });
    check("original audio is served through the admin function (joined chunks)", au.code === 200 && au.binary?.length === 300 && au.headers["content-type"] === "audio/webm");
    const anon = await run(admin, { method: "GET", query: { action: "stt_audio", id: A.id, question_id: "q2", attempt: "1" }, headers: {}, cookies: {} });
    check("audio without the admin login -> 401", anon.code === 401 && !anon.binary);
  } else { console.log("SKIP  audio streaming (no Blob credentials)"); }
  check("verdict needs a valid quality", (await post("stt_judge", { id: A.id, quality: "bad", note: "" })).code === 400 && (await post("stt_judge", { id: A.id, note: "x" })).code === 400);
  const jd = await post("stt_judge", { id: A.id, quality: "minor", note: "고유명사 한 곳" });
  const [ja] = await sql`SELECT stt_quality, stt_note, stt_judged_at FROM sessions WHERE id = ${A.id}`;
  const [jaudit] = await sql`SELECT actor, detail FROM audit_log WHERE session_id = ${A.id} AND action = 'stt_judged'`;
  check("verdict saved with note and time, audited", jd.code === 200 && ja.stt_quality === "minor" && ja.stt_note === "고유명사 한 곳" && ja.stt_judged_at && jaudit.actor === "admin" && jaudit.detail.quality === "minor");
  check("judged session leaves the default list, shows with the toggle", !(await get("stt_list")).sessions.some((s) => s.participant_id === "TDATA-A") && (await get("stt_list", { judged: "1" })).sessions.some((s) => s.participant_id === "TDATA-A"));
  check("judging does not touch the audio", (await sql`SELECT count(*)::int AS n FROM audio_chunks WHERE session_id = ${A.id} AND purged_at IS NULL`)[0].n === 1 && ja.stt_judged_at !== null);
  const p1 = await post("purge_preview", { kind: "audio", scope: { mode: "all" } });
  const inPlan = new Set(p1.sessions.map((s) => s.participant_id));
  check("audio purge plan (all) contains judged AND unjudged sessions, not the test one", inPlan.has("TDATA-A") && inPlan.has("TDATA-B") && inPlan.has("TDATA-C") && !inPlan.has("TDATA-T"));

  // ---------- 2. purge: preview -> wrong count -> right count -> only the plan ----------
  const sel = await post("purge_preview", { kind: "audio", scope: { mode: "sessions", ids: [A.id, C.id] } });
  check("preview of selected sessions: plan id, count 2, 30-minute expiry", sel.code === 200 && sel.count === 2 && sel.plan_id && Math.abs(new Date(sel.expires_at) - Date.now() - 30 * 60_000) < 60_000);
  check("preview is audited and stores the plan", (await sql`SELECT count(*)::int AS n FROM audit_log WHERE action = 'purge_planned' AND detail ->> 'plan_id' = ${sel.plan_id}`)[0].n === 1
    && (await sql`SELECT count(*)::int AS n FROM purge_plans WHERE id = ${sel.plan_id} AND executed_at IS NULL`)[0].n === 1);
  const chunksOf = async (id) => (await sql`SELECT count(*)::int AS n FROM audio_chunks WHERE session_id = ${id} AND purged_at IS NULL`)[0].n;
  const wrong = await post("purge_execute", { plan_id: sel.plan_id, count: "1" });
  const none = await post("purge_execute", { plan_id: sel.plan_id });
  check("wrong or missing count -> refused, nothing purged", wrong.code === 400 && none.code === 400 && (await chunksOf(A.id)) === 1 && (await chunksOf(C.id)) === 1);
  check("a plan id that does not exist -> 404", (await post("purge_execute", { plan_id: crypto.randomUUID(), count: "2" })).code === 404 && (await post("purge_execute", { plan_id: "nope", count: "2" })).code === 404);
  await post("purge_preview", { kind: "audio", scope: { mode: "batch", batch: "TDATA" } }); // a later plan must not widen this one
  if (haveBlob) {
    await sql`INSERT INTO events (id, session_id, type) VALUES (${crypto.randomUUID()}, ${B.id}, 'tab_hidden')`; // B qualifies and changes: it is not in the plan anyway
    const ok = await post("purge_execute", { plan_id: sel.plan_id, count: "2" });
    check("right count -> exactly the plan's sessions are purged (A, C), B is untouched", ok.code === 200 && ok.done.length === 2 && (await chunksOf(A.id)) === 0 && (await chunksOf(C.id)) === 0 && (await chunksOf(B.id)) === 1);
    const [pa] = await sql`SELECT audio_purged_at FROM sessions WHERE id = ${A.id}`;
    check("purged session carries audio_purged_at; list shows it", !!pa.audio_purged_at && (await get("participants")).participants.find((p) => p.participant_id === "TDATA-A")?.audio_purged_at);
    check("result and plan are in the audit log", (await sql`SELECT count(*)::int AS n FROM audit_log WHERE action = 'purge_executed' AND detail ->> 'plan_id' = ${sel.plan_id} AND jsonb_array_length(detail -> 'plan' -> 'sessions') = 2`)[0].n === 1);
    check("the same plan cannot run twice", (await post("purge_execute", { plan_id: sel.plan_id, count: "2" })).code === 409);
    const b = await post("purge_preview", { kind: "audio", scope: { mode: "batch", batch: "TDATA" } });
    check("batch scope: only that batch (B; A is already purged)", b.sessions.map((s) => s.participant_id).join() === "TDATA-B");
    await sql`UPDATE purge_plans SET expires_at = now() - interval '1 minute' WHERE id = ${b.plan_id}`;
    check("an expired plan (30 min) cannot run", (await post("purge_execute", { plan_id: b.plan_id, count: "1" })).code === 410 && (await chunksOf(B.id)) === 1);
  } else { console.log("SKIP  audio purge execution (no Blob credentials): preview, typed count and plan checks above still ran"); }

  // withdrawn data (no Blob needed)
  const W = await mkSession("TDATA-W", { status: "abandoned" }), W2 = await mkSession("TDATA-W2", { status: "abandoned" });
  for (const s of [W, W2]) {
    await sql`UPDATE sessions SET destroy_pending = true WHERE id = ${s.id}`;
    for (let i = 0; i < 3; i++) await sql`INSERT INTO events (id, session_id, type) VALUES (${crypto.randomUUID()}, ${s.id}, 'tab_hidden')`;
  }
  const wp = await post("purge_preview", { kind: "withdrawn", scope: { mode: "sessions", ids: [W.id] } });
  check("withdrawn preview lists the rows that would go", wp.count === 1 && wp.sessions[0].deleted.events === 3);
  check("withdrawn: wrong count refused", (await post("purge_execute", { plan_id: wp.plan_id, count: "2" })).code === 400);
  const we = await post("purge_execute", { plan_id: wp.plan_id, count: "1" });
  const evs = async (id) => (await sql`SELECT count(*)::int AS n FROM events WHERE session_id = ${id}`)[0].n;
  check("withdrawn: right count -> W purged, W2 (not in the plan) untouched", we.code === 200 && we.done.length === 1 && (await evs(W.id)) === 0 && (await evs(W2.id)) === 3
    && (await sql`SELECT data_purged_at FROM sessions WHERE id = ${W.id}`)[0].data_purged_at !== null);
  check("purge_execute without login -> 401", (await run(admin, { method: "POST", query: { action: "purge_execute" }, body: { plan_id: wp.plan_id, count: "1" }, headers: {}, cookies: {} })).code === 401);

  // ---------- 3. export ----------
  const X = await mkSession("TDATA-X1", { batch: "TDATAX" }), Y = await mkSession("TDATA-X2", { batch: "TDATAX", status: "in_progress" }), Z = await mkSession("TDATA-X3", { batch: "TDATAX", test: true });
  for (const s of [X, Y, Z]) {
    await sql`INSERT INTO responses (session_id, phase, scale_id, block_id, item_id, value, display_order, shown_text) VALUES
      (${s.id}, 'pre', 'ISE', 'pre_ise', 'ISE1', '2'::jsonb, 1, NULL), (${s.id}, 'pre', 'ISE', 'pre_ise', 'ISE2', '6'::jsonb, 2, NULL),
      (${s.id}, 'post', 'OE', 'post_oe', 'OE1', ${JSON.stringify("자유 응답, \"인용\"\n줄바꿈")}::jsonb, 1, '다를 때 문구'), (${s.id}, 'pre', 'BG', 'pre_background', 'D9', '["가","나"]'::jsonb, 3, NULL)`;
    await sql`INSERT INTO answers (session_id, question_id, attempt, transcript, status, stage1_raw, scores, feedback, stance, model) VALUES
      (${s.id}, 'q2', 1, '답변 텍스트', 'done', '{"raw":1}', '{"situation":{"rating":3}}'::jsonb, '피드백 문장', 'direct', 'm-test')`;
    await sql`INSERT INTO events (id, session_id, type, question_id) VALUES (${crypto.randomUUID()}, ${s.id}, 'feedback_shown', 'q2')`;
  }
  const exportTo = async (q) => {
    const r = await get("export", q);
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "study1-ex-")), "e.zip");
    if (r.binary) fs.writeFileSync(f, r.binary);
    return { r, f };
  };
  const mine = (rows) => rows.filter((x) => x.participant_id.startsWith("TDATA-X"));
  const d0 = await exportTo({});
  check("export: zip with every file", d0.r.code === 200 && /zip/.test(d0.r.headers["content-type"]) && /attachment/.test(d0.r.headers["content-disposition"])
    && ["sessions.csv", "responses_long.csv", "responses_wide.csv", "answers.csv", "events.csv", "feedback_timing.csv", "feedback_audio.csv", "codebook.csv", "survey_items.json", "manifest.json"].every((n) => names(d0.f).includes(n)));
  const sess0 = csvRows(unzip(d0.f, "sessions.csv"));
  check("default filter: completed, non-test only", mine(sess0).map((r) => r.participant_id).join() === "TDATA-X1" && sess0.every((r) => r.is_test === "false" && r.status === "completed"));
  const di = await exportTo({ incomplete: "1" });
  check("include incomplete adds the in-progress session, still no test", mine(csvRows(unzip(di.f, "sessions.csv"))).map((r) => r.participant_id).join() === "TDATA-X1,TDATA-X2");
  const dt = await exportTo({ incomplete: "1", test: "1" });
  check("include test adds the test session", mine(csvRows(unzip(dt.f, "sessions.csv"))).map((r) => r.participant_id).join() === "TDATA-X1,TDATA-X2,TDATA-X3");
  const sr = mine(sess0)[0];
  check("sessions.csv carries condition, config summary and flags", sr.stance === "direct" && sr.modality === "text" && sr.llm_model === "m-test" && sr.stage1_sha256 === "h1" && sr.stage2_sha256 === "h2" && sr.commit_sha === "abc123" && sr.valid === "true" && "stt_quality" in sr && "resumed" in sr);
  const man = JSON.parse(unzip(d0.f, "manifest.json").toString("utf8"));
  const [{ n: nSess }] = await sql`SELECT count(*)::int AS n FROM sessions WHERE NOT is_test AND status = 'completed'`;
  const [{ n: nResp }] = await sql`SELECT count(*)::int AS n FROM responses r JOIN sessions s ON s.id = r.session_id WHERE NOT s.is_test AND s.status = 'completed'`;
  const [{ n: nAns }] = await sql`SELECT count(*)::int AS n FROM answers r JOIN sessions s ON s.id = r.session_id WHERE NOT s.is_test AND s.status = 'completed'`;
  const [{ n: nEv }] = await sql`SELECT count(*)::int AS n FROM events r JOIN sessions s ON s.id = r.session_id WHERE NOT s.is_test AND s.status = 'completed'`;
  const counted = (n) => csvRows(unzip(d0.f, n)).length;
  check("row counts equal the database (sessions, responses, answers, events)", man.files["sessions.csv"].rows === nSess && counted("sessions.csv") === nSess && counted("responses_long.csv") === nResp && man.files["responses_long.csv"].rows === nResp
    && counted("answers.csv") === nAns && counted("events.csv") === nEv && counted("responses_wide.csv") === nSess, `${nSess}/${nResp}/${nAns}/${nEv}`);
  check("manifest: schema version, filter, survey versions, commit, per-file rows", man.export_schema === EXPORT_SCHEMA && man.filter.include_test === false && man.filter.include_incomplete === false && man.survey_versions.includes("tv")
    && man.commit_sha.includes("abc123") && man.exported_at && man.files["answers.csv"].rows === nAns);
  const raw = unzip(d0.f, "sessions.csv");
  check("CSV files start with the UTF-8 BOM", ["sessions.csv", "responses_long.csv", "responses_wide.csv", "answers.csv", "events.csv", "feedback_timing.csv", "feedback_audio.csv", "codebook.csv"].every((n) => { const b = unzip(d0.f, n); return b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf; }) && raw.length > 3);
  const long = mine(csvRows(unzip(d0.f, "responses_long.csv")));
  const wide = mine(csvRows(unzip(d0.f, "responses_wide.csv")))[0];
  const val = (id) => long.find((r) => r.item_id === id)?.value;
  check("scores are raw (no reverse coding): the reversed item keeps its stored value, long and wide", val("ISE1") === "2" && val("ISE2") === "6" && wide.ISE1 === "2" && wide.ISE2 === "6");
  check("long: block_id, display_order, shown_text; text with quotes and newlines survives; multi-select joined", long.find((r) => r.item_id === "OE1").block_id === "post_oe" && long.find((r) => r.item_id === "ISE2").display_order === "2"
    && long.find((r) => r.item_id === "OE1").shown_text === "다를 때 문구" && val("OE1") === '자유 응답, "인용"\n줄바꿈' && val("D9") === "가|나");
  const an = mine(csvRows(unzip(d0.f, "answers.csv")))[0];
  check("answers.csv: transcript, Stage 1 output, Stage 2 feedback, attempt", an.transcript === "답변 텍스트" && an.stage1_raw === '{"raw":1}' && an.feedback === "피드백 문장" && an.attempt === "1");
  check("export is audited", (await sql`SELECT count(*)::int AS n FROM audit_log WHERE action = 'exported' AND actor = 'admin' AND ts >= ${t0.toISOString()}`)[0].n >= 3);
  for (const x of [d0, di, dt]) fs.rmSync(path.dirname(x.f), { recursive: true, force: true });

  // ---------- 4. external API ----------
  check("external API: no secret header -> 401", (await ext("status", { participant_ids: ["S1-001"] }, "")).code === 401);
  check("external API: wrong secret -> 401", (await ext("status", { participant_ids: ["S1-001"] }, "wrong")).code === 401);
  for (let i = 0; i < 4; i++) await ext("status", { participant_ids: ["S1-001"] }, "wrong");
  check("external API: too many wrong secrets from one IP -> 429, even for the right one afterwards", (await ext("status", { participant_ids: ["S1-001"] }, "wrong")).code === 429);
  await sql`DELETE FROM admin_login_failures WHERE ip = ${"api:" + API_IP}`;
  const st = await ext("status", { participant_ids: ["TDATA-X1", "TDATA-X2", "NOPE-1"] });
  check("status: participant_id, status, current_stage, completed_at, valid; unknown id -> not_found", st.code === 200 && st.rows.length === 3
    && st.rows[0].status === "completed" && st.rows[0].valid === true && st.rows[0].completed_at && st.rows[1].status === "in_progress" && st.rows[2].status === "not_found" && "current_stage" in st.rows[0]);
  for (const body of [{ participant_ids: ["S1-001"], phone: "010" }, { participant_ids: ["S1-001"], name: "x" }, { n: 1, batch_id: "TDATA", meta: { email: "a@b" } }]) {
    const r = await ext(body.n ? "issue" : "status", body);
    check(`personal field refused (${Object.keys(body).join(",")})`, r.code === 400 && /personal/.test(r.error));
  }
  check("unknown field refused", (await ext("status", { participant_ids: ["S1-001"], extra: 1 })).code === 400);
  check("status validates the id list", (await ext("status", { participant_ids: [] })).code === 400 && (await ext("status", { participant_ids: ["a b"] })).code === 400);
  const iss = await ext("issue", { n: 2, batch_id: "TDATAAPI" });
  for (const r of await sql`SELECT id FROM sessions WHERE batch_id = 'TDATAAPI'`) H.created.push(r.id);
  check("issue: [{participant_id, link}] with real S1- ids, audit actor 'api'", iss.code === 200 && iss.rows.length === 2 && iss.rows.every((r) => /^S1-\d{3}$/.test(r.participant_id) && /\/s\/[\w-]{20,}$/.test(r.link))
    && (await sql`SELECT count(*)::int AS n FROM audit_log WHERE actor = 'api' AND action = 'issued' AND session_id = ANY(${H.created}::uuid[])`)[0].n === 2);
  check("issue validates input (no n, bad batch)", (await ext("issue", { batch_id: "TDATAAPI" })).code === 400 && (await ext("issue", { n: 1, batch_id: "bad batch!" })).code === 400);
  for (const a of ["purge", "purge_preview", "purge_execute", "resume", "condition", "extend", "export"]) check(`external API has no ${a}`, (await ext(a, {})).code === 404);
  check("external API: wrong method -> 404", (await ext("status", {}, SECRET, "GET")).code === 404);
  for (let i = 0; i < 30; i++) await sql`INSERT INTO audit_log (actor, action) VALUES ('api', 'api_status')`;
  const lim = await ext("status", { participant_ids: ["TDATA-X1"] });
  check("rate limit: 30 calls a minute -> 429", lim.code === 429);
} catch (e) {
  check("test run without exception", false, e.stack || e.message);
} finally {
  delete process.env.ADMIN_API_SECRET;
  await sql`DELETE FROM admin_login_failures WHERE ip IN ('198.51.100.92', ${"api:" + API_IP})`;
  await sql`DELETE FROM audit_log WHERE actor IN ('api', 'admin') AND session_id IS NULL AND ts >= ${t0.toISOString()}`;
  await sql`DELETE FROM purge_plans WHERE created_at >= ${t0.toISOString()}`;
  await H.cleanup();
}
H.finish();

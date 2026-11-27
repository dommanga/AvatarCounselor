// Browser test: serves the app locally (static files + the /api/session handler) against a scratch database
// branch and drives it with headless Chrome over the DevTools protocol. A fake microphone stands in for the
// mic and SpeechRecognition is stubbed; the feedback is a real LLM call. Checks the participant flow and that
// every survey block renders as defined in survey_items.json (item order, groups, anchors, bold, inputs).
//   npm run test:ui -- --host <neon endpoint id of the dev branch> [--full] [--audio]
//   --full   also lets the 40 s thinking time run out (auto start) and the 2 min answer limit (auto submit)
//   --audio  upload the recorded chunks (needs Blob credentials in the environment); they are purged afterwards
// The voice-condition part (section D) needs ELEVENLABS_API_KEY and Blob credentials, otherwise it is skipped.
// Chrome: CHROME_PATH, default the macOS install.

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({ options: { full: { type: "boolean", default: false }, audio: { type: "boolean", default: false }, "admin-only": { type: "boolean", default: false } } });
process.env.AUDIO_UPLOAD_ENABLED = args.audio ? "true" : "false"; // read by lib/config.js at import time

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { requireTestDb } = await import("./cli.js");
requireTestDb();
const { createHarness, sleep } = await import("./test-lib.js");
const { default: handler } = await import("../api/session/[action].js");
const adminHandler = (await import("../api/admin/[action].js")).default;
const researcherHandler = (await import("../api/researcher/[action].js")).default;
const externalHandler = (await import("../api/external/[action].js")).default;
const { SURVEY, PHASES } = await import("../lib/survey.js");
const { conditionalText, rangeOf, anchorsOf, optionsOf, otherLabelOf } = await import("../src/survey-shared.js");
const { COPY } = await import("../src/copy.js");
const { QUESTIONS } = await import("../src/questions.js");
const { OE_MIN_CHARS, TEST_OVERRIDES } = await import("../lib/config.js");
const { missingCopyKeys } = await import("./check-copy.js");

const H = createHarness();
const { sql, check } = H;
const haveBlob = !!(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
let ttsRequests = 0; // ElevenLabs requests made by the handler in this process
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) => { if (String(url).includes("api.elevenlabs.io")) ttsRequests++; return realFetch(url, init); };
const PORT = 3123, DEBUG = 9333;
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "study1-chrome-"));

// ---------- local server: static files + /api/session/* + /s/* -> index.html ----------
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".css": "text/css" };
const server = http.createServer(async (rq, rs) => {
  const url = new URL(rq.url, "http://localhost");
  const route = url.pathname.startsWith("/api/session/") ? handler : url.pathname.startsWith("/api/admin/") ? adminHandler : url.pathname.startsWith("/api/researcher/") ? researcherHandler : url.pathname.startsWith("/api/external/") ? externalHandler : null;
  if (route) {
    const chunks = [];
    for await (const c of rq) chunks.push(c);
    const raw = Buffer.concat(chunks);
    const json = (rq.headers["content-type"] || "").includes("application/json");
    const req = {
      method: rq.method, headers: rq.headers, cookies: Object.fromEntries((rq.headers.cookie || "").split(/;\s*/).filter(Boolean).map((c) => [c.slice(0, c.indexOf("=")), c.slice(c.indexOf("=") + 1)])), query: { action: url.pathname.split("/").pop(), ...Object.fromEntries(url.searchParams) },
      body: json ? JSON.parse(raw.toString() || "{}") : undefined, async *[Symbol.asyncIterator]() { yield raw; },
    };
    const headers = {};
    const res = {
      code: 200, status(c) { this.code = c; return this; }, setHeader(k, v) { headers[k] = v; },
      json(d) { rs.writeHead(this.code, { ...headers, "content-type": "application/json" }); rs.end(JSON.stringify(d)); },
      end(buf) { rs.writeHead(this.code, headers); rs.end(buf); }, // the spoken feedback (mp3)
    };
    try { await route(req, res); } catch (e) { rs.writeHead(500); rs.end(String(e)); }
    return;
  }
  const file = url.pathname.startsWith("/s/") || url.pathname === "/" ? "/index.html" : url.pathname === "/admin" ? "/admin.html" : url.pathname;
  const p = path.join(ROOT, file);
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { rs.writeHead(404); return rs.end("not found"); }
  rs.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream", "referrer-policy": "no-referrer" });
  fs.createReadStream(p).pipe(rs);
}).listen(PORT);

// ---------- Chrome + CDP ----------
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${DEBUG}`, "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
  "--autoplay-policy=no-user-gesture-required", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore" });
for (let i = 0; i < 50; i++) { try { await fetch(`http://localhost:${DEBUG}/json/version`); break; } catch { await sleep(200); } }

const consoleIssues = [];
async function newPage() {
  const t = await (await fetch(`http://localhost:${DEBUG}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let n = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); return; }
    if (m.method === "Runtime.exceptionThrown") consoleIssues.push(`exception: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") consoleIssues.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 200)}`);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++n; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  await send("Runtime.enable"); await send("Page.enable");
  const ev = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const waitFor = async (expression, timeoutMs = 15000, label = expression) => {
    const t0 = Date.now();
    for (;;) {
      try { if (await ev(expression)) return true; } catch { /* page navigating */ }
      if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for: ${label}`);
      await sleep(200);
    }
  };
  const screen = (id) => `(() => { const s = document.getElementById("${id}"); return !!s && !s.classList.contains("hidden"); })()`;
  const click = (id) => ev(`document.getElementById("${id}").click()`);
  const reloadTo = async (screenId) => {
    await sleep(1200); // events are sent in the background: let the last click reach the server before leaving
    await ev(`window.__old = 1`);
    await send("Page.reload");
    await waitFor(`window.__old === undefined && document.readyState === "complete"`, 20000, "fresh document");
    await waitFor(screen(screenId), 20000, `${screenId} after reload`);
    await sleep(400);
  };
  return { send, ev, waitFor, screen, click, reloadTo, close: () => ws.close() };
}

// keeps the page's Audio elements reachable and makes the first play() of every page load fail, like a browser that wants a click
const AUDIO_STUB = `(() => {
  const RealAudio = window.Audio, realPlay = HTMLMediaElement.prototype.play;
  let first = true;
  window.__audios = [];
  window.Audio = function (...a) { const el = new RealAudio(...a); window.__audios.push(el); return el; };
  window.Audio.prototype = RealAudio.prototype;
  HTMLMediaElement.prototype.play = function () { if (first) { first = false; return Promise.reject(new DOMException("blocked", "NotAllowedError")); } return realPlay.call(this); };
})();`;

const STUB = `(() => {
  class FakeSR {
    constructor() { this.onresult = this.onend = this.onerror = this.onstart = null; this._t = null; this._running = false; this._life = 0; }
    start() {
      if (this._running) throw new Error("already started");
      this._running = true; this._life = 0;
      setTimeout(() => this.onstart && this.onstart(), 0);
      this._t = setInterval(() => {
        this._life++;
        const ans = (() => { const el = document.getElementById("p-answering"); return !!el && !el.classList.contains("hidden"); })();
        const text = !ans ? "오늘은 하늘이 맑고 바람이 시원하게 붑니다" : "제가 이끌어서 끝까지 해낸 동아리 행사 기획 경험을 말씀드리겠습니다 " + (++window.__segCount);
        const r = [{ transcript: text }]; r.isFinal = true;
        this.onresult && this.onresult({ resultIndex: 0, results: [r] });
        if (ans && this._life === 3 && !window.__ended) { window.__ended = true; clearInterval(this._t); this._running = false; this.onend && this.onend(); } // the browser ends recognition on silence
      }, 700);
    }
    stop() { clearInterval(this._t); this._running = false; setTimeout(() => this.onend && this.onend(), 30); }
  }
  window.__segCount = 0;
  window.SpeechRecognition = window.webkitSpeechRecognition = FakeSR;
})();`;

// ---------- survey screens ----------
// answers every item of the displayed block; overrides: { item_id: value }. AT items get their correct value.
const fillExpr = (overrides = {}) => `(() => { const ov = ${JSON.stringify(overrides)};
  for (const el of document.querySelectorAll("#p-surveyItems .evalitem")) {
    const id = el.dataset.item, label = (el.querySelector(".qlabel") || {}).textContent || "";
    const radios = [...el.querySelectorAll("input[type=radio]")], checks = [...el.querySelectorAll("input[type=checkbox]")];
    const num = el.querySelector("input.numinput"), ta = el.querySelector("textarea");
    const set = (input, v) => { input.value = v; input.dispatchEvent(new Event("input", { bubbles: true })); };
    if (num) set(num, "25");
    else if (ta) set(ta, "테스트 응답입니다.");
    else if (radios.length) { let pick = radios[0]; const want = id in ov ? String(ov[id]) : id === "AT1" ? "2" : id === "AT2" ? "8" : null; if (want !== null) pick = radios.find((r) => r.value === want) || pick; pick.click(); }
    else if (checks.length) checks[0].click();
  } })()`;

const plain = (s) => String(s ?? "").replace(/\*\*/g, "");
const DOM_EXPR = `(() => ({
  progress: document.getElementById("p-surveyProgress").textContent,
  title: document.getElementById("p-surveyTitle").classList.contains("hidden") ? "" : document.getElementById("p-surveyTitle").textContent,
  instruction: document.getElementById("p-surveyInstr").classList.contains("hidden") ? "" : document.getElementById("p-surveyInstr").textContent,
  nodes: [...document.querySelectorAll("#p-surveyItems > *")].map((el) => el.classList.contains("evalitem") ? {
    t: "item", id: el.dataset.item, label: (el.querySelector(".qlabel") || {}).textContent || "", strong: el.querySelectorAll(".qlabel strong").length,
    hint: (el.querySelector(".hint") || {}).textContent || "",
    pills: [...el.querySelectorAll(".pill")].map((p) => p.textContent),
    anchors: [...el.querySelectorAll(".anchor")].map((a) => ({ text: a.textContent, col: Number(/grid-column:\\s*(\\d+)/.exec(a.getAttribute("style"))[1]) })),
    options: [...el.querySelectorAll(".choice span")].map((s) => s.textContent), kind: (el.querySelector(".choice input") || {}).type || "",
    num: !!el.querySelector("input.numinput"), numMax: (el.querySelector("input.numinput") || {}).maxLength, textarea: !!el.querySelector("textarea"),
    placeholder: (el.querySelector("textarea") || {}).placeholder || "", otherBox: !!el.querySelector(".othertext"),
  } : { t: el.className.split(" ")[0], text: el.textContent }),
}))()`;

// differences between the rendered block and survey_items.json + the session's stored order
function expectBlock(phase, block, order, dom, values) {
  const bad = [];
  if (dom.instruction !== (block.instruction ?? "")) bad.push(`instruction "${dom.instruction}"`);
  if (dom.title !== (block.title ?? "")) bad.push("title");
  const items = new Map(block.items.map((i) => [i.id, i]));
  const groups = new Map((block.groups || []).map((g) => [g.id, g]));
  const expectSeq = [];
  if (block.stem) expectSeq.push(`blockstem:${plain(block.stem)}`);
  let last;
  for (const id of order) {
    const it = items.get(id);
    if (it.group !== last) { const st = groups.get(it.group)?.stem; if (st) expectSeq.push(`groupstem:${plain(st)}`); last = it.group; }
    expectSeq.push(`item:${id}`);
  }
  const gotSeq = dom.nodes.map((n) => (n.t === "item" ? `item:${n.id}` : `${n.t}:${n.text}`));
  if (gotSeq.join("\n") !== expectSeq.join("\n")) bad.push(`sequence ${gotSeq.join(" > ")} != ${expectSeq.join(" > ")}`);
  for (const n of dom.nodes.filter((x) => x.t === "item")) {
    const it = items.get(n.id);
    if (!it) continue;
    const type = it.type ?? "likert";
    const text = it.conditional ? conditionalText(it, values) : (it.text ?? "");
    if (n.label !== plain(text)) bad.push(`${n.id} label "${n.label}"`);
    if (n.strong !== (String(text).match(/\*\*(.+?)\*\*/g) || []).length) bad.push(`${n.id} bold x${n.strong}`);
    if (n.hint !== (it.hint ?? "")) bad.push(`${n.id} hint`);
    if (type === "likert" || type === "semantic") {
      const [min, max] = rangeOf(it, block);
      const want = Array.from({ length: max - min + 1 }, (_, k) => String(min + k));
      if (n.pills.join() !== want.join()) bad.push(`${n.id} pills ${n.pills}`);
      const anchors = Object.entries(anchorsOf(it, block)).map(([v, t]) => ({ text: plain(t), col: Number(v) - min + 1 }));
      if (JSON.stringify(n.anchors) !== JSON.stringify(anchors)) bad.push(`${n.id} anchors ${JSON.stringify(n.anchors)}`);
    } else if (type === "single" || type === "multi") {
      if (n.options.join("|") !== optionsOf(it).join("|") || n.kind !== (type === "single" ? "radio" : "checkbox")) bad.push(`${n.id} options ${n.options}`);
      if (n.otherBox !== !!otherLabelOf(it)) bad.push(`${n.id} other box`);
    } else if (type === "number") {
      if (!n.num || n.numMax !== String(rangeOf(it, block)[1]).length) bad.push(`${n.id} number input`);
    } else if (type === "text") {
      if (!n.textarea || n.placeholder !== COPY.surveyTextPlaceholder(OE_MIN_CHARS)) bad.push(`${n.id} textarea "${n.placeholder}"`);
    }
  }
  return bad;
}

// Walks survey blocks of one phase until `until` is true: checks each rendered block, fills and submits it.
// overrides apply to matching items; onBlock(blockId, page) runs extra checks while the block is shown.
async function runSurvey(p, phase, stored, until, { overrides = {}, values = {}, onBlock } = {}) {
  const blocks = SURVEY[phase];
  for (let guard = 0; guard < 12; guard++) {
    await p.waitFor(`${p.screen("p-survey")} || (${until})`, 25000, `${phase} survey block or next screen`);
    if (await p.ev(until)) return;
    const dom = await p.ev(DOM_EXPR);
    const idx = Number(/(\d+) \//.exec(dom.progress)?.[1] ?? 1) - 1;
    const block = blocks[blocks.length === 1 ? 0 : idx];
    const bad = expectBlock(phase, block, stored[phase][block.block], dom, values);
    const label = COPY.surveyOf(phase, idx + 1, blocks.length);
    check(`${block.block}: renders as defined`, bad.length === 0 && dom.progress === label, bad.slice(0, 3).join("; ") || dom.progress);
    if (onBlock) await onBlock(block.block, p);
    await p.ev(fillExpr(overrides));
    await p.click("p-surveyNext");
    await p.waitFor(`document.getElementById("p-surveyProgress").textContent !== ${JSON.stringify(dom.progress)} || !${p.screen("p-survey")}`, 25000, "block saved");
    for (const it of block.items) if (it.id in overrides) values[it.id] = overrides[it.id];
  }
}

// Opens a prepared session (consented through the API, at the scenario stage) in a new page and plays through scenario ->
// answer instructions -> question -> a short answer -> the self-rating screen. -> the page
async function openAndAnswer(session, extraScripts = []) {
  const pg = await newPage();
  await pg.send("Page.addScriptToEvaluateOnNewDocument", { source: STUB });
  for (const source of extraScripts) await pg.send("Page.addScriptToEvaluateOnNewDocument", { source });
  await pg.send("Page.navigate", { url: `http://localhost:${PORT}/s/${session.token}` });
  await pg.waitFor(pg.screen("p-scenario"), 20000, "scenario after the resume");
  await pg.click("p-scenarioNext");
  await pg.waitFor(pg.screen("p-qguide"), 5000, "answer instructions");
  await pg.click("p-qguideStart");
  await pg.waitFor(pg.screen("p-question"), 5000, "question screen");
  await pg.click("p-startBtn");
  await pg.waitFor(`!document.getElementById("p-answering").classList.contains("hidden")`, 10000, "answering panel");
  await sleep(4500);
  await pg.click("p-doneBtn");
  await pg.waitFor(`${pg.screen("p-survey")} && document.getElementById("p-surveyProgress").textContent === ${JSON.stringify(COPY.surveyProgress.mid)}`, 30000, "self-rating");
  return pg;
}
// a consented session in the text condition, moved up to the scenario stage and handed over to a new page
async function textSessionAtScenario(pid) {
  const x = await H.started(pid, { modality: "text" });
  for (const t of ["device_test_done", "survey_pre_submitted", "notice_confirmed", "scenario_shown"]) await x.T.event(t);
  await x.T.release();
  return x;
}
async function waitRow(table, sessionId) {
  for (let i = 0; i < 30; i++) {
    const [r] = await sql.query(`SELECT * FROM ${table} WHERE session_id = $1`, [sessionId]);
    if (r) return r;
    await sleep(200);
  }
  return null;
}

const storedOrder = async (id) => (await sql`SELECT survey_order FROM sessions WHERE id = ${id}`)[0].survey_order;

async function toQuestion(p, token, sessionId) {
  await p.send("Page.addScriptToEvaluateOnNewDocument", { source: STUB });
  await p.send("Page.navigate", { url: `http://localhost:${PORT}/s/${token}` });
  await p.waitFor(p.screen("p-consent"), 20000, "consent screen");
  check("tab title is 면접 연습 and no 'AI 면접 코치' header on the page", (await p.ev(`document.title`)) === "면접 연습" && !(await p.ev(`document.body.innerText.includes("AI 면접 코치")`)));
  await p.ev(`document.querySelector('input[name="p-withdrawData"][value="use"]').click(); document.querySelector('input[name="p-notify"][value="yes"]').click(); document.getElementById("p-consentAgree").click();`);
  await p.click("p-consentBtn");
  await p.waitFor(p.screen("p-device"), 20000, "device test");
  await sql`UPDATE sessions SET modality = 'text' WHERE id = ${sessionId}`; // flow B is the text condition; its cell came from the slot sequence
  // speaker: the chime repeats until [정지]; going on is possible only after stopping
  check("speaker wording", (await p.ev(`document.querySelector("#p-spkStep p").textContent`)) === COPY.speakerGuide);
  const spk = () => p.ev(`({ label: document.getElementById("p-spkPlay").textContent, nextShown: !document.getElementById("p-spkNext").classList.contains("hidden"), nextDisabled: document.getElementById("p-spkNext").disabled })`);
  check("before playing: [재생], no way on yet", (await spk()).label === COPY.speakerPlay && !(await spk()).nextShown);
  await p.click("p-spkPlay");
  const playing = await spk();
  await sleep(1600);
  await p.click("p-spkPlay");
  const stopped = await spk();
  check("while playing the button is [정지] and [다음] waits", playing.label === COPY.speakerStop && playing.nextShown && playing.nextDisabled);
  check("after [정지]: [재생] again and [다음] is enabled", stopped.label === COPY.speakerPlay && stopped.nextShown && !stopped.nextDisabled);
  await p.click("p-spkPlay"); await sleep(600); await p.click("p-spkPlay"); // a second play
  await p.click("p-spkNext");
  await p.click("p-micAllow");
  await p.waitFor(`!document.getElementById("p-micTest").classList.contains("hidden")`, 8000, "mic test panel");
  await p.click("p-micAction"); await sleep(1600); await p.click("p-micAction");
  await p.waitFor(`!document.getElementById("p-micNext").classList.contains("hidden")`, 8000, "mic result");
  const micText = await p.ev(`document.getElementById("p-micResult").textContent`);
  await p.click("p-micNext");
  return micText;
}

try {
  const missingCopy = missingCopyKeys();
  check("every wording key the page uses exists in copy.js", missingCopy.length === 0, missingCopy.map((m) => m.key).join(", "));

  // ---------- G: /admin ----------
  {
    const { lockSession } = await import("../lib/lifecycle.js");
    const { paymentFormLink } = await import("../src/copy.js");
    const adminStart = new Date().toISOString();
    const P1 = await H.started("UIA-P1");               // locked before the stimulus
    await P1.T.say(1, ""); await P1.T.say(2, "");
    const X1 = await H.started("UIA-X1");               // locked after the stimulus
    await X1.T.event("feedback_shown", "q2");
    await lockSession(X1.s.id, "resume_limit");
    await H.started("UIA-A1");                          // in progress
    await H.issue("UIA-I1");                            // never opened
    await H.issue("UIA-T1", { test: true });            // test session: hidden by default
    const pa = await newPage();
    const rowOf = (pid) => `[...document.querySelectorAll("#ptable tr.row")].find((tr) => tr.firstElementChild.textContent.startsWith("${pid}"))`;
    const pids = () => pa.ev(`[...document.querySelectorAll("#ptable tr.row")].map((tr) => tr.firstElementChild.textContent.trim().split(" ")[0])`);
    const setVal = (id, v) => pa.ev(`(() => { const el = document.getElementById("${id}"); el.value = ${JSON.stringify(v)}; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await pa.send("Page.navigate", { url: `http://localhost:${PORT}/admin` });
    await pa.waitFor(pa.screen("login"), 10000, "login screen");
    check("admin: login screen first, app hidden, noindex meta", !(await pa.ev(pa.screen("app"))) && await pa.ev(`!!document.querySelector('meta[name=robots][content*=noindex]')`));
    await setVal("pw", "wrong"); await pa.ev(`document.getElementById("loginForm").requestSubmit()`);
    await pa.waitFor(`document.getElementById("loginErr").textContent.length > 0`, 10000, "login error");
    check("admin: wrong password -> message, still on the login screen", await pa.ev(pa.screen("login")));
    await setVal("pw", process.env.RESEARCHER_PASSWORD); await pa.ev(`document.getElementById("loginForm").requestSubmit()`);
    await pa.waitFor(pa.screen("app"), 10000, "app");
    await pa.waitFor(`document.querySelectorAll("#ptable tr.row").length > 0`, 10000, "participant rows");
    let ids = await pids();
    check("admin: participants listed, test sessions hidden by default", ["UIA-P1", "UIA-X1", "UIA-A1", "UIA-I1"].every((x) => ids.includes(x)) && !ids.includes("UIA-T1"));
    check("admin: left menu has the four entries, participants active", await pa.ev(`[...document.querySelectorAll("nav.side a")].map((a) => a.textContent.trim()).join("|")`) === "참가자|발급|셀 현황|감사 로그");
    const badge = (pid) => pa.ev(`(${rowOf(pid)}).querySelector(".badge").textContent`);
    check("admin: status badges (진행 중 / 잠김 / 미접속)", (await badge("UIA-A1")) === "진행 중" && (await badge("UIA-P1")) === "잠김" && (await badge("UIA-I1")) === "미접속");
    await pa.ev(`(() => { const c = document.getElementById("fTest"); c.checked = true; c.dispatchEvent(new Event("change")); })()`);
    check("admin: test toggle shows the test session", (await pids()).includes("UIA-T1"));
    await pa.ev(`(() => { const c = document.getElementById("fTest"); c.checked = false; c.dispatchEvent(new Event("change")); })()`);
    check("admin: condition columns hidden by default, toggle shows them", !(await pa.ev(`!!document.querySelector('#ptable th[data-key=stance]')`))
      && (await pa.ev(`(() => { const c = document.getElementById("fCond"); c.checked = true; c.dispatchEvent(new Event("change")); return !!document.querySelector('#ptable th[data-key=stance]'); })()`)));
    await pa.ev(`document.querySelector('#quick button[data-q=locked]').click()`);
    ids = await pids();
    check("admin: quick filter 잠김", ids.includes("UIA-P1") && ids.includes("UIA-X1") && !ids.includes("UIA-A1") && !ids.includes("UIA-I1"));
    await pa.ev(`document.querySelector('#quick button[data-q=locked]').click()`);
    await pa.ev(`document.querySelector('#ptable th[data-key=participant_id]').click()`);
    const asc = (await pids()).filter((x) => x.startsWith("UIA-"));
    await pa.ev(`document.querySelector('#ptable th[data-key=participant_id]').click()`);
    const desc = (await pids()).filter((x) => x.startsWith("UIA-"));
    check("admin: sortable header toggles the order", asc.length >= 4 && JSON.stringify(asc) === JSON.stringify([...desc].reverse()) && JSON.stringify(asc) === JSON.stringify([...asc].sort()));
    // detail panel: post-exposure lock cannot be resumed
    await pa.ev(`(${rowOf("UIA-X1")}).click()`);
    await pa.waitFor(`document.getElementById("panel").classList.contains("open") && !!document.getElementById("pResume")`, 10000, "panel");
    check("admin: panel of a post-exposure lock: resume disabled with the reason shown",
      await pa.ev(`document.getElementById("pResume").disabled && /노출/.test(document.getElementById("pResume").title) && /노출/.test(document.querySelector("#panel .why").textContent)`));
    check("admin: panel timeline shows the feedback reveal and the lock", await pa.ev(`/피드백 공개/.test(document.querySelector("#panel .timeline").textContent) && /잠김/.test(document.querySelector("#panel .timeline").textContent)`));
    check("admin: condition change disabled for it too", await pa.ev(`document.getElementById("pCond").disabled`));
    // pre-exposure lock: resume with confirm + reason
    await pa.ev(`(${rowOf("UIA-P1")}).click()`);
    await pa.waitFor(`document.querySelector("#panel header strong")?.textContent === "UIA-P1"`, 10000, "panel of UIA-P1");
    check("admin: resume enabled for the pre-exposure lock", await pa.ev(`!document.getElementById("pResume").disabled`));
    await pa.ev(`window.__clip = []; navigator.clipboard.writeText = (t) => { window.__clip.push(t); return Promise.resolve(); }`);
    await pa.click("pPay");
    await pa.waitFor(`document.getElementById("pCopied").textContent.length > 0`, 5000, "copied note");
    check("admin: payment link copied with the participant id", (await pa.ev(`window.__clip[0]`)) === paymentFormLink("UIA-P1"));
    await pa.click("pResume");
    check("admin: resume opens a confirm dialog with a reason field", await pa.ev(`document.getElementById("dlg").open && !document.getElementById("dlgReasonRow").classList.contains("hidden")`));
    await pa.ev(`document.getElementById("dlgForm").requestSubmit()`);
    check("admin: empty reason refused, dialog stays open", await pa.ev(`document.getElementById("dlg").open && document.getElementById("dlgErr").textContent.length > 0`));
    await setVal("dlgReason", "UI 테스트: 마이크 문제");
    await pa.ev(`document.getElementById("dlgForm").requestSubmit()`);
    await pa.waitFor(`!document.getElementById("dlg").open`, 15000, "dialog closed");
    await pa.waitFor(`document.querySelector("#panel header .badge")?.textContent === "진행 중"`, 15000, "panel shows in progress");
    const [pr] = await sql`SELECT status FROM sessions WHERE id = ${P1.s.id}`;
    check("admin: resumed through the UI (DB + panel + audit)", pr.status === "in_progress" && (await sql`SELECT count(*)::int AS n FROM audit_log WHERE session_id = ${P1.s.id} AND action = 'resumed' AND detail ->> 'reason' = 'UI 테스트: 마이크 문제'`)[0].n === 1);
    await pa.ev(`document.getElementById("pClose").click()`);
    check("admin: panel closes", !(await pa.ev(`document.getElementById("panel").classList.contains("open")`)));
    // issue (test links: no slot, T1- numbers)
    await pa.ev(`location.hash = "#issue"`);
    await pa.waitFor(pa.screen("v-issue"), 5000, "issue view");
    await setVal("iN", "2"); await setVal("iBatch", "UIAT");
    await pa.ev(`(() => { const c = document.getElementById("iTest"); c.checked = true; c.dispatchEvent(new Event("change")); })()`);
    await pa.ev(`document.getElementById("issueForm").requestSubmit()`);
    await pa.waitFor(`document.querySelectorAll("#itable tbody tr").length === 2`, 15000, "issued rows");
    const issuedRows = await pa.ev(`[...document.querySelectorAll("#itable tbody tr")].map((tr) => [...tr.children].map((td) => td.textContent))`);
    for (const r of await sql`SELECT id FROM sessions WHERE batch_id = 'UIAT'`) H.created.push(r.id);
    check("admin: issue form -> result table with T1- ids and /s/ links", issuedRows.every(([id, link]) => /^T1-\d{3}$/.test(id) && /\/s\/[\w-]{20,}$/.test(link)));
    const csvText = await pa.ev(`fetch(document.getElementById("csvDl").href).then((r) => r.text())`);
    check("admin: CSV download matches the table", csvText.split(/\r?\n/)[0] === "participant_id,link" && issuedRows.every(([id, link]) => csvText.includes(`${id},${link}`)));
    await pa.click("linksCopy");
    check("admin: bulk copy of all links", (await pa.ev(`window.__clip.at(-1)`)).split("\n").length === 2);
    // cells
    await pa.ev(`location.hash = "#cells"`);
    await pa.waitFor(`document.querySelectorAll("#ctable tbody tr").length === 4`, 10000, "cell table");
    const [{ n: inProg }] = await sql`SELECT count(*)::int AS n FROM sessions WHERE NOT is_test AND status IN ('consented','in_progress')`;
    const shown = await pa.ev(`[...document.querySelectorAll("#ctable tbody tr:last-child td:last-child .l")].map((e) => e.textContent)`);
    check("admin: cell table total in-progress equals the database", shown[0] === `진행 중 ${inProg}`, `${shown[0]} vs ${inProg}`);
    check("admin: remaining line present, emergency section folded", await pa.ev(`/목표까지 남은 인원/.test(document.getElementById("ctotals").textContent) && !document.getElementById("emergency").open`));
    await pa.ev(`document.getElementById("emergency").open = true`);
    await pa.waitFor(`document.querySelectorAll("#utable tbody tr").length > 0`, 10000, "emergency tables");
    // audit
    await pa.ev(`location.hash = "#audit"`);
    await pa.waitFor(`document.querySelectorAll("#atable tbody tr").length > 0`, 10000, "audit rows");
    await setVal("aPid", "UIA-P1");
    await pa.waitFor(`[...document.querySelectorAll("#atable tbody tr")].every((tr) => tr.children[3].textContent === "UIA-P1") && document.querySelectorAll("#atable tbody tr").length >= 2`, 10000, "filtered audit");
    check("admin: audit view filters by participant, newest first, shows the reason", await pa.ev(`document.querySelector("#atable tbody tr td:nth-child(3)").textContent === "resumed" && /UI 테스트/.test(document.querySelector("#atable tbody tr").textContent)`));
    pa.close();
    await sql`DELETE FROM admin_login_failures WHERE ts >= ${adminStart} AND ip = 'unknown'`;
    if (args["admin-only"]) throw new Error("admin-only");
  }

  // ---------- A: unsupported browser leaves the link untouched ----------
  const a = await H.issue("UI-A");
  {
    const p = await newPage();
    await p.send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1", userAgentMetadata: { brands: [{ brand: "Safari", version: "17" }], mobile: true, platform: "iOS", platformVersion: "17", architecture: "", model: "", fullVersion: "17" } });
    await p.send("Page.navigate", { url: `http://localhost:${PORT}/s/${a.token}` });
    await p.waitFor(p.screen("p-blocked"), 10000, "blocked screen");
    check("unsupported browser -> Chrome-only notice", (await p.ev(`document.getElementById("p-blockedText").textContent`)) === COPY.blocked.unsupported[1]);
    const [row] = await sql`SELECT status, opened_at FROM sessions WHERE id = ${a.id}`;
    check("link state untouched (still issued, no claim)", row.status === "issued" && row.opened_at === null
      && (await sql`SELECT count(*)::int AS n FROM session_clients WHERE session_id = ${a.id}`)[0].n === 0);
    p.close();
  }

  // ---------- B: the whole flow, scores equal (7 and 7) ----------
  const b = await H.issue("UI-B");
  const p = await newPage();
  const micText = await toQuestion(p, b.token, b.id);
  check("device test: recognized sentence shown", micText.includes("하늘이 맑고"));
  const tones = await sql`SELECT type, data FROM events WHERE session_id = ${b.id} AND type LIKE 'speaker_tone_%' ORDER BY seq`;
  check("speaker starts / stops and play durations logged", tones.map((e) => e.type).join() === "speaker_tone_start,speaker_tone_stop,speaker_tone_start,speaker_tone_stop"
    && tones[1].data.duration_ms >= 1400 && tones[3].data.duration_ms >= 400, tones.filter((e) => e.type.endsWith("stop")).map((e) => e.data.duration_ms).join("/") + " ms");
  const stored = await storedOrder(b.id);
  const bValues = {};
  let smiOrderSeen;
  await runSurvey(p, "pre", stored, p.screen("p-notice"), { // after the device test the pre-survey comes first, then the notice
    values: bValues,
    async onBlock(id, pg) {
      if (id === "pre_background") { // the "기타(직접 입력)" option opens a free-text box
        const box = (shown) => pg.ev(`!document.querySelector('.othertext').classList.contains("hidden") === ${shown}`);
        await pg.ev(`[...document.querySelectorAll('input[name="D3"]')].find((r) => r.value === "기타(직접 입력)").click()`);
        const opened = await box(true);
        await pg.ev(`document.querySelector('input[name="D3"]').click()`);
        check("D3: choosing 기타(직접 입력) shows the free-text box, another option hides it", opened && (await box(false)));
        await pg.ev(`document.getElementById("p-surveyNext").click()`); // nothing answered yet: refused
        check("an unanswered block is refused", (await pg.ev(`document.getElementById("p-surveyErr").textContent`)).includes("응답하지 않은 문항"));
      }
      if (id === "pre_smi") {
        smiOrderSeen = (await pg.ev(DOM_EXPR)).nodes.filter((n) => n.t === "item").map((n) => n.id);
        await pg.reloadTo("p-survey");
        const again = (await pg.ev(DOM_EXPR)).nodes.filter((n) => n.t === "item").map((n) => n.id);
        check("reload on a survey block shows the same item order", again.join() === smiOrderSeen.join());
        check("AT1 sits between the two SMI groups on screen", smiOrderSeen[4] === "AT1");
      }
    },
  });
  check("pre-survey done -> notice", await p.ev(p.screen("p-notice")));
  const notice = await p.ev(`({ title: document.querySelector("#p-notice h2").textContent, items: [...document.querySelectorAll("#p-notice li")].map((l) => l.textContent), btn: document.getElementById("p-noticeConfirm").textContent })`);
  check("notice: wording and the confirm button", notice.title === COPY.noticeTitle && notice.items.join("|") === COPY.noticeItems.join("|") && notice.btn === COPY.noticeConfirm);
  await p.reloadTo("p-notice");
  check("reload on the notice -> the notice again", true);
  await p.click("p-noticeConfirm");
  await p.waitFor(p.screen("p-scenario"), 8000, "scenario after the notice");
  let noticeAt = [];
  for (let i = 0; i < 25 && !noticeAt.length; i++) { // sent in the background
    noticeAt = await sql`SELECT server_ts FROM events WHERE session_id = ${b.id} AND type = 'notice_confirmed'`;
    if (!noticeAt.length) await sleep(200);
  }
  check("notice confirmation time recorded", noticeAt.length === 1 && !!noticeAt[0].server_ts);
  const sc = await p.ev(`({ title: document.querySelector("#p-scenario h2").textContent, introHidden: document.querySelector('#p-scenario [data-copy="scenarioIntro"]').classList.contains("hidden"),
    intro: document.querySelector('#p-scenario [data-copy="scenarioIntro"]').textContent, body: document.querySelector("#p-scenario .text").textContent })`);
  check("scenario: title and body as in copy.js; the line under the title only when copy.js has one (empty -> not rendered)",
    sc.title === COPY.scenarioTitle && sc.body === COPY.scenarioBody && (COPY.scenarioIntro === "" ? sc.introHidden : !sc.introHidden && sc.intro === COPY.scenarioIntro));
  await p.click("p-scenarioNext");

  // answer instructions: the countdown must not run here
  await p.waitFor(p.screen("p-qguide"), 5000, "answer instructions");
  const guide = await p.ev(`({ title: document.querySelector("#p-qguide h2").textContent, items: [...document.querySelectorAll("#p-qguide li")].map((l) => l.textContent), btn: document.getElementById("p-qguideStart").textContent })`);
  check("answer instructions: wording and [시작하기]", guide.title === COPY.qguideTitle && guide.items.join("|") === COPY.qguideItems.join("|") && guide.btn === COPY.qguideStart);
  check("the question is not on screen yet", !(await p.ev(p.screen("p-question"))));
  await sleep(3500); // time spent reading the instructions must not eat into the thinking time
  await p.click("p-qguideStart");
  await p.waitFor(p.screen("p-question"), 5000, "question screen");
  const think0 = await p.ev(`document.getElementById("p-thinkTime").textContent`);
  check("the countdown starts when the question appears (still 40 after 3.5 s on the instructions)", /^(40|39)초$/.test(think0), think0);
  const qs = await p.ev(`({ text: document.getElementById("p-questionText").textContent, visible: document.getElementById("p-question").innerText,
    label: !!document.querySelector("#p-question .who"), hint: !!document.getElementById("p-questionHint"), icons: document.querySelectorAll("#participantView img, #participantView svg, #participantView canvas").length })`);
  check("question screen: only the question in its box — no coach label or icon, no hint line", qs.text === QUESTIONS.q2 && !qs.label && !qs.hint && qs.icons === 0 && !qs.visible.includes("AI 코치"));
  check("... countdown and [답변 시작], without the long instructions or any header",
    qs.visible.includes(COPY.thinkLabel) && qs.visible.includes(COPY.answerStart) && !qs.visible.includes("주어집니다") && !qs.visible.includes("최대 2분") && !qs.visible.includes("AI 면접 코치"));
  let flowEvents = [];
  for (let i = 0; i < 25 && !flowEvents.includes("question_shown"); i++) { // sent in the background
    flowEvents = [...new Set((await sql`SELECT type FROM events WHERE session_id = ${b.id} AND type IN ('device_test_done','survey_pre_submitted','notice_confirmed','scenario_shown','question_guide_shown','question_shown') ORDER BY seq`).map((e) => e.type))];
    if (!flowEvents.includes("question_shown")) await sleep(200);
  }
  check("event order: device test, pre-survey, notice, scenario, answer instructions, question",
    flowEvents.join() === "device_test_done,survey_pre_submitted,notice_confirmed,scenario_shown,question_guide_shown,question_shown", flowEvents.join(" > "));
  let ge = [];
  for (let i = 0; i < 25 && ge.length < 2; i++) { // events are sent in the background
    ge = await sql`SELECT type, client_ts FROM events WHERE session_id = ${b.id} AND type IN ('question_guide_shown','question_shown') ORDER BY seq`;
    if (ge.length < 2) await sleep(200);
  }
  check("events: instructions shown, then the question (3 s later)", ge.map((e) => e.type).join() === "question_guide_shown,question_shown" && Number(ge[1].client_ts) - Number(ge[0].client_ts) >= 3000);
  await sleep(3500);
  const thinkBefore = await p.ev(`document.getElementById("p-thinkTime").textContent`);
  await p.reloadTo("p-qguide");
  const [rs] = await sql`SELECT retry_used, resume_count FROM sessions WHERE id = ${b.id}`;
  check("reload on the question screen -> the instructions again, no re-answer chance spent", rs.retry_used === false && rs.resume_count === 0);
  await p.click("p-qguideStart");
  await p.waitFor(p.screen("p-question"), 5000, "question screen after the instructions");
  const thinkAfter = await p.ev(`document.getElementById("p-thinkTime").textContent`);
  check("... and the countdown starts over", parseInt(thinkAfter) > parseInt(thinkBefore), `${thinkBefore} -> ${thinkAfter}`);
  if (args.full) {
    const t0 = Date.now();
    await p.waitFor(`!document.getElementById("p-answering").classList.contains("hidden")`, 60000, "auto-started answer");
    check("auto start when the thinking time ends (about 40 s)", Date.now() - t0 > 30000, `${Math.round((Date.now() - t0) / 1000)} s`);
    await sleep(125000); // past the 2 minute limit: submitted by itself
  } else {
    await p.click("p-startBtn");
    await p.waitFor(`!document.getElementById("p-answering").classList.contains("hidden")`, 10000, "answering panel");
    await sleep(4500); // a few segments and one recognizer restart
    check("transcript is not shown while answering", !(await p.ev(`document.querySelector("#p-question").textContent.includes("제가 이끌어서")`)));
    await p.click("p-doneBtn");
  }
  await p.waitFor(`${p.screen("p-survey")} && document.getElementById("p-surveyProgress").textContent === ${JSON.stringify(COPY.surveyProgress.mid)}`, 30000, "self-rating after the answer");
  await runSurvey(p, "mid", stored, p.screen("p-feedback"), { overrides: { SA_pre: 7 }, values: bValues });
  await p.waitFor(p.screen("p-feedback"), 90000, "feedback");
  check("feedback shown whole", (await p.ev(`document.getElementById("p-feedbackText").textContent`)).length > 20);
  const coachRefs = (id) => p.ev(`({ marks: [...document.querySelectorAll("#${id} .who, #${id} h2")].map((e) => e.textContent), icons: document.querySelectorAll("#participantView img, #participantView svg, #participantView canvas").length })`);
  const tc = await coachRefs("p-feedback");
  check("text feedback screen: the coach is named once (the label above the text), no icon or image", tc.marks.length === 1 && tc.marks[0] === COPY.feedbackTitle && tc.icons === 0, tc.marks.join(" | "));
  const ftB = await waitRow("feedback_timing", b.id);
  check("text: the reveal is recorded (submit-to-reveal, ready time, loading time)", ftB?.modality === "text" && ftB.loading_ms >= 0 && ftB.reveal_after_ms >= ftB.ready_after_ms && ftB.min_wait_ms === 0,
    `ready after ${ftB?.ready_after_ms} ms, revealed after ${ftB?.reveal_after_ms} ms, loading screen ${ftB?.loading_ms} ms`);
  await sleep(500);
  await p.click("p-toSurvey");

  let oeChecked = false;
  await runSurvey(p, "post", stored, p.screen("p-debrief"), {
    overrides: { SA_post: 7 }, values: bValues,
    async onBlock(id, pg) {
      if (id === "post_oe1") {
        const label = await pg.ev(`document.querySelector("#p-surveyItems .qlabel").textContent`);
        check("OE1 wording, scores the same (7 and 7)", label === "자기평가 문항에서 처음과 피드백을 받은 후 모두 7점을 주셨습니다. 점수가 그대로인 이유는 무엇인가요?", label);
        await pg.ev(`(() => { const t = document.querySelector("textarea"); t.value = "  abcd "; t.dispatchEvent(new Event("input", { bubbles: true })); })()`);
        await pg.click("p-surveyNext");
        check("an open-ended answer under 5 characters is refused", (await pg.ev(`document.querySelector("#p-surveyItems .evalitem").classList.contains("missing")`))
          && (await pg.ev(`document.getElementById("p-surveyErr").textContent`)).includes("응답하지 않은 문항") && (await pg.ev(p.screen("p-survey"))));
        oeChecked = true;
      }
    },
  });
  check("OE1 block was reached", oeChecked);
  check("post-survey submitted -> debriefing", await p.ev(p.screen("p-debrief")));
  check("debriefing wording", (await p.ev(`document.querySelector("#p-debrief .text").textContent`)) === COPY.debriefBody
    && COPY.debriefBody.includes("객관적이거나 전문적인 평가가 아닙니다") && !COPY.debriefBody.includes("설계된"));
  await p.click("p-debriefConfirm");
  await p.waitFor(p.screen("p-end"), 10000, "completion screen");
  const [fin] = await sql`SELECT status, valid, debriefed_at FROM sessions WHERE id = ${b.id}`;
  check("session completed + valid (AT1 and AT2 answered correctly in the page) + debriefed", fin.status === "completed" && fin.valid === true && fin.debriefed_at !== null);
  const [oe1] = await sql`SELECT value, shown_text FROM responses WHERE session_id = ${b.id} AND item_id = 'OE1'`;
  check("the wording shown for OE1 is stored with the answer", oe1.shown_text.includes("모두 7점") && oe1.value === "테스트 응답입니다.");
  const [{ n: nResp }] = await sql`SELECT count(*)::int AS n FROM responses WHERE session_id = ${b.id}`;
  check("one response per item (52), each with its display order", nResp === 52 && (await sql`SELECT count(*)::int AS n FROM responses WHERE session_id = ${b.id} AND display_order IS NULL`)[0].n === 0);
  const [ans] = await sql`SELECT transcript, client_transcript, answer_truncated FROM answers WHERE session_id = ${b.id} AND status = 'done'`;
  const segs = await sql`SELECT text FROM answer_segments WHERE session_id = ${b.id} ORDER BY attempt, seq`;
  check("answer confirmed from the saved segments (same as the browser's own text)", ans.transcript === segs.map((s) => s.text).join(" ") && ans.client_transcript === ans.transcript && ans.answer_truncated === false, `${segs.length} segments`);
  const evs = await sql`SELECT type, data FROM events WHERE session_id = ${b.id} ORDER BY seq`;
  const last = (t) => evs.filter((e) => e.type === t).at(-1)?.data;
  check("events: auto_started / auto_submitted recorded, recognizer restart logged", typeof last("answer_start")?.auto_started === "boolean" && typeof last("answer_end")?.auto_submitted === "boolean"
    && (args.full ? last("answer_start").auto_started === true && last("answer_end").auto_submitted === true : evs.some((e) => e.type === "stt_restart")));
  if (args.audio) check("audio recorded in chunks and uploaded", (await sql`SELECT count(*)::int AS n FROM audio_chunks WHERE session_id = ${b.id}`)[0].n >= 1);
  p.close();

  // ---------- C: scores differ (4 and 9): the other OE1 wording; opened at the post-survey ----------
  const c = await H.started("UI-C");
  await c.T.survey("mid", "mid_sa", { SA_pre: 4 });
  await c.T.event("next_clicked", "q2");
  await c.T.release();
  const pc = await newPage();
  await pc.send("Page.addScriptToEvaluateOnNewDocument", { source: STUB });
  await pc.send("Page.navigate", { url: `http://localhost:${PORT}/s/${c.s.token}` });
  await pc.waitFor(pc.screen("p-survey"), 20000, "post-survey after a resume");
  const storedC = await storedOrder(c.s.id);
  const cValues = { SA_pre: 4 };
  await runSurvey(pc, "post", storedC, pc.screen("p-debrief"), {
    overrides: { SA_post: 9 }, values: cValues,
    async onBlock(id, pg) {
      if (id === "post_oe1") {
        const label = await pg.ev(`document.querySelector("#p-surveyItems .qlabel").textContent`);
        check("OE1 wording after a reload, scores differ (4 and 9)", label === "자기평가 문항에서 처음에는 4점, 피드백을 받은 후에는 9점을 주셨습니다. 점수가 달라진 이유는 무엇인가요?", label);
        await pg.reloadTo("p-survey"); // the page gets both scores back from the server
        check("... and still after a reload on that block", (await pg.ev(`document.querySelector("#p-surveyItems .qlabel").textContent`)) === label);
      }
    },
  });
  const [oeC] = await sql`SELECT shown_text FROM responses WHERE session_id = ${c.s.id} AND item_id = 'OE1'`;
  check("stored wording matches what the page showed", oeC.shown_text.includes("처음에는 4점, 피드백을 받은 후에는 9점"));
  pc.close();

  // ---------- E: FEEDBACK_MIN_WAIT_MS counts from the answer, not from the loading screen (value set for this test only) ----------
  {
    const MIN = 20000;
    TEST_OVERRIDES.feedback_min_wait_ms = MIN;
    try {
      const e = await textSessionAtScenario("UI-E");
      const pe = await openAndAnswer(e.s);
      await runSurvey(pe, "mid", await storedOrder(e.s.id), pe.screen("p-loading"), { overrides: { SA_pre: 5 } });
      check("min wait: the feedback is ready long before, and the page still holds it on the loading screen", await pe.ev(pe.screen("p-loading")));
      await pe.waitFor(pe.screen("p-feedback"), 60000, "feedback after the minimum wait");
      const ft = await waitRow("feedback_timing", e.s.id);
      check("min wait: revealed at the answer + FEEDBACK_MIN_WAIT_MS (not earlier, and soon after)", ft && ft.reveal_after_ms >= MIN && ft.reveal_after_ms <= MIN + 4500, `revealed after ${ft?.reveal_after_ms} ms (minimum ${MIN})`);
      check("... the delay is the wait, not the generation: ready much earlier; loading time and min wait recorded", ft.ready_after_ms < MIN - 5000 && ft.min_wait_ms === MIN && ft.loading_ms > 8000,
        `ready after ${ft?.ready_after_ms} ms, loading screen ${ft?.loading_ms} ms`);
      pe.close();
    } finally { delete TEST_OVERRIDES.feedback_min_wait_ms; }
  }

  // ---------- F: the loading screen gives up after LOADING_TIMEOUT_MS (values set for this test only) ----------
  {
    TEST_OVERRIDES.feedback_min_wait_ms = 40000; // keeps the loading screen up
    TEST_OVERRIDES.loading_timeout_ms = 4000;
    try {
      const f = await textSessionAtScenario("UI-F");
      const pf = await openAndAnswer(f.s);
      await runSurvey(pf, "mid", await storedOrder(f.s.id), pf.screen("p-loading"), { overrides: { SA_pre: 5 } });
      const t0 = Date.now();
      await pf.waitFor(pf.screen("p-blocked"), 15000, "the time-out message");
      const waited = Date.now() - t0;
      const msg = await pf.ev(`({ title: document.getElementById("p-blockedTitle").textContent, text: document.getElementById("p-blockedText").textContent })`);
      check("loading time-out: the page says to ask the researcher", msg.title === COPY.blocked.locked_error[0] && msg.text === COPY.blocked.locked_error[1] && msg.text.includes("연구자에게 문의"), msg.text);
      check("... after about LOADING_TIMEOUT_MS on the loading screen (4 s here)", waited <= 5500, `${waited} ms more after the loading screen came up`);
      let ct = [];
      for (let i = 0; i < 25 && !ct.length; i++) { ct = await sql`SELECT data FROM events WHERE session_id = ${f.s.id} AND type = 'client_timeout'`; if (!ct.length) await sleep(200); }
      check("... client_timeout is logged with the time spent loading", ct.length === 1 && ct[0].data.loading_ms >= 3900 && ct[0].data.loading_ms <= 6000, ct[0] && `${ct[0].data.loading_ms} ms`);
      check("... the session itself is not locked (the server keeps its own rules)", ["consented", "in_progress"].includes((await sql`SELECT status FROM sessions WHERE id = ${f.s.id}`)[0].status));
      await sleep(2500);
      check("... and nothing is revealed afterwards (polling stopped)", !(await pf.ev(pf.screen("p-feedback"))) && (await pf.ev(pf.screen("p-blocked"))));
      pf.close();
    } finally { delete TEST_OVERRIDES.feedback_min_wait_ms; delete TEST_OVERRIDES.loading_timeout_ms; }
  }

  // ---------- D: voice condition ----------
  if (!haveBlob || !process.env.ELEVENLABS_API_KEY) {
    console.log("SKIP  voice condition (needs ELEVENLABS_API_KEY and Blob credentials)");
  } else {
    // a real session consented through the API and set to voice, then continued in the browser
    const d = await H.started("UI-D", { modality: "voice" });
    for (const t of ["device_test_done", "survey_pre_submitted", "notice_confirmed", "scenario_shown"]) await d.T.event(t);
    await d.T.release();
    const pd = await openAndAnswer(d.s, [AUDIO_STUB]);
    await runSurvey(pd, "mid", await storedOrder(d.s.id), `${pd.screen("p-loading")} || ${pd.screen("p-voice")}`, { overrides: { SA_pre: 5 } });
    await pd.waitFor(pd.screen("p-voice"), 120000, "voice screen (Stage 1 + 2 + TTS)");

    // the neutral screen: no text anywhere
    await pd.waitFor(`!document.getElementById("p-voicePlay").classList.contains("hidden")`, 15000, "[피드백 듣기] after the blocked autoplay");
    const [ans] = await sql`SELECT feedback FROM answers WHERE session_id = ${d.s.id} AND status = 'done'`;
    const chunks = (ans.feedback.match(/[가-힣 ]{10,}/g) || []).map((c) => c.trim()).filter((c) => c.length >= 10).slice(0, 4);
    const dom = await pd.ev(`({ html: document.documentElement.outerHTML, text: document.body.innerText, media: document.querySelectorAll("audio, video").length,
      title: document.querySelector("#p-voice h2").textContent, replay: document.getElementById("p-voiceReplay").disabled, next: document.getElementById("p-voiceNext").disabled })`);
    check("voice: only the neutral line is shown, no <audio> element or controls in the page", dom.title === COPY.voiceTitle && dom.media === 0);
    const vc = await pd.ev(`({ marks: [...document.querySelectorAll("#p-voice .who, #p-voice h2")].map((e) => e.textContent), icons: document.querySelectorAll("#participantView img, #participantView svg, #participantView canvas").length })`);
    if (COPY.voiceTitle !== COPY.feedbackTitle) console.log(`NOTE  the voice screen's coach line ("${COPY.voiceTitle}") differs from the text screen's label ("${COPY.feedbackTitle}")`);
    check("voice feedback screen: the coach is named once (the line), no icon or image — as many references as the text screen", vc.marks.length === 1 && vc.marks[0] === COPY.voiceTitle && vc.icons === 0 && vc.marks.length === tc.marks.length);
    check("voice: the feedback text is nowhere in the DOM or the visible text", chunks.length >= 2 && chunks.every((c) => !dom.html.includes(c) && !dom.text.includes(c)), `${chunks.length} passages checked`);
    check("voice: autoplay refused -> [피드백 듣기]; replay and next are still disabled", dom.replay && dom.next);
    let evs = [];
    for (let i = 0; i < 25 && !evs.some((e) => e.type === "audio_play_blocked"); i++) { evs = await sql`SELECT type, data FROM events WHERE session_id = ${d.s.id}`; if (!evs.some((e) => e.type === "audio_play_blocked")) await sleep(200); }
    check("voice: audio_play_blocked is logged", evs.some((e) => e.type === "audio_play_blocked"));

    // play: no controls, normal speed
    await pd.click("p-voicePlay");
    await pd.waitFor(`window.__audios[0] && window.__audios[0].currentTime > 0.6 && !window.__audios[0].paused`, 15000, "playing");
    const media = await pd.ev(`({ controls: window.__audios[0].controls, rate: window.__audios[0].playbackRate, duration: window.__audios[0].duration,
      wave: !document.getElementById("p-voiceWave").classList.contains("hidden"), replay: document.getElementById("p-voiceReplay").disabled, next: document.getElementById("p-voiceNext").disabled })`);
    const [fa] = await sql`SELECT audio_seconds FROM feedback_audio WHERE session_id = ${d.s.id}`;
    check("voice: plays without controls at normal speed, shows the play indicator; replay and next wait for the end", !media.controls && media.rate === 1 && media.wave && media.replay && media.next);
    check("voice: the length the page plays matches the recorded audio_seconds", Math.abs(media.duration - Number(fa.audio_seconds)) < 0.35, `${media.duration.toFixed(2)} s vs ${fa.audio_seconds}`);

    // leave during the playback: the stored audio again from the start, nothing generated
    await sleep(5000);
    const rowsOf = async () => (await sql`SELECT (SELECT count(*)::int FROM answers WHERE session_id = ${d.s.id}) + (SELECT count(*)::int FROM feedback_audio WHERE session_id = ${d.s.id}) AS n`)[0].n;
    const rows0 = await rowsOf(), tts0 = ttsRequests;
    await pd.reloadTo("p-voice");
    await pd.waitFor(`!document.getElementById("p-voicePlay").classList.contains("hidden")`, 20000, "[피드백 듣기] after the reload");
    await pd.click("p-voicePlay");
    await pd.waitFor(`window.__audios[0] && window.__audios[0].currentTime > 0.5 && !window.__audios[0].paused`, 15000, "playing again");
    check("voice: reload during the playback -> the same stored audio, from the beginning, nothing generated again",
      (await rowsOf()) === rows0 && ttsRequests === tts0 && (await pd.ev(`window.__audios[0].currentTime`)) < 4);

    // to the end: replay and next unlock
    await pd.waitFor(`!document.getElementById("p-voiceNext").disabled`, 100000, "the end of the playback");
    check("voice: after the first complete listening [다시 듣기] and [설문으로 넘어가기] are enabled", !(await pd.ev(`document.getElementById("p-voiceReplay").disabled`)));
    await pd.click("p-voiceReplay");
    await sleep(900);
    check("voice: [다시 듣기] plays it again from the beginning", await pd.ev(`window.__audios[0].currentTime < 2 && !window.__audios[0].paused`));
    await pd.click("p-voiceNext");
    await pd.waitFor(`${pd.screen("p-survey")} && document.getElementById("p-surveyProgress").textContent.startsWith("사후")`, 15000, "post-survey");
    let all = [];
    for (let i = 0; i < 25; i++) { all = await sql`SELECT type, data FROM events WHERE session_id = ${d.s.id} ORDER BY seq`; if (all.some((e) => e.type === "next_clicked")) break; await sleep(200); }
    const of = (t) => all.filter((e) => e.type === t);
    check("voice events: audio_started (once per page load), progress, audio_ended with the hidden time, replay count, next with replays",
      of("audio_started").length >= 2 && of("audio_progress").length >= 2 && of("audio_ended").length >= 1 && typeof of("audio_ended")[0].data.hidden_ms === "number"
      && of("audio_replay")[0]?.data.count === 1 && of("next_clicked").at(-1)?.data.replays === 1, `started ${of("audio_started").length}, progress ${of("audio_progress").length}`);
    const listenings = []; // progress positions of each listening (a new page load starts a new one, at audio_started)
    for (const e of all) { if (e.type === "audio_started") listenings.push([]); else if (e.type === "audio_progress" && listenings.length) listenings.at(-1).push(e.data.position_s); }
    check("voice: progress shows how far each listening got (increasing, the first one cut off by the reload)",
      listenings.length >= 2 && listenings.every((l) => l.every((x, i) => i === 0 || x >= l[i - 1])) && listenings[0].length >= 1 && listenings[0].at(-1) < 20,
      listenings.map((l) => `${l.length} points, up to ${l.at(-1)} s`).join(" | "));
    check("voice: no feedback_shown (audio_started is the voice condition's feedback_shown)", of("feedback_shown").length === 0);
    const ftD = await waitRow("feedback_timing", d.s.id);
    check("voice: the reveal (audio_started) is recorded the same way as the text one", ftD?.modality === "voice" && ftD.loading_ms >= 0 && ftD.reveal_after_ms >= ftD.ready_after_ms && ftD.min_wait_ms === 0,
      `ready after ${ftD?.ready_after_ms} ms, revealed after ${ftD?.reveal_after_ms} ms`);
    pd.close();
  }
} catch (e) {
  if (e.message !== "admin-only") { console.log(`FAIL  ${e.message}`); check("test run completed without an error", false, e.message); }
} finally {
  if (consoleIssues.length) { console.log("\nbrowser console issues:"); for (const m of [...new Set(consoleIssues)].slice(0, 15)) console.log("  - " + m); }
  chrome.kill();
  server.close();
  if (args.audio) {
    try {
      const { planAudio, executePlan } = await import("../lib/purge.js");
      const pa = (await executePlan(await planAudio({ only: H.created }))).done; // only what this test made
      console.log(`purged test audio: ${pa.map((x) => `${x.participant_id}=${x.chunks}`).join(" ") || "none"}`);
    } catch (e) { console.log("audio cleanup failed:", e.message); }
  }
  await sleep(1500);
  await H.cleanup();
  fs.rmSync(profile, { recursive: true, force: true });
}
H.finish();

// Browser test: serves the app locally (static files + the /api/session handler) against a scratch database
// branch and drives it with headless Chrome over the DevTools protocol. A fake microphone stands in for the
// mic and SpeechRecognition is stubbed; the feedback is a real LLM call. Checks the participant flow and that
// every survey block renders as defined in survey_items.json (item order, groups, anchors, bold, inputs).
//   npm run test:ui -- --host <neon endpoint id of the dev branch> [--full] [--audio]
//   --full   also lets the 40 s thinking time run out (auto start) and the 2 min answer limit (auto submit)
//   --audio  upload the recorded chunks (needs Blob credentials in the environment); they are purged afterwards
// Chrome: CHROME_PATH, default the macOS install.

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({ options: { host: { type: "string" }, full: { type: "boolean", default: false }, audio: { type: "boolean", default: false } } });
process.env.AUDIO_UPLOAD_ENABLED = args.audio ? "true" : "false"; // read by lib/config.js at import time

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { requireEndpoint } = await import("./cli.js");
requireEndpoint(args.host);
const { createHarness, sleep } = await import("./test-lib.js");
const { default: handler } = await import("../api/session/[action].js");
const { SURVEY, PHASES } = await import("../lib/survey.js");
const { conditionalText, rangeOf, anchorsOf, optionsOf, otherLabelOf } = await import("../src/survey-shared.js");
const { COPY } = await import("../src/copy.js");
const { QUESTIONS } = await import("../src/questions.js");
const { OE_MIN_CHARS } = await import("../lib/config.js");

const H = createHarness();
const { sql, check } = H;
const PORT = 3123, DEBUG = 9333;
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "study1-chrome-"));

// ---------- local server: static files + /api/session/* + /s/* -> index.html ----------
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".css": "text/css" };
const server = http.createServer(async (rq, rs) => {
  const url = new URL(rq.url, "http://localhost");
  if (url.pathname.startsWith("/api/session/")) {
    const chunks = [];
    for await (const c of rq) chunks.push(c);
    const raw = Buffer.concat(chunks);
    const json = (rq.headers["content-type"] || "").includes("application/json");
    const req = {
      method: rq.method, headers: rq.headers, query: { action: url.pathname.split("/").pop(), ...Object.fromEntries(url.searchParams) },
      body: json ? JSON.parse(raw.toString() || "{}") : undefined, async *[Symbol.asyncIterator]() { yield raw; },
    };
    const res = { code: 200, status(c) { this.code = c; return this; }, json(d) { rs.writeHead(this.code, { "content-type": "application/json" }); rs.end(JSON.stringify(d)); }, setHeader() {} };
    try { await handler(req, res); } catch (e) { rs.writeHead(500); rs.end(String(e)); }
    return;
  }
  const file = url.pathname.startsWith("/s/") || url.pathname === "/" ? "/index.html" : url.pathname;
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

const storedOrder = async (id) => (await sql`SELECT survey_order FROM sessions WHERE id = ${id}`)[0].survey_order;

async function toQuestion(p, token) {
  await p.send("Page.addScriptToEvaluateOnNewDocument", { source: STUB });
  await p.send("Page.navigate", { url: `http://localhost:${PORT}/s/${token}` });
  await p.waitFor(p.screen("p-consent"), 20000, "consent screen");
  check("tab title is 면접 연습 and no 'AI 면접 코치' header on the page", (await p.ev(`document.title`)) === "면접 연습" && !(await p.ev(`document.body.innerText.includes("AI 면접 코치")`)));
  await p.ev(`document.querySelector('input[name="p-withdrawData"][value="use"]').click(); document.querySelector('input[name="p-notify"][value="yes"]').click(); document.getElementById("p-consentAgree").click();`);
  await p.click("p-consentBtn");
  await p.waitFor(p.screen("p-device"), 20000, "device test");
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
  const micText = await toQuestion(p, b.token);
  check("device test: recognized sentence shown", micText.includes("하늘이 맑고"));
  const tones = await sql`SELECT type, data FROM events WHERE session_id = ${b.id} AND type LIKE 'speaker_tone_%' ORDER BY seq`;
  check("speaker starts / stops and play durations logged", tones.map((e) => e.type).join() === "speaker_tone_start,speaker_tone_stop,speaker_tone_start,speaker_tone_stop"
    && tones[1].data.duration_ms >= 1400 && tones[3].data.duration_ms >= 400, tones.filter((e) => e.type.endsWith("stop")).map((e) => e.data.duration_ms).join("/") + " ms");
  await p.waitFor(p.screen("p-notice"), 8000, "notice screen");
  const notice = await p.ev(`({ title: document.querySelector("#p-notice h2").textContent, items: [...document.querySelectorAll("#p-notice li")].map((l) => l.textContent), btn: document.getElementById("p-noticeConfirm").textContent })`);
  check("notice before the survey: wording and [확인했습니다]", notice.title === COPY.noticeTitle && notice.items.join("|") === COPY.noticeItems.join("|") && notice.btn === COPY.noticeConfirm);
  await p.reloadTo("p-notice");
  check("reload on the notice -> the notice again", true);
  await p.click("p-noticeConfirm");
  const stored = await storedOrder(b.id);
  const bValues = {};
  let smiOrderSeen;
  await runSurvey(p, "pre", stored, p.screen("p-scenario"), {
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
  check("pre-survey done -> scenario", await p.ev(p.screen("p-scenario")));
  check("notice confirmation time recorded", (await sql`SELECT count(*)::int AS n FROM events WHERE session_id = ${b.id} AND type = 'notice_confirmed'`)[0].n === 1);
  const sc = await p.ev(`({ title: document.querySelector("#p-scenario h2").textContent, intro: document.querySelector("#p-scenario .muted").textContent, body: document.querySelector("#p-scenario .text").textContent })`);
  check("scenario: title 상황 안내, instruction under it, body", sc.title === "상황 안내" && sc.intro === "아래 상황을 읽고, 그 상황에 있다고 생각하며 진행해 주세요." && sc.body === COPY.scenarioBody);
  await p.click("p-scenarioNext");

  // answer instructions: the countdown must not run here
  await p.waitFor(p.screen("p-qguide"), 5000, "answer instructions");
  const guide = await p.ev(`({ title: document.querySelector("#p-qguide h2").textContent, items: [...document.querySelectorAll("#p-qguide li")].map((l) => l.textContent), btn: document.getElementById("p-qguideStart").textContent })`);
  check("answer instructions: wording and [시작하기]", guide.title === "면접 질문 안내" && guide.items.join("|") === COPY.qguideItems.join("|") && guide.btn === "시작하기");
  check("the question is not on screen yet", !(await p.ev(p.screen("p-question"))));
  await sleep(3500); // time spent reading the instructions must not eat into the thinking time
  await p.click("p-qguideStart");
  await p.waitFor(p.screen("p-question"), 5000, "question screen");
  const think0 = await p.ev(`document.getElementById("p-thinkTime").textContent`);
  check("the countdown starts when the question appears (still 40 after 3.5 s on the instructions)", /^(40|39)초$/.test(think0), think0);
  const qs = await p.ev(`({ text: document.getElementById("p-questionText").textContent, hint: document.getElementById("p-questionHint").textContent, visible: document.getElementById("p-question").innerText })`);
  check("question screen: the question and its screen-only hint", qs.text === QUESTIONS.q2 && qs.hint === "학교, 일, 동아리, 개인 활동 등 어떤 경험이든 괜찮습니다.");
  check("... countdown and [답변 시작], without the long instructions or any header",
    qs.visible.includes(COPY.thinkLabel) && qs.visible.includes(COPY.answerStart) && !qs.visible.includes("주어집니다") && !qs.visible.includes("최대 2분") && !qs.visible.includes("AI 면접 코치"));
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
} catch (e) {
  console.log(`FAIL  ${e.message}`);
  check("test run completed without an error", false, e.message);
} finally {
  if (consoleIssues.length) { console.log("\nbrowser console issues:"); for (const m of [...new Set(consoleIssues)].slice(0, 15)) console.log("  - " + m); }
  chrome.kill();
  server.close();
  if (args.audio) {
    try {
      await sql`UPDATE sessions SET audio_verified_at = now() WHERE id = ANY(${H.created}::uuid[])`;
      const { purgeVerifiedAudio } = await import("../lib/purge.js");
      const pa = await purgeVerifiedAudio();
      console.log(`purged test audio: ${pa.map((x) => `${x.participant_id}=${x.chunks}`).join(" ") || "none"}`);
    } catch (e) { console.log("audio cleanup failed:", e.message); }
  }
  await sleep(1500);
  await H.cleanup();
  fs.rmSync(profile, { recursive: true, force: true });
}
H.finish();

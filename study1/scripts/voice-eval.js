// Voice feedback evaluation (Phase 4.5 / 4.6). Does NOT touch the database.
//  1. Measures how long the feedback takes to get ready: corpus answers x 3 stances, run one after another like a
//     single participant would. text = Stage 1 + Stage 2; voice = Stage 1 + Stage 2 + text normalization + TTS +
//     storing the mp3 (private Blob, deleted again). The participant's self-rating time is not part of it.
//  2. Saves the audio of those runs (main model) with the text that was spoken, plus the same few sentences for
//     every candidate model, and an index.html to listen through them. The researcher picks the model there.
//   npm run voice-eval [-- --out <dir>] [--models a,b,c] [--main <model id>]
// Needs ELEVENLABS_API_KEY and OPENAI_API_KEY; the Blob timing needs Blob credentials (otherwise it is skipped).
// Credits: every synthesized character counts; the total is printed at the end.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { assess, generateFeedback } from "../lib/llm.js";
import { TTS, blobPrefix } from "../lib/config.js";
import { normalizeForTts, synthesize, mp3DurationSeconds } from "../lib/tts.js";
import { CORPUS } from "../src/corpus.js";
import { QUESTIONS, CONDITIONS } from "../src/questions.js";

const { values: args } = parseArgs({ options: { out: { type: "string" }, models: { type: "string" }, main: { type: "string" } } });
const MODELS = (args.models || "eleven_multilingual_v2,eleven_v4,eleven_v4_turbo,eleven_flash_v2_5").split(",");
const MAIN = args.main || TTS.modelId;
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15).replace("T", "-");
const OUT = args.out || path.join(os.homedir(), "dev", "study1-voice-samples", stamp);
if (!process.env.ELEVENLABS_API_KEY) { console.error("ELEVENLABS_API_KEY is not set"); process.exit(1); }
fs.mkdirSync(path.join(OUT, "main"), { recursive: true });

const haveBlob = !!(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
const blob = haveBlob ? await import("@vercel/blob") : null;
const ms = (t0) => Math.round(performance.now() - t0);
let spokenChars = 0; // characters sent to the TTS (credits)

// ---------- statistics ----------
const sorted = (xs) => [...xs].sort((a, b) => a - b);
const median = (xs) => { const s = sorted(xs); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const p90 = (xs) => sorted(xs)[Math.ceil(0.9 * xs.length) - 1]; // nearest rank
const stat = (xs) => (xs.length ? { n: xs.length, median: median(xs), p90: p90(xs), max: Math.max(...xs), min: Math.min(...xs) } : null);
const f1 = (x) => (x == null ? "–" : (Math.round(x * 10) / 10).toString());

// ---------- 1. measurement ----------
const answers = CORPUS.filter((c) => c.questionId === "q2");
const runs = [];
console.log(`main model ${MAIN} | ${answers.length} answers x ${CONDITIONS.length} stances | blob timing ${haveBlob ? "on" : "off (no credentials)"}`);
for (const e of answers) {
  for (const stance of CONDITIONS) {
    const r = { answer: e.id, stance, ok: false };
    try {
      let t = performance.now();
      const a = await assess(QUESTIONS.q2, e.transcript); r.s1_ms = ms(t);
      t = performance.now();
      const f = await generateFeedback(a.context, stance); r.s2_ms = ms(t);
      r.text = f.feedback; r.strong = a.strong; r.weak = a.weak;
      const n = normalizeForTts(f.feedback);
      r.spoken = n.text; r.rules = n.rules; r.chars = [...n.text].length;
      t = performance.now();
      const v = await synthesize(n.text, { modelId: MAIN, retries: 0 }); // one attempt: its own latency
      spokenChars += r.chars;
      r.tts_ms = ms(t); r.audio_seconds = mp3DurationSeconds(v.audio); r.file = `main/${e.id}_${stance}.mp3`;
      fs.writeFileSync(path.join(OUT, r.file), v.audio);
      if (blob) {
        const key = `${blobPrefix()}-eval/${stamp}/${e.id}_${stance}.mp3`;
        t = performance.now();
        await blob.put(key, v.audio, { access: "private", contentType: "audio/mpeg", allowOverwrite: true }); r.put_ms = ms(t);
        await blob.del(key);
      }
      r.ok = true;
      process.stdout.write(`  ${e.id}/${stance}: S1 ${r.s1_ms} + S2 ${r.s2_ms} + TTS ${r.tts_ms} ms, ${r.chars} chars, ${r.audio_seconds.toFixed(1)} s\n`);
    } catch (err) {
      r.error = String(err?.message || err);
      console.log(`  ${e.id}/${stance}: FAILED ${r.error}`);
    }
    runs.push(r);
  }
}
const good = runs.filter((r) => r.ok);
const prepText = (r) => r.s1_ms + r.s2_ms;
const prepVoice = (r) => r.s1_ms + r.s2_ms + r.tts_ms + (r.put_ms ?? 0);
const summary = {
  main_model: MAIN, runs: runs.length, ok: good.length,
  text: stat(good.map(prepText)), voice: stat(good.map(prepVoice)),
  stage1: stat(good.map((r) => r.s1_ms)), stage2: stat(good.map((r) => r.s2_ms)), tts: stat(good.map((r) => r.tts_ms)),
  put: haveBlob ? stat(good.map((r) => r.put_ms)) : null,
  by_stance: Object.fromEntries(CONDITIONS.map((s) => [s, {
    text: stat(good.filter((r) => r.stance === s).map(prepText)), voice: stat(good.filter((r) => r.stance === s).map(prepVoice)),
    chars: stat(good.filter((r) => r.stance === s).map((r) => r.chars)),
  }])),
  chars: stat(good.map((r) => r.chars)), audio_seconds: stat(good.map((r) => r.audio_seconds)),
  seconds_per_char: stat(good.map((r) => r.audio_seconds / r.chars)),
  total_seconds_per_char: good.reduce((n, r) => n + r.audio_seconds, 0) / good.reduce((n, r) => n + r.chars, 0),
};

// ---------- 2. same sentences, every candidate model ----------
const byLen = [...good].sort((a, b) => a.chars - b.chars);
const pick = [
  ["digits", good.find((r) => /\d/.test(r.spoken))],
  ["quotation", good.find((r) => /["“”]/.test(r.spoken))],
  ["typical length", byLen[byLen.length >> 1]],
].filter(([, r]) => r);
const used = new Set();
const samples = [];
for (const [label, r] of pick) {
  if (used.has(r)) continue;
  used.add(r);
  samples.push({ label, source: `${r.answer}/${r.stance}`, text: r.spoken, reuse: r.file, mainBytes: fs.readFileSync(path.join(OUT, r.file)), mainRun: r });
}
samples.push(
  { label: "probe: numbers", source: "constructed", text: "팀원 5명과 3개월 동안 프로젝트를 진행해서 매출이 20퍼센트 늘었다는 점이 인상적이에요." },
  { label: "probe: English words", source: "constructed", text: "A/B 테스트와 KPI 분석을 직접 주도하셨다는 점이 좋아요. STAR 방식으로 결과까지 말해 보세요." },
);
console.log(`\ncomparing ${MODELS.length} models on ${samples.length} sentences`);
const comparison = [];
for (const [i, smp] of samples.entries()) {
  const row = { n: i + 1, ...smp, mainBytes: undefined, models: {} };
  for (const m of MODELS) {
    const dir = path.join(OUT, "models", m);
    fs.mkdirSync(dir, { recursive: true });
    const file = `models/${m}/${String(i + 1).padStart(2, "0")}.mp3`;
    try {
      let bytes, latency;
      if (smp.reuse && m === MAIN) { bytes = smp.mainBytes; latency = smp.mainRun.tts_ms; } // already synthesized above
      else {
        const t = performance.now();
        const v = await synthesize(smp.text, { modelId: m, retries: 0 });
        latency = ms(t); bytes = v.audio; spokenChars += [...smp.text].length;
      }
      fs.writeFileSync(path.join(OUT, file), bytes);
      row.models[m] = { file, latency_ms: latency, seconds: mp3DurationSeconds(bytes), chars: [...smp.text].length };
    } catch (err) {
      row.models[m] = { error: String(err?.message || err) };
      console.log(`  ${m} #${i + 1}: FAILED ${row.models[m].error}`);
    }
  }
  comparison.push(row);
  process.stdout.write(`  #${i + 1} ${smp.label}\n`);
}
const perModel = Object.fromEntries(MODELS.map((m) => {
  const ok = comparison.map((r) => r.models[m]).filter((x) => x && !x.error);
  return [m, { n: ok.length, latency: stat(ok.map((x) => x.latency_ms)), seconds_per_char: stat(ok.map((x) => x.seconds / x.chars)) }];
}));

// ---------- 3. output ----------
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ stamp, tts: TTS, main: MAIN, models: MODELS, summary, runs, comparison: comparison.map((r) => ({ ...r })), perModel, spokenChars }, null, 2));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const player = (f) => (f ? `<audio controls preload="none" src="${esc(f)}"></audio>` : "—");
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><title>Voice samples ${esc(stamp)}</title>
<style>body{font:15px/1.6 system-ui,sans-serif;max-width:1100px;margin:24px auto;padding:0 16px;color:#111}table{border-collapse:collapse;width:100%;margin:12px 0 32px}
th,td{border:1px solid #ddd;padding:8px 10px;vertical-align:top;text-align:left}th{background:#f5f6f8}.m{color:#555;font-size:13px}audio{width:240px;display:block;margin-top:6px}.txt{max-width:420px}code{background:#f1f1f1;padding:1px 4px;border-radius:4px}</style>
<h1>Voice feedback samples</h1>
<p>Voice <b>${esc(TTS.voiceName)}</b> (<code>${esc(TTS.voiceId)}</code>), settings <code>${esc(JSON.stringify(TTS.voiceSettings))}</code>, format <code>${esc(TTS.outputFormat)}</code>.
Main model for section 1: <b>${esc(MAIN)}</b> (provisional until you choose). Listen for: pronunciation (numbers, English words), speed, naturalness.</p>
<h2>2. Same sentences, every candidate model</h2>
<table><tr><th>#</th><th>Sentence</th>${MODELS.map((m) => `<th>${esc(m)}</th>`).join("")}</tr>
${comparison.map((r) => `<tr><td>${r.n}</td><td class="txt"><div class="m">${esc(r.label)} · ${esc(r.source)}</div>${esc(r.text)}</td>${MODELS.map((m) => {
  const x = r.models[m];
  return `<td>${x?.error ? `<span class="m">failed: ${esc(x.error)}</span>` : `${player(x.file)}<div class="m">${x.latency_ms} ms · ${x.seconds.toFixed(1)} s · ${(x.seconds / x.chars).toFixed(3)} s/char</div>`}</td>`;
}).join("")}</tr>`).join("\n")}</table>
<h2>1. The 18 corpus feedbacks (${esc(MAIN)})</h2>
<table><tr><th>Answer / stance</th><th>Text shown (text condition)</th><th>Text spoken</th><th>Audio</th></tr>
${good.map((r) => `<tr><td>${esc(r.answer)}<br>${esc(r.stance)}</td><td class="txt">${esc(r.text)}</td><td class="txt">${r.rules.length ? esc(r.spoken) + `<div class="m">rules: ${esc(JSON.stringify(r.rules))}</div>` : '<span class="m">identical (no rule applied)</span>'}</td><td>${player(r.file)}<div class="m">${r.chars} chars · ${r.audio_seconds.toFixed(1)} s · TTS ${r.tts_ms} ms</div></td></tr>`).join("\n")}</table></html>`;
fs.writeFileSync(path.join(OUT, "index.html"), html);

const row = (name, s) => (s ? `${name.padEnd(30)} median ${f1(s.median / 1000)} s | p90 ${f1(s.p90 / 1000)} s | max ${f1(s.max / 1000)} s | min ${f1(s.min / 1000)} s (n=${s.n})` : `${name.padEnd(30)} –`);
const report = [
  `# Voice evaluation ${stamp}`, "",
  `Main model ${MAIN}; ${good.length}/${runs.length} runs ok; p90 = nearest rank.`, "",
  "## Time until the feedback is ready (self-rating time excluded)", "",
  row("text  (Stage 1+2)", summary.text), row("voice (Stage 1+2+TTS+store)", summary.voice), "",
  row("  Stage 1", summary.stage1), row("  Stage 2", summary.stage2), row("  TTS (one attempt)", summary.tts), row("  store mp3 (Blob)", summary.put), "",
  ...CONDITIONS.flatMap((s) => [row(`text  / ${s}`, summary.by_stance[s].text), row(`voice / ${s}`, summary.by_stance[s].voice)]), "",
  "## Length", "",
  `feedback characters: median ${f1(summary.chars?.median)}, min ${summary.chars?.min}, max ${summary.chars?.max}`,
  `audio seconds: median ${f1(summary.audio_seconds?.median)}, min ${f1(summary.audio_seconds?.min)}, max ${f1(summary.audio_seconds?.max)}`,
  `seconds per character: pooled ${summary.total_seconds_per_char.toFixed(4)}, median ${summary.seconds_per_char?.median.toFixed(4)}, min ${summary.seconds_per_char?.min.toFixed(4)}, max ${summary.seconds_per_char?.max.toFixed(4)}`, "",
  "## Candidate models (same sentences)", "",
  ...MODELS.map((m) => `${m.padEnd(26)} TTS latency median ${f1(perModel[m].latency?.median)} ms, max ${f1(perModel[m].latency?.max)} ms | ${perModel[m].seconds_per_char ? perModel[m].seconds_per_char.median.toFixed(4) : "–"} s/char (n=${perModel[m].n})`), "",
  `Characters sent to the TTS in this run: ${spokenChars}`,
].join("\n");
fs.writeFileSync(path.join(OUT, "report.md"), report + "\n");
console.log("\n" + report + `\n\noutput: ${OUT}\nopen: ${path.join(OUT, "index.html")}`);

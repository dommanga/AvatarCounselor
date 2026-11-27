// Shared helpers of the API tests (test-flow, test-survey): issue sessions on a scratch database branch,
// drive api/session/[action].js the way a browser tab does, answer survey blocks, and clean up.

import crypto from "crypto";
import { db } from "../lib/db.js";
import { newParticipantToken } from "../lib/auth.js";
import { OTHER_LABEL, optionsOf, otherLabelOf, rangeOf } from "../src/survey-shared.js";
import handler from "../api/session/[action].js";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createHarness() {
  const sql = db();
  const created = [];
  let passed = 0, failed = 0;

  function check(name, ok, info = "") {
    if (ok) passed++; else failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? `  (${info})` : ""}`);
  }

  // test sessions come with a preset stance and modality (no slot); real ones are assigned at consent
  async function issue(pid, { expiresInMs = 86400_000, test = false, stance = "direct", modality = "text" } = {}) {
    const id = crypto.randomUUID();
    const { token, hash } = newParticipantToken();
    await sql`INSERT INTO sessions (id, participant_id, batch_id, is_test, token_hash, expires_at, stance, modality)
              VALUES (${id}, ${pid}, 'TEST', ${test}, ${hash}, ${new Date(Date.now() + expiresInMs).toISOString()},
                      ${test ? stance : null}, ${test ? modality : null})`;
    created.push(id);
    return { id, token };
  }

  // one browser tab
  function tab({ token }) {
    const key = crypto.randomUUID();
    const run = (req) => new Promise((resolve, reject) => {
      const headers = {};
      const res = {
        code: 200, status(c) { this.code = c; return this; },
        setHeader(k, v) { headers[k.toLowerCase()] = v; },
        json(d) { resolve({ code: this.code, ...d }); },
        end(buf) { resolve({ code: this.code, binary: buf, headers }); }, // the spoken feedback (mp3)
      };
      handler(req, res).catch(reject);
    });
    const call = (method, action, body, query = {}) =>
      run({ query: { action, ...query }, method, body, headers: { authorization: `Bearer ${token}`, "x-client-key": key } });
    // raw-body upload: the handler reads the request as a stream
    const upload = (query, bytes, mime) => run({
      query: { action: "audio", ...query }, method: "POST",
      headers: { authorization: `Bearer ${token}`, "x-client-key": key, "content-type": mime },
      async *[Symbol.asyncIterator]() { yield bytes; },
    });
    const T = {
      key,
      claim: () => call("POST", "claim", { user_agent: "test", screen: { w: 1440, h: 900, vw: 1200, vh: 800, dpr: 2 } }),
      consent: (choices = { withdraw_data: "use", notify: "no" }) => call("POST", "consent", { agree: true, ...choices }),
      release: () => call("POST", "release", {}),
      event: (type, question_id = null, data) =>
        call("POST", "event", { id: crypto.randomUUID(), type, question_id, client_ts: Date.now(), ...(data && { data }) }),
      survey: (phase, block, answers) => call("POST", "survey", { phase, block, answers }),
      segment: (question_id, attempt, seq, text) => call("POST", "segment", { question_id, attempt, seq, text, client_ts: Date.now() }),
      answer: (body) => call("POST", "answer", { question_id: "q2", ...body }),
      feedback: (question_id = "q2") => call("GET", "feedback", undefined, { question_id }),
      feedbackAudio: (question_id = "q2") => call("GET", "feedback_audio", undefined, { question_id }),
      debrief: (kind) => call("POST", "debrief", { kind, id: crypto.randomUUID(), client_ts: Date.now() }),
      audio: (question_id, attempt, seq, bytes) =>
        upload({ question_id, attempt: String(attempt), seq: String(seq), client_ts: String(Date.now()) }, bytes, "audio/webm"),
      // the participant says something: saved as a segment, then the answer is confirmed from the saved segments
      async say(attempt, text, extra = {}) {
        if (text) await T.segment("q2", attempt, 0, text);
        return T.answer(extra);
      },
      async waitFeedback(timeoutMs = 90_000) {
        const t0 = Date.now();
        for (;;) {
          const f = await T.feedback();
          if (f.state === "done" || f.state === "error" || f.code !== 200 || Date.now() - t0 > timeoutMs) return f; // 410: the session was locked
          await sleep(1000);
        }
      },
    };
    return T;
  }

  // consented tab, ready for the interview part. Real sessions get their cell from the slot sequence, which would make
  // the tests flip between text and voice: the modality is set explicitly (default text) right after consent.
  async function started(pid, { modality = "text", ...opts } = {}) {
    const s = await issue(pid, { modality, ...opts });
    const T = tab(s);
    await T.claim();
    const c = await T.consent();
    await sql`UPDATE sessions SET modality = ${modality} WHERE id = ${s.id}`;
    return { s, T, c };
  }

  async function cleanup() {
    // spoken feedback files (voice condition) live in the Blob store
    const files = await sql`SELECT pathname FROM feedback_audio WHERE session_id = ANY(${created}::uuid[])`;
    if (files.length && (process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN)) {
      try { const { del } = await import("@vercel/blob"); await del(files.map((f) => f.pathname)); } catch (e) { console.log("blob cleanup failed:", e.message); }
    }
    for (const t of ["audit_log", "events", "session_clients", "feedback_timing", "feedback_audio", "answers", "answer_segments", "audio_chunks", "responses"]) {
      await sql.query(`DELETE FROM ${t} WHERE session_id = ANY($1::uuid[])`, [created]);
    }
    const assigns = await sql`SELECT id FROM slot_assignments WHERE session_id = ANY(${created}::uuid[]) ORDER BY id DESC`;
    for (const a of assigns) await sql`DELETE FROM slot_assignments WHERE id = ${a.id}`;
    await sql`DELETE FROM sessions WHERE id = ANY(${created}::uuid[])`;
    console.log(`cleaned up ${created.length} test session(s)`);
  }

  function finish() {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }

  return { sql, created, check, issue, tab, started, cleanup, finish };
}

// A valid answer for every item of a block (attention checks correct unless failChecks). values: item_id -> value
// overrides (e.g. a specific score).
export function fill(block, { failChecks = false, values = {} } = {}) {
  const a = {};
  for (const item of block.items) {
    const type = item.type ?? "likert";
    const range = rangeOf(item, block);
    if (item.id in values) { a[item.id] = values[item.id]; continue; }
    if (item.check) {
      const correct = [].concat(item.check.correct)[0];
      a[item.id] = failChecks ? (correct === range[0] ? correct + 1 : correct - 1) : correct;
      continue;
    }
    const plain = (optionsOf(item)).filter((o) => o !== (otherLabelOf(item) ?? OTHER_LABEL));
    switch (type) {
      case "likert": case "semantic": a[item.id] = range[0]; break;
      case "single": a[item.id] = plain[0]; break;
      case "multi": a[item.id] = [plain[0]]; break;
      case "number": a[item.id] = Math.min(range[1], Math.max(range[0], 25)); break;
      case "text": a[item.id] = "테스트 응답입니다."; break;
    }
  }
  return a;
}

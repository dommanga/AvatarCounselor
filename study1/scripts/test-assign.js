// Assignment / return / claim test against a scratch database branch. Creates TA-xxx sessions,
// checks the invariants, then deletes everything it created (slots stay as generated).
//   npm run test:assign        (Neon test branch only: .env.test)
// Needs the slot sequence (npm run gen-slots) and at least 40 unassigned sequence slots.

import crypto from "crypto";
import { db } from "../lib/db.js";
import { consent, claim, sweep, grantRetry } from "../lib/lifecycle.js";
import { requireTestDb, fail } from "./cli.js";

requireTestDb();

const sql = db();
const CHOICES = { withdraw_data: "use", notify: "no" };
const created = [];
let passed = 0, failed = 0;
function check(name, ok, info = "") {
  if (ok) passed++; else failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? `  (${info})` : ""}`);
}

async function newSession(pid, { status = "opened", expiresInMs = 86400_000 } = {}) {
  const id = crypto.randomUUID();
  await sql`INSERT INTO sessions (id, participant_id, batch_id, token_hash, status, expires_at, opened_at)
            VALUES (${id}, ${pid}, 'TEST', ${crypto.randomBytes(32).toString("hex")}, ${status},
                    ${new Date(Date.now() + expiresInMs).toISOString()}, now())`;
  created.push(id);
  return id;
}
const assignmentOf = async (id) => (await sql`SELECT * FROM slot_assignments WHERE session_id = ${id}`)[0];
const info = { user_agent: "test-assign", screen: null };

try {
  const [{ n: slotCount }] = await sql`SELECT count(*)::int AS n FROM slots`;
  if (!slotCount) fail("no slots: run `npm run gen-slots` first");
  const [{ q: queued }] = await sql`
    SELECT count(*)::int AS q FROM slot_assignments a
    WHERE a.returned_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM slot_assignments b WHERE b.refill_of = a.id)`;
  if (queued) fail(`refill queue is not empty (${queued}); the ordering checks assume it is`);
  const free = (await sql`
    SELECT seq FROM slots s WHERE NOT EXISTS (SELECT 1 FROM slot_assignments a WHERE a.slot_seq = s.seq AND a.source = 'sequence')
    ORDER BY seq LIMIT 40`).map((r) => r.seq);
  if (free.length < 40) fail("fewer than 40 unassigned sequence slots");

  // A. 30 consents at once: 30 distinct slots, exactly the next 30 of the sequence
  const ids = [];
  for (let i = 1; i <= 30; i++) ids.push(await newSession(`TA-${String(i).padStart(3, "0")}`));
  const t0 = Date.now();
  const results = await Promise.all(ids.map((id) => consent(id, CHOICES)));
  const ms = Date.now() - t0;
  check("30 concurrent consents all assigned", results.every((r) => r.assigned), `${ms} ms`);
  const seqs = (await sql`SELECT slot_seq FROM slot_assignments WHERE session_id = ANY(${ids}::uuid[])`).map((r) => r.slot_seq).sort((a, b) => a - b);
  check("no duplicate slot", new Set(seqs).size === 30 && seqs.length === 30);
  check("slots are the next 30 of the sequence", JSON.stringify(seqs) === JSON.stringify(free.slice(0, 30)));
  const mismatched = await sql`
    SELECT count(*)::int AS n FROM sessions s JOIN slot_assignments a ON a.session_id = s.id JOIN slots sl ON sl.seq = a.slot_seq
    WHERE s.id = ANY(${ids}::uuid[]) AND (s.stance <> sl.stance OR s.modality <> sl.modality OR s.config IS NULL)`;
  check("session cell + config snapshot match the slot", mismatched[0].n === 0);

  // B. consent again on all 30 (already consented): nothing new
  const again = await Promise.all(ids.map((id) => consent(id, CHOICES)));
  const [{ n: afterAgain }] = await sql`SELECT count(*)::int AS n FROM slot_assignments WHERE session_id = ANY(${ids}::uuid[])`;
  check("repeat consent assigns nothing", again.every((r) => !r.assigned) && afterAgain === 30);

  // C. one session, 5 simultaneous consents (double click)
  const dbl = await newSession("TA-031");
  const five = await Promise.all(Array.from({ length: 5 }, () => consent(dbl, CHOICES)));
  const [{ n: dblCount }] = await sql`SELECT count(*)::int AS n FROM slot_assignments WHERE session_id = ${dbl}`;
  check("double click: exactly one assignment", five.filter((r) => r.assigned).length === 1 && dblCount === 1);
  check("double click: took the 31st sequence slot", (await assignmentOf(dbl)).slot_seq === free[30]);

  // D. returns, one at a time so returned_at orders them A < B < C
  const [A, B, Cs] = ids;
  // A: abandoned after seeing feedback
  await sql`INSERT INTO events (id, session_id, type, question_id) VALUES (${crypto.randomUUID()}, ${A}, 'feedback_shown', 'q2')`;
  await sql`UPDATE sessions SET status = 'in_progress', last_activity_at = now() - interval '3 hours' WHERE id = ${A}`;
  await sweep(A);
  const aA = await assignmentOf(A);
  check("abandoned -> slot returned, exposed", aA.returned_at && aA.return_reason === "abandoned" && aA.exposed === true);

  // B: claims — second window blocked, one resume allowed, second resume locks
  const k = () => crypto.randomUUID();
  const k1 = k(), k2 = k(), k3 = k();
  const c1 = await claim(B, k1, info);
  const c2 = await claim(B, k2, info);
  check("claim: first tab", c1.kind === "first");
  check("claim: live second window rejected", c2.kind === "other_window");
  check("claim: same tab reload", (await claim(B, k1, info)).kind === "reload");
  await sql`UPDATE sessions SET client_seen_at = now() - interval '5 minutes' WHERE id = ${B}`;
  const c3 = await claim(B, k2, info);
  check("claim: stale tab -> resume #1", c3.kind === "resume" && (await sql`SELECT resume_count FROM sessions WHERE id = ${B}`)[0].resume_count === 1);
  await sql`UPDATE sessions SET client_released = true WHERE id = ${B}`;
  const c4 = await claim(B, k3, info);
  const aB = await assignmentOf(B);
  check("claim: second resume locks + returns slot", c4.kind === "locked" && aB.return_reason === "locked" && aB.exposed === false);

  // C: completed but failed an attention check
  await sql`UPDATE sessions SET status = 'completed', valid = false WHERE id = ${Cs}`;
  await sweep(Cs);
  const aC = await assignmentOf(Cs);
  check("invalid completion -> slot returned", aC.return_reason === "invalid");

  // E. refills come first, oldest return first; then the sequence resumes
  const order = [];
  for (let i = 0; i < 4; i++) {
    const id = await newSession(`TA-R${i + 1}`);
    await consent(id, CHOICES);
    order.push(await assignmentOf(id));
  }
  check("refill order A, B, C",
    order[0].refill_of === aA.id && order[1].refill_of === aB.id && order[2].refill_of === aC.id &&
    order[0].slot_seq === aA.slot_seq && order[1].slot_seq === aB.slot_seq && order[2].slot_seq === aC.slot_seq);
  check("after the queue, the next sequence slot", order[3].source === "sequence" && order[3].slot_seq === free[31]);

  // F. expired link: no assignment
  const ex = await newSession("TA-EXP", { expiresInMs: -60_000 });
  const exr = await consent(ex, CHOICES);
  check("expired link: consent refused, status expired", !exr.assigned && exr.status === "expired" && !(await assignmentOf(ex)));

  // G. the re-answer chance is granted once
  const g1 = await grantRetry(ids[5], "empty_answer");
  const g2 = await grantRetry(ids[5], "resume");
  check("retry chance granted once", g1 === true && g2 === false);
} finally {
  // children first; slot_assignments newest-first because refill_of points backwards
  await sql`DELETE FROM audit_log WHERE session_id = ANY(${created}::uuid[])`;
  await sql`DELETE FROM events WHERE session_id = ANY(${created}::uuid[])`;
  await sql`DELETE FROM session_clients WHERE session_id = ANY(${created}::uuid[])`;
  const assigns = await sql`SELECT id FROM slot_assignments WHERE session_id = ANY(${created}::uuid[]) ORDER BY id DESC`;
  for (const a of assigns) await sql`DELETE FROM slot_assignments WHERE id = ${a.id}`;
  await sql`DELETE FROM sessions WHERE id = ANY(${created}::uuid[])`;
  console.log(`cleaned up ${created.length} test session(s)`);
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

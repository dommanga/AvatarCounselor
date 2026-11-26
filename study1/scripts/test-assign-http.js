// Concurrent consent test against a deployment (e.g. a Preview) over HTTP. The deployment and the local
// DATABASE_URL must use the same database branch: sessions are created here, consented there.
//   node --env-file=.env scripts/test-assign-http.js --host <dev endpoint id> --url https://<deployment> [--audio]
// Protected Preview deployments: the local development VERCEL_OIDC_TOKEN (vercel env pull) is sent as
// x-vercel-trusted-oidc-idp-token (Trusted Sources; same-project Preview access works by default).

import crypto from "crypto";
import { parseArgs } from "node:util";
import { db } from "../lib/db.js";
import { newParticipantToken } from "../lib/auth.js";
import { requireEndpoint, fail } from "./cli.js";

const { values } = parseArgs({
  options: { host: { type: "string" }, url: { type: "string" }, n: { type: "string", default: "30" }, audio: { type: "boolean", default: false } },
});
requireEndpoint(values.host);
if (!/^https?:\/\//.test(values.url || "")) fail("--url https://<deployment> required");
const base = values.url.replace(/\/+$/, "");
const N = Number(values.n);

const sql = db();
const created = [];
let passed = 0, failed = 0;
function check(name, ok, info = "") {
  if (ok) passed++; else failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? `  (${info})` : ""}`);
}

const trusted = process.env.VERCEL_OIDC_TOKEN;
async function post(token, key, action, body, { raw, mime, query = "" } = {}) {
  const r = await fetch(`${base}/api/session/${action}${query}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`, "x-client-key": key, "content-type": mime || "application/json",
      ...(trusted && { "x-vercel-trusted-oidc-idp-token": trusted }),
    },
    body: raw ?? JSON.stringify(body),
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 120) }; }
  return { code: r.status, ...data };
}

try {
  const free = (await sql`
    SELECT seq FROM slots s WHERE NOT EXISTS (SELECT 1 FROM slot_assignments a WHERE a.slot_seq = s.seq AND a.source = 'sequence')
    ORDER BY seq LIMIT ${N}`).map((r) => r.seq);
  const [{ q: queued }] = await sql`
    SELECT count(*)::int AS q FROM slot_assignments a
    WHERE a.returned_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM slot_assignments b WHERE b.refill_of = a.id)`;
  if (queued) fail(`refill queue is not empty (${queued})`);

  const tabs = [];
  for (let i = 1; i <= N; i++) {
    const id = crypto.randomUUID();
    const { token, hash } = newParticipantToken();
    await sql`INSERT INTO sessions (id, participant_id, batch_id, token_hash, expires_at)
              VALUES (${id}, ${`TH-${String(i).padStart(3, "0")}`}, 'TEST', ${hash}, now() + interval '1 day')`;
    created.push(id);
    tabs.push({ id, token, key: crypto.randomUUID() });
  }

  const claims = await Promise.all(tabs.map((t) => post(t.token, t.key, "claim", { user_agent: "test-assign-http" })));
  check(`${N} claims over HTTP`, claims.every((c) => c.code === 200 && c.screen === "consent"),
    claims.find((c) => c.code !== 200) ? `first error: ${claims.find((c) => c.code !== 200).code} ${claims.find((c) => c.code !== 200).error}` : "");
  if (claims.some((c) => c.code !== 200)) throw new Error("claims failed — protected deployment or wrong database branch?");

  const t0 = Date.now();
  const timings = await Promise.all(tabs.map(async (t) => {
    const s = Date.now();
    const r = await post(t.token, t.key, "consent", { agree: true, withdraw_data: "use", notify: "no" });
    return { r, ms: Date.now() - s };
  }));
  const total = Date.now() - t0;
  const ms = timings.map((x) => x.ms).sort((a, b) => a - b);
  check(`${N} concurrent consents over HTTP`, timings.every((x) => x.r.code === 200 && x.r.screen === "active"),
    `wall ${total} ms, per request median ${ms[Math.floor(ms.length / 2)]} ms, max ${ms[ms.length - 1]} ms`);

  const seqs = (await sql`SELECT slot_seq FROM slot_assignments WHERE session_id = ANY(${created}::uuid[])`).map((r) => r.slot_seq).sort((a, b) => a - b);
  check("no duplicate slot, next N of the sequence", JSON.stringify(seqs) === JSON.stringify(free));

  const [cfg] = await sql`SELECT config FROM sessions WHERE id = ${created[0]}`;
  check("snapshot has the deployed commit SHA", /^[0-9a-f]{40}$/.test(cfg.config?.app?.commit || ""), cfg.config?.app?.commit);

  if (values.audio) {
    const t = tabs[0];
    const up = await post(t.token, t.key, "audio", null,
      { raw: crypto.randomBytes(2048), mime: "audio/webm", query: `?question_id=q2&attempt=1&seq=0&client_ts=${Date.now()}` });
    const [chunk] = await sql`SELECT pathname, bytes FROM audio_chunks WHERE session_id = ${t.id}`;
    check("audio upload on the deployment (OIDC)", up.code === 200 && chunk?.bytes === 2048,
      chunk ? chunk.pathname.replace(t.id, "<session>") : `${up.code} ${up.error}`);
    if (chunk) console.log(`      blob left in the store for cleanup: ${chunk.pathname}`);
  }
} finally {
  await sql`DELETE FROM audit_log WHERE session_id = ANY(${created}::uuid[])`;
  await sql`DELETE FROM events WHERE session_id = ANY(${created}::uuid[])`;
  await sql`DELETE FROM session_clients WHERE session_id = ANY(${created}::uuid[])`;
  await sql`DELETE FROM audio_chunks WHERE session_id = ANY(${created}::uuid[])`;
  const assigns = await sql`SELECT id FROM slot_assignments WHERE session_id = ANY(${created}::uuid[]) ORDER BY id DESC`;
  for (const a of assigns) await sql`DELETE FROM slot_assignments WHERE id = ${a.id}`;
  await sql`DELETE FROM sessions WHERE id = ANY(${created}::uuid[])`;
  console.log(`cleaned up ${created.length} test session(s)`);
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

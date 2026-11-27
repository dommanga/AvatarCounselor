// Safety rails of destructive operations. Part A runs anywhere (child processes with made-up database URLs; nothing connects):
// the test scripts refuse on the dev / main branch, db:reset / gen-slots / purge need --prod on main and a typed count, and
// purging works only from a plan. Part B (test branch only) checks that execute handles exactly the sessions of the plan.
//   npm run test:safety

import crypto from "crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import roles from "./db-roles.json" with { type: "json" };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0, skipped = 0;
const check = (name, ok, info = "") => { if (ok) passed++; else failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? `  (${info})` : ""}`); };
const url = (ep) => `postgres://u:p@${ep}.eu-central-1.aws.neon.tech/db`;
const run = (script, args, env) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", script), ...args], {
    cwd: ROOT, env: { PATH: process.env.PATH, ...env }, input: "", encoding: "utf8", timeout: 60_000,
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
const refused = (r, re = /refusing/) => r.code === 1 && re.test(r.out);

// ---------- A1. tests refuse on dev and main ----------
const TESTS = ["test-flow.js", "test-ui.js", "test-assign.js", "test-survey.js", "test-admin.js", "test-assign-http.js"];
for (const [role, ep] of [["dev", roles.dev], ["main", "ep-main-fake-000001"]]) {
  for (const t of TESTS) {
    const r = run(t, t === "test-assign-http.js" ? ["--url", "https://x.example"] : [], { DATABASE_URL: url(ep), BLOB_PREFIX: "test" });
    check(`${t} refuses on the ${role} branch`, refused(r), r.out.split("\n")[0].slice(0, 110));
  }
}
if (roles.test) {
  const r = run("test-survey.js", [], { DATABASE_URL: url(roles.test), BLOB_PREFIX: "local" });
  check("tests refuse on the test branch when BLOB_PREFIX is not test/", refused(r, /BLOB_PREFIX/));
  const d = run("test-survey.js", [], { DATABASE_URL: url(roles.dev), BLOB_PREFIX: "test" });
  check("the refusal on dev names the test branch", refused(d, /Neon test branch/));
} else {
  console.log("SKIP  BLOB_PREFIX and message checks (no test branch registered in scripts/db-roles.json)");
  skipped++;
}

// ---------- A2. db:reset / gen-slots on main ----------
const MAIN = { DATABASE_URL: url("ep-main-fake-000001") };
check("db:reset on main without --prod refuses", refused(run("db-reset.js", ["--host", "ep-main-fake-000001"], MAIN), /--prod/));
check("db:reset on main with --prod but no person at the terminal refuses", refused(run("db-reset.js", ["--prod"], MAIN), /person at the terminal/));
check("gen-slots on main without --prod refuses", refused(run("gen-slots.js", [], MAIN), /--prod/));
check("gen-slots on main with --prod but no terminal refuses", refused(run("gen-slots.js", ["--prod"], MAIN), /person at the terminal/));
check("--prod is refused on the dev branch", refused(run("db-reset.js", ["--prod"], { DATABASE_URL: url(roles.dev) }), /only for the main branch/));
check("db:reset on dev without --host refuses", refused(run("db-reset.js", [], { DATABASE_URL: url(roles.dev) })));
check("gen-slots on dev with a wrong --host refuses", refused(run("gen-slots.js", ["--host", "ep-other"], { DATABASE_URL: url(roles.dev) })));

// ---------- A3. purge needs a plan ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "study1-plan-"));
const planFile = (over) => { const f = path.join(tmp, `${crypto.randomUUID()}.json`); fs.writeFileSync(f, JSON.stringify({ kind: "withdrawn", db_endpoint: roles.dev, created_at: new Date().toISOString(), sessions: [], ...over })); return f; };
const DEV = { DATABASE_URL: url(roles.dev) };
for (const s of ["purge-withdrawn.js", "purge-audio.js"]) {
  check(`${s} without --plan / --dry-run / --execute does nothing`, refused(run(s, [], DEV), /no way to purge without a plan/));
  check(`${s} refuses --plan together with --execute`, refused(run(s, ["--plan", "--execute", planFile()], DEV), /exactly one/));
}
check("execute refuses a plan made for another database", refused(run("purge-withdrawn.js", ["--execute", planFile({ db_endpoint: "ep-other" }), "--host", roles.dev], DEV), /plan was made for ep-other/));
check("execute refuses a plan of the other kind", refused(run("purge-audio.js", ["--execute", planFile(), "--host", roles.dev], DEV), /withdrawn plan/));
check("execute refuses a file that is not a plan", refused(run("purge-withdrawn.js", ["--execute", planFile({ kind: "everything" }), "--host", roles.dev], DEV), /not a purge plan/));
check("execute on dev without --host refuses", refused(run("purge-withdrawn.js", ["--execute", planFile()], DEV), /--host/));
check("execute on main needs --prod, then a person at the terminal", refused(run("purge-withdrawn.js", ["--execute", planFile({ db_endpoint: "ep-main-fake-000001" })], MAIN), /--prod/)
  && refused(run("purge-withdrawn.js", ["--execute", planFile({ db_endpoint: "ep-main-fake-000001" }), "--prod"], MAIN), /person at the terminal/));
const api = await import("../lib/purge.js");
check("lib/purge.js offers no purge-everything function (plan + execute-plan only)",
  JSON.stringify(Object.keys(api).sort()) === JSON.stringify(["checkPlan", "executePlan", "planVerifiedAudio", "planWithdrawn"]));
fs.rmSync(tmp, { recursive: true, force: true });

// ---------- B. execute handles exactly the plan (test branch only) ----------
let onTest = false;
try { const { dbRole } = await import("./cli.js"); onTest = dbRole() === "test"; } catch { /* no DATABASE_URL */ }
if (!onTest) {
  console.log("SKIP  part B: execute touches only the sessions of the plan (needs DATABASE_URL on the test branch)");
  skipped++;
} else {
  const { requireTestDb } = await import("./cli.js");
  requireTestDb();
  const { createHarness } = await import("./test-lib.js");
  const H = createHarness();
  const { sql } = H;
  try {
    const mk = async (pid) => {
      const s = await H.issue(pid);
      await sql`UPDATE sessions SET status = 'abandoned', destroy_pending = true WHERE id = ${s.id}`;
      for (let i = 0; i < 3; i++) await sql`INSERT INTO events (id, session_id, type) VALUES (${crypto.randomUUID()}, ${s.id}, 'tab_hidden')`;
      return s;
    };
    const A = await mk("TSAFE-A"), B = await mk("TSAFE-B"), C = await mk("TSAFE-C");
    const plan = await api.planWithdrawn({ only: [A.id, C.id] });
    check("plan lists exactly the requested sessions, with row counts", plan.sessions.map((s) => s.participant_id).join() === "TSAFE-A,TSAFE-C" && plan.sessions.every((s) => s.deleted.events === 3 && s.id && s.issued_at));
    check("an unscoped plan would list B too (it qualifies), but it is not in this plan", (await api.planWithdrawn({ only: [B.id] })).sessions.length === 1 && !plan.sessions.some((s) => s.id === B.id));
    await sql`INSERT INTO events (id, session_id, type) VALUES (${crypto.randomUUID()}, ${C.id}, 'tab_visible')`; // C changes after the plan
    const r = await api.executePlan(plan);
    const left = async (id) => (await sql`SELECT (SELECT count(*)::int FROM events WHERE session_id = ${id}) AS ev, data_purged_at FROM sessions WHERE id = ${id}`)[0];
    const [a, b, c] = [await left(A.id), await left(B.id), await left(C.id)];
    check("A (in the plan, unchanged) is purged", r.done.map((d) => d.participant_id).join() === "TSAFE-A" && a.ev === 0 && a.data_purged_at);
    check("B (qualifies but is not in the plan) is untouched", b.ev === 3 && b.data_purged_at === null);
    check("C (in the plan, changed since) is skipped and reported", c.ev === 4 && c.data_purged_at === null && r.skipped.length === 1 && r.skipped[0].participant_id === "TSAFE-C" && /changed/.test(r.skipped[0].reason));
    const again = await api.executePlan(plan);
    check("running the same plan again purges nothing more", again.done.length === 0 && again.skipped.length === 2);
    check("a plan made for another database is refused by the library", await api.executePlan({ ...plan, db_endpoint: "ep-other" }).then(() => false, (e) => /plan was made for/.test(e.message)));
  } finally {
    await H.cleanup();
  }
}

console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ""}`);
process.exit(failed ? 1 : 0);

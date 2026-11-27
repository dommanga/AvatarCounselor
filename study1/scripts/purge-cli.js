// Shared command line of purge-withdrawn / purge-audio: --plan | --dry-run | --execute <plan>. No other way to purge.

import { parseArgs } from "node:util";
import { planWithdrawn, planAudio, executePlan, checkPlan } from "../lib/purge.js";
import { dbEndpoint, dbRole, fail, guardDestructive, readPlanFile, writePlanFile } from "./cli.js";

const describe = (kind, s) => kind === "audio"
  ? `  ${s.participant_id}: ${s.chunks} chunk(s), ${s.bytes} bytes`
  : `  ${s.participant_id} (${s.status}): ${Object.entries(s.deleted).map(([t, n]) => `${t}=${n}`).join(" ")}`;

export async function runPurgeCli(kind) {
  const { values: v } = parseArgs({ options: {
    plan: { type: "boolean", default: false }, "dry-run": { type: "boolean", default: false }, out: { type: "string" },
    execute: { type: "string" }, batch: { type: "string" }, "include-test": { type: "boolean", default: false }, host: { type: "string" }, prod: { type: "boolean", default: false },
  } });
  const modes = [v.plan, v["dry-run"], v.execute !== undefined].filter(Boolean).length;
  if (modes !== 1) fail("choose exactly one of --plan, --dry-run, --execute <plan file>. There is no way to purge without a plan.");

  if (v.plan || v["dry-run"]) {
    const plan = await (kind === "audio" ? planAudio : planWithdrawn)({ batch: v.batch ?? null, includeTest: v["include-test"] })
    console.log(`db: ${dbEndpoint()} (${dbRole()})${v["dry-run"] ? " — dry run, no file written" : ""}`);
    if (!plan.sessions.length) console.log("nothing qualifies");
    for (const s of plan.sessions) console.log(describe(kind, s));
    if (v.plan) console.log(`plan: ${plan.sessions.length} session(s) -> ${writePlanFile(plan, v.out)}\nreview it, then: --execute <that file> (run by the researcher)`);
    return;
  }

  const plan = readPlanFile(v.execute);
  try { checkPlan(plan); } catch (e) { fail(`refusing: ${e.message}`); }
  if (plan.kind !== kind) fail(`refusing: that is a ${plan.kind} plan, this script runs ${kind} plans.`);
  await guardDestructive({ host: v.host, prod: v.prod, what: `session(s) in the plan (${kind})`, count: plan.sessions.length });
  const { done, skipped } = await executePlan(plan);
  console.log(`db: ${dbEndpoint()} (${dbRole()})`);
  for (const d of done) console.log(`purged ${describe(kind, { ...d })}`.replace("purged   ", "purged "));
  for (const s of skipped) console.log(`skipped ${s.participant_id}: ${s.reason}`);
  console.log(`${done.length} purged, ${skipped.length} skipped`);
}

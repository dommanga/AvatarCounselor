// Offline checks (no database): zip writer, export column pinning, personal-field detection, external API gate.
//   npm run test:unit

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { zipFiles } from "../lib/zip.js";
import { EXPORT_SCHEMA, EXPORT_COLUMNS, EXPORT_COLUMNS_FINGERPRINT, fingerprintOf } from "../lib/export.js";
import { toCsv } from "../src/admin-csv.js";
import external, { personalKey } from "../api/external/[action].js";

let passed = 0, failed = 0;
const check = (name, ok, info = "") => { if (ok) passed++; else failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? `  (${info})` : ""}`); };

// zip: python's reader is the judge
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "study1-zip-"));
const files = [{ name: "a.csv", data: "﻿가,나\n1,한글\n" }, { name: "b.json", data: JSON.stringify({ x: 1 }) }, { name: "한글.txt", data: Buffer.alloc(100_000, "z") }];
fs.writeFileSync(path.join(tmp, "t.zip"), zipFiles(files));
const py = spawnSync("python3", ["-I", "-c", "import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip());print('|'.join(z.namelist()));print(z.read('a.csv').decode('utf-8'))", path.join(tmp, "t.zip")], { encoding: "utf8" });
const [bad, names, ...body] = py.stdout.split("\n");
check("zip: valid archive, names (incl. Korean) and content survive", bad === "None" && names === "a.csv|b.json|한글.txt" && body.join("\n").startsWith("﻿가,나\n1,한글"), py.stderr.slice(0, 80));
fs.rmSync(tmp, { recursive: true, force: true });

check("csv: quoting of commas, quotes and newlines", toCsv([{ a: 'x,"y"\nz', b: "q" }], ["a", "b"]) === 'a,b\n"x,""y""\nz",q\n');
check("export columns are pinned: a change needs a new EXPORT_SCHEMA and fingerprint",
  EXPORT_COLUMNS_FINGERPRINT[EXPORT_SCHEMA] === fingerprintOf(EXPORT_COLUMNS), `schema ${EXPORT_SCHEMA}`);
check("export has the files the analysis expects", ["sessions.csv", "responses_long.csv", "answers.csv", "events.csv", "feedback_timing.csv", "feedback_audio.csv"].every((f) => EXPORT_COLUMNS[f]));
check("sessions.csv columns carry the required fields", ["participant_id", "batch_id", "stance", "modality", "valid", "stt_quality", "llm_model", "stage1_sha256", "stage2_sha256", "tts_model_id", "commit_sha",
  "resumed", "retry_used", "answer_short", "answer_truncated", "lock_reason", "destroy_pending"].every((c) => EXPORT_COLUMNS["sessions.csv"].includes(c)));

// personal-looking fields
for (const k of ["phone", "name", "email", "student_id", "contact", "연락처", "이름", "address", "birth_date"]) check(`personal field refused: ${k}`, personalKey({ [k]: "x" }) === k);
check("nested personal field refused", personalKey({ a: { b: [{ c: 1 }, { Phone_Number: "x" }] } }) === "Phone_Number" || personalKey({ a: { Phone_Number: "x" } }) === "Phone_Number");
check("normal fields pass", personalKey({ n: 3, batch_id: "W1", expires_at: "2026-12-06T14:59:59Z", participant_ids: ["S1-001"] }) === null);

// the external API without configuration or with the wrong method / route
const call = (method, action, headers = {}, body = {}) => new Promise((resolve) => {
  const res = { code: 200, status(c) { this.code = c; return this; }, setHeader() {}, json(d) { resolve({ code: this.code, ...d }); } };
  external({ method, query: { action }, headers, body }, res);
});
delete process.env.ADMIN_API_SECRET;
check("external API: not configured -> 503 (never open)", (await call("POST", "status", { "x-admin-secret": "x" })).code === 503);
check("external API: GET -> 404", (await call("GET", "status")).code === 404);
for (const a of ["purge", "resume", "condition", "purge_execute", "extend"]) check(`external API: no ${a} route`, (await call("POST", a)).code === 404);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

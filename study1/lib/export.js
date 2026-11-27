// Data export: one zip, built here for both the /admin button and `npm run export`.
// Column names are read by the analysis pipeline as they are: change any of them and raise EXPORT_SCHEMA
// (the unit test pins the column lists to a fingerprint, so a silent change fails).
// No personal data is collected, but answer transcripts may contain proper nouns the participant said.
// Scores are raw (no reverse coding); the codebook says which items to reverse.

import crypto from "crypto";
import { db } from "./db.js";
import { SURVEY } from "./survey.js";
import { codebookCsv } from "./codebook.js";
import { zipFiles } from "./zip.js";
import { toCsv } from "../src/admin-csv.js";

export const EXPORT_SCHEMA = 1;
export const BOM = "﻿"; // Excel reads UTF-8 CSV with Korean text correctly only with it

const SESSION_COLS = [
  "participant_id", "batch_id", "is_test", "stance", "modality", "status", "current_stage", "valid", "attention_checks_failed",
  "issued_at", "opened_at", "consented_at", "completed_at", "ended_at", "debriefed_at", "last_activity_at",
  "resumed", "resume_count", "retry_used", "answer_short", "answer_truncated", "injected", "lock_reason", "destroy_pending",
  "consent_withdraw_data", "consent_notify", "data_purged_at", "audio_purged_at",
  "stt_quality", "stt_note", "stt_judged_at", "stt_restart_count",
  "ready_after_ms", "reveal_after_ms", "min_wait_ms", "loading_ms", "audio_seconds",
  "llm_model", "stage1_sha256", "stage2_sha256", "tts_model_id", "commit_sha", "survey_version",
];
const LONG_COLS = ["participant_id", "phase", "block_id", "scale_id", "item_id", "value", "display_order", "shown_text", "created_at"];
const ANSWER_COLS = ["participant_id", "question_id", "attempt", "status", "stance", "model", "transcript", "client_transcript", "stage1_raw", "scores", "strong", "weak", "context",
  "stage2_raw", "feedback", "answer_short", "answer_truncated", "injected", "error", "created_at", "finished_at"];
const EVENT_COLS = ["participant_id", "seq", "type", "question_id", "client_ts", "server_ts", "data"];
const TIMING_COLS = ["participant_id", "question_id", "modality", "submitted_at", "ready_at", "revealed_at", "ready_after_ms", "reveal_after_ms", "min_wait_ms", "loading_ms"];
const AUDIO_COLS = ["participant_id", "question_id", "text_original", "text_tts", "rules", "chars", "audio_seconds", "tts_latency_ms", "tts_total_ms", "attempts",
  "model_id", "voice_id", "voice_settings", "output_format", "request_id", "created_at"];
export const EXPORT_COLUMNS = { "sessions.csv": SESSION_COLS, "responses_long.csv": LONG_COLS, "answers.csv": ANSWER_COLS, "events.csv": EVENT_COLS, "feedback_timing.csv": TIMING_COLS, "feedback_audio.csv": AUDIO_COLS };
// sha256 of EXPORT_COLUMNS (wide csv: participant_id + one column per item id, not pinned). Update together with EXPORT_SCHEMA.
export const EXPORT_COLUMNS_FINGERPRINT = { 1: "6478f1606b7e816ff0c132aaf032e1f2a2ab54b411ead73715092965849ee05d" };
export const fingerprintOf = (cols) => crypto.createHash("sha256").update(JSON.stringify(cols)).digest("hex");

const iso = (v) => (v instanceof Date ? v.toISOString() : v);
const plainValue = (v) => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.join("|"); // multi-select answers
  if (typeof v === "object") return JSON.stringify(v);
  return v;
};
const prep = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, plainValue(v)])));
const csv = (rows, cols) => BOM + toCsv(prep(rows), cols);

export async function buildExport({ includeIncomplete = false, includeTest = false } = {}) {
  const sql = db();
  const sessions = await sql`
    SELECT * FROM sessions WHERE (${includeTest}::boolean OR NOT is_test) AND (${includeIncomplete}::boolean OR status = 'completed')
    ORDER BY participant_id`;
  const ids = sessions.map((s) => s.id);
  const q = (text) => sql.query(text, [ids]);
  const [responses, answers, events, timing, audio, completedAudit] = await Promise.all([
    q(`SELECT * FROM responses WHERE session_id = ANY($1::uuid[]) ORDER BY session_id, phase, display_order NULLS LAST, item_id`),
    q(`SELECT * FROM answers WHERE session_id = ANY($1::uuid[]) ORDER BY session_id, id`),
    q(`SELECT session_id, seq, type, question_id, client_ts, server_ts, data FROM events WHERE session_id = ANY($1::uuid[]) ORDER BY session_id, seq`),
    q(`SELECT * FROM feedback_timing WHERE session_id = ANY($1::uuid[]) ORDER BY session_id, question_id`),
    q(`SELECT * FROM feedback_audio WHERE session_id = ANY($1::uuid[]) ORDER BY session_id, question_id`),
    q(`SELECT session_id, detail FROM audit_log WHERE action = 'completed' AND session_id = ANY($1::uuid[]) ORDER BY id`),
  ]);
  const pid = new Map(sessions.map((s) => [s.id, s.participant_id]));
  const by = (rows) => { const m = new Map(); for (const r of rows) (m.get(r.session_id) ?? m.set(r.session_id, []).get(r.session_id)).push(r); return m; };
  const answersBy = by(answers), eventsBy = by(events), timingBy = by(timing), audioBy = by(audio);
  const failedBy = new Map(completedAudit.map((a) => [a.session_id, a.detail?.failed ?? []]));
  const real = (rows) => (rows ?? []).filter((r) => r.question_id !== "practice");

  const sessionRows = sessions.map((s) => {
    const as = real(answersBy.get(s.id));
    const t = real(timingBy.get(s.id))[0], au = real(audioBy.get(s.id))[0], cfg = s.config ?? {};
    return {
      ...s, resumed: s.resume_count > 0, attention_checks_failed: (failedBy.get(s.id) ?? []).join("|"),
      answer_short: as.some((a) => a.answer_short), answer_truncated: as.some((a) => a.answer_truncated), injected: as.some((a) => a.injected),
      stt_restart_count: (eventsBy.get(s.id) ?? []).filter((e) => e.type === "stt_restart").length,
      ready_after_ms: t?.ready_after_ms, reveal_after_ms: t?.reveal_after_ms, min_wait_ms: t?.min_wait_ms, loading_ms: t?.loading_ms, audio_seconds: au?.audio_seconds,
      llm_model: cfg.llm?.model, stage1_sha256: cfg.prompts?.stage1_sha256, stage2_sha256: cfg.prompts?.stage2_sha256,
      tts_model_id: cfg.tts?.model_id, commit_sha: cfg.app?.commit, survey_version: s.survey_version,
    };
  });
  const withPid = (rows) => rows.map((r) => ({ ...r, participant_id: pid.get(r.session_id) }));

  // wide: one column per item id; an id used in more than one phase is prefixed with its phase
  const order = [];
  for (const phase of ["pre", "mid", "post"]) for (const b of SURVEY[phase] || []) for (const it of b.items) order.push({ phase, id: it.id });
  const seen = new Map(order.map((o) => [`${o.phase}|${o.id}`, o]));
  for (const r of responses) if (!seen.has(`${r.phase}|${r.item_id}`)) { const o = { phase: r.phase, id: r.item_id }; seen.set(`${r.phase}|${r.item_id}`, o); order.push(o); }
  const phasesOf = new Map();
  for (const o of order) phasesOf.set(o.id, (phasesOf.get(o.id) ?? 0) + 1);
  const colOf = (phase, id) => (phasesOf.get(id) > 1 ? `${phase}.${id}` : id);
  const wideCols = ["participant_id", ...order.map((o) => colOf(o.phase, o.id))];
  const respBy = by(responses);
  const wideRows = sessions.map((s) => {
    const row = { participant_id: s.participant_id };
    for (const r of respBy.get(s.id) ?? []) row[colOf(r.phase, r.item_id)] = r.value;
    return row;
  });

  const longRows = withPid(responses);
  const files = {
    "sessions.csv": csv(sessionRows, SESSION_COLS),
    "responses_long.csv": csv(longRows.map((r) => ({ ...r, created_at: iso(r.created_at) })), LONG_COLS),
    "responses_wide.csv": csv(wideRows, wideCols),
    "answers.csv": csv(withPid(answers), ANSWER_COLS),
    "events.csv": csv(withPid(events), EVENT_COLS),
    "feedback_timing.csv": csv(withPid(timing), TIMING_COLS),
    "feedback_audio.csv": csv(withPid(audio), AUDIO_COLS),
    "codebook.csv": BOM + codebookCsv(),
    "survey_items.json": JSON.stringify(SURVEY, null, 2) + "\n",
  };
  const rowsOf = { "sessions.csv": sessionRows.length, "responses_long.csv": longRows.length, "responses_wide.csv": wideRows.length, "answers.csv": answers.length,
    "events.csv": events.length, "feedback_timing.csv": timing.length, "feedback_audio.csv": audio.length };
  const manifest = {
    export_schema: EXPORT_SCHEMA,
    exported_at: new Date().toISOString(),
    filter: { include_incomplete: includeIncomplete, include_test: includeTest },
    survey_versions: [...new Set(sessions.map((s) => s.survey_version).filter(Boolean))].sort(),
    codebook_survey_version: SURVEY.version,
    commit_sha: [...new Set(sessions.map((s) => s.config?.app?.commit).filter(Boolean))],
    exporter_commit_sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    files: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, {
      ...(rowsOf[name] !== undefined && { rows: rowsOf[name] }), ...(name === "responses_wide.csv" ? { columns: wideCols } : EXPORT_COLUMNS[name] ? { columns: EXPORT_COLUMNS[name] } : {}),
    }])),
    notes: "Scores are raw (no reverse coding); see codebook.csv. Answer transcripts may contain proper nouns spoken by the participant.",
  };
  return { files: { ...files, "manifest.json": JSON.stringify(manifest, null, 2) + "\n" }, manifest };
}

// -> { zip: Buffer, manifest, name }; also written to audit_log
export async function exportZip({ includeIncomplete = false, includeTest = false, actor = "admin" } = {}) {
  const { files, manifest } = await buildExport({ includeIncomplete, includeTest });
  const zip = zipFiles(Object.entries(files).map(([name, data]) => ({ name, data })));
  await db()`INSERT INTO audit_log (actor, action, detail)
    VALUES (${actor}, 'exported', ${JSON.stringify({ filter: manifest.filter, sessions: manifest.files["sessions.csv"].rows, files: Object.fromEntries(Object.entries(manifest.files).filter(([, v]) => v.rows !== undefined).map(([k, v]) => [k, v.rows])), bytes: zip.length })}::jsonb)`;
  return { zip, manifest, name: `study1-export-${manifest.exported_at.slice(0, 19).replace(/[:T]/g, "-")}.zip` };
}

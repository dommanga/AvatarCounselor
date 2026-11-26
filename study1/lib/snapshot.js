// Settings snapshot stored on each session at consent, so every analysed session records exactly
// which model / temperatures / prompts / survey produced it.
// Prompt hashes are sha256 of the runtime strings, which equal sha256 of the trimmed
// experiment/prompts/*.md files.

import crypto from "crypto";
// Namespace import: llm.js (frozen) does not export its temperatures yet; they record as null until
// `export` is added there.
import * as LLM from "./llm.js";
import { STAGE1, STAGE2 } from "../prompts.js";
import { SURVEY } from "./survey.js";
import * as C from "./config.js";

const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

export function configSnapshot(stance) {
  return {
    llm: { model: LLM.MODEL, stage1_temperature: LLM.STAGE1_TEMP ?? null, stage2_temperature: LLM.STAGE2_TEMP ?? null },
    prompts: {
      stage1_sha256: sha256(STAGE1),
      stage2_sha256: stance ? sha256(STAGE2[stance]) : null,
      stage2_all_sha256: Object.fromEntries(Object.entries(STAGE2).map(([k, v]) => [k, sha256(v)])),
    },
    survey_version: SURVEY.version ?? null,
    app: {
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      empty_answer_min_chars: C.EMPTY_ANSWER_MIN_CHARS,
      abandon_after_ms: C.ABANDON_AFTER_MS,
      max_resumes: C.MAX_RESUMES,
    },
    tts: null, // Phase 4: voice_id, model_id, voice settings
  };
}

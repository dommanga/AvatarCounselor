// Settings snapshot stored on each session at consent, so every analysed session records exactly
// which model / temperatures / prompts / survey produced it.
// Prompt hashes are sha256 of the runtime strings, which equal sha256 of the trimmed
// experiment/prompts/*.md files.

import crypto from "crypto";
import { MODEL, STAGE1_TEMP, STAGE2_TEMP } from "./llm.js";
import { STAGE1, STAGE2 } from "../prompts.js";
import { SURVEY } from "./survey.js";
import * as C from "./config.js";

const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

export function configSnapshot(stance, modality) {
  return {
    llm: { model: MODEL, stage1_temperature: STAGE1_TEMP, stage2_temperature: STAGE2_TEMP },
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
      think_time_ms: C.THINK_TIME_MS,
      answer_max_ms: C.ANSWER_MAX_MS,
      feedback_min_wait_ms: C.FEEDBACK_MIN_WAIT_MS,
      text_min_dwell_ms_per_char: C.TEXT_MIN_DWELL_MS_PER_CHAR,
      audio_chunk_ms: C.AUDIO_CHUNK_MS,
      oe_min_chars: C.OE_MIN_CHARS,
      audio_upload_enabled: C.AUDIO_UPLOAD_ENABLED,
    },
    // voice condition only: everything that shapes the spoken feedback
    tts: modality === "voice" ? {
      provider: "elevenlabs", voice_id: C.TTS.voiceId, voice_name: C.TTS.voiceName, model_id: C.TTS.modelId, model_confirmed: C.TTS.modelConfirmed,
      voice_settings: C.TTS.voiceSettings, output_format: C.TTS.outputFormat, language_code: C.TTS.languageCode,
      retries: C.TTS.retries, text_rules_version: C.TTS.textRulesVersion,
    } : null,
  };
}

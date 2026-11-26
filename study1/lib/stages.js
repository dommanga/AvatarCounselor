// Event vocabulary + how each event moves sessions.current_stage (used to resume after a reload).
//   consent -> device_test -> notice -> pre_survey -> scenario -> question_guide -> q2_answering ->
//   q2_selfrating -> q2_feedback -> post_survey -> debrief -> done
// consented (-> device_test) and debrief_confirmed (-> done) are written by the server only.

import { LAST_QUESTION } from "../src/questions.js";

export const CLIENT_EVENT_TYPES = [
  "speaker_tone_start", "speaker_tone_stop", "mic_test_attempt", "device_test_done", "notice_confirmed",
  "survey_pre_submitted", "scenario_shown", "question_guide_shown",
  "question_shown", "answer_start", "answer_end", "stt_restart",
  "self_rating_shown", "feedback_loading_shown", "feedback_shown", "audio_started", "audio_ended", "next_clicked",
  "survey_post_submitted",
  "tab_hidden", "tab_visible", "window_blur", "window_focus", // data.stage says which screen it happened on
];

// Events that belong to one question (question_id required); all others must not carry one.
export const QUESTION_EVENT_TYPES = [
  "question_shown", "answer_start", "answer_end", "stt_restart",
  "self_rating_shown", "feedback_loading_shown", "feedback_shown", "audio_started", "audio_ended", "next_clicked",
];

export const MAX_EVENT_DATA_CHARS = 2000;

// Stage after this event, or null to leave it unchanged.
export function stageAfter(type, questionId) {
  switch (type) {
    case "device_test_done": return "notice";
    case "notice_confirmed": return "pre_survey";
    case "survey_pre_submitted":
    case "scenario_shown": return "scenario";
    case "question_guide_shown": return "question_guide";
    case "question_shown":
    case "answer_start":
    case "answer_end": return `${questionId}_answering`;
    case "self_rating_shown": return `${questionId}_selfrating`;
    case "feedback_loading_shown":
    case "feedback_shown": return `${questionId}_feedback`;
    case "next_clicked": return questionId === LAST_QUESTION ? "post_survey" : null; // otherwise the next question_shown moves it
    default: return null;
  }
}

export const QUESTION_STAGE_RE = /^(.+)_(answering|selfrating|feedback)$/;

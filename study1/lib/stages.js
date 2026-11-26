// Event vocabulary + how each event moves sessions.current_stage (used to resume after a reload).

import { LAST_QUESTION } from "../src/questions.js";

export const CLIENT_EVENT_TYPES = [
  "survey_pre_submitted", "scenario_shown",
  "practice_start", "practice_end",
  "question_shown", "answer_start", "answer_end",
  "feedback_shown", "audio_started", "audio_ended", "next_clicked",
  "survey_post_submitted",
];
// consented is written by the server only (in the assignment transaction, which also sets pre_survey).

export const QUESTION_EVENT_TYPES = [
  "question_shown", "answer_start", "answer_end", "feedback_shown", "audio_started", "audio_ended", "next_clicked",
];

// Stage after this event, or null to leave it unchanged.
export function stageAfter(type, questionId) {
  switch (type) {
    case "survey_pre_submitted":
    case "scenario_shown": return "scenario";
    case "practice_start":
    case "practice_end": return "practice";
    case "question_shown":
    case "answer_start":
    case "answer_end": return `${questionId}_answering`;
    case "feedback_shown": return `${questionId}_feedback`;
    case "next_clicked": return questionId === LAST_QUESTION ? "post_survey" : null; // otherwise the next question_shown moves it
    case "survey_post_submitted": return "done";
    default: return null;
  }
}

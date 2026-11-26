// Event vocabulary + how each event moves sessions.current_stage (used for note auto-tagging).

export const CLIENT_EVENT_TYPES = [
  "survey_pre_submitted", "scenario_shown",
  "practice_start", "practice_end",
  "question_shown", "answer_start", "answer_end",
  "feedback_shown", "next_clicked",
  "survey_post_submitted",
];
// session_created is written by the server only.

export const QUESTION_EVENT_TYPES = ["question_shown", "answer_start", "answer_end", "feedback_shown", "next_clicked"];

// Stage after this event, or null to leave it unchanged.
export function stageAfter(type, questionId) {
  switch (type) {
    case "session_created": return "pre_survey";
    case "survey_pre_submitted":
    case "scenario_shown": return "scenario";
    case "practice_start":
    case "practice_end": return "practice";
    case "question_shown":
    case "answer_start":
    case "answer_end": return `${questionId}_answering`;
    case "feedback_shown": return `${questionId}_feedback`;
    case "next_clicked": return questionId === "q3" ? "post_survey" : null; // q1/q2: next question_shown moves it
    case "survey_post_submitted": return "done";
    default: return null;
  }
}

// Shared by the browser (participant flow) and the server (Stage 1 prompt). No browser/Node deps.

// Real Bangerter questions from the corpus (do not invent).
// Online study: Q2 (initiative) only. The id stays "q2" to match the corpus and the pilot data.
export const QUESTIONS = {
  q2: "본인이 주도해서 끝까지 완수했던 일에 대해 이야기해 주세요.",
};
export const QUESTION_SEQUENCE = ["q2"]; // fixed order for every participant
export const LAST_QUESTION = QUESTION_SEQUENCE[QUESTION_SEQUENCE.length - 1];

// Between-subject: one condition per session, used for every question.
export const CONDITIONS = ["reversing", "minimizing", "direct"];

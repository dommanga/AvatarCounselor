// Shared by the browser (participant flow) and the server (Stage 1 prompt). No browser/Node deps.

// Real Bangerter questions from the corpus (do not invent).
export const QUESTIONS = {
  q1: "함께 일하는 사람들과 의견이 달랐던 상황이 있었나요? 그때 어떻게 풀어나갔는지 말씀해 주세요.",
  q2: "본인이 주도해서 끝까지 완수했던 일에 대해 이야기해 주세요.",
  q3: "여러 가지 일을 동시에 처리해야 했던 경험에 대해 말씀해 주세요.",
};
export const QUESTION_SEQUENCE = ["q1", "q2", "q3"]; // fixed order for every participant

// Practice turn (STT check only — no feedback, excluded from analysis).
export const PRACTICE_ID = "practice";
export const PRACTICE_PROMPT = "먼저 연습으로, 간단하게 자기소개를 해주세요.";

// Between-subject: one condition per session, used for all three questions.
export const CONDITIONS = ["reversing", "minimizing", "direct"];

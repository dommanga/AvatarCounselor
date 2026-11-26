// Stage 1 (assessment) + Stage 2 (feedback) OpenAI calls, shared by the dev endpoints
// (/api/assess, /api/feedback) and the participant flow (/api/session/answer).

import OpenAI from "openai";
import { STAGE1, STAGE2 } from "../prompts.js";
import { parseStage1, selectStrong, selectWeak, buildContext, extractFeedback } from "./pipeline.js";

export const MODEL = "gpt-4o";
const STAGE1_TEMP = 0;
const STAGE2_TEMP = 0.3;

let openai = null;
const client = () => (openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));

async function complete(prompt, temperature) {
  const r = await client().chat.completions.create({
    model: MODEL,
    temperature,
    messages: [{ role: "user", content: prompt }],
  });
  return r.choices[0].message.content.trim();
}

// -> { raw, scores, strong, weak, context }
export async function assess(question, transcript) {
  const prompt = STAGE1
    .replace("<<QUESTION>>", () => question)
    .replace("<<TRANSCRIPT>>", () => transcript);
  const raw = await complete(prompt, STAGE1_TEMP);
  const scores = parseStage1(raw);
  const strong = selectStrong(scores, transcript);
  const weak = selectWeak(scores, transcript, strong);
  const context = buildContext(question, transcript, strong, weak, scores);
  return { raw, scores, strong, weak, context };
}

// -> { raw, feedback }   raw = GROUNDING + FEEDBACK; feedback = the part the participant sees
export async function generateFeedback(context, condition) {
  const prompt = STAGE2[condition].replace("<<CONTEXT>>", () => context);
  const raw = await complete(prompt, STAGE2_TEMP);
  return { raw, feedback: extractFeedback(raw) };
}

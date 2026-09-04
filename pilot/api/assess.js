// POST /api/assess  — PHASE 1 (rate STAR) + tie-break + build TRq context.
// in:  { question, transcript }
// out: { scores:{situation,task_and_action,result}, strong, weak, context }

import OpenAI from "openai";
import { STAGE1 } from "../prompts.js";
import { parseStage1, selectStrong, selectWeak, buildContext } from "../lib/pipeline.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o";
const STAGE1_TEMP = 0;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const { question, transcript } = req.body || {};
    if (!question || !transcript) {
      return res.status(400).json({ error: "question and transcript required" });
    }

    const prompt = STAGE1
      .replace("<<QUESTION>>", () => question)
      .replace("<<TRANSCRIPT>>", () => transcript);

    const r = await openai.chat.completions.create({
      model: MODEL,
      temperature: STAGE1_TEMP,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = r.choices[0].message.content.trim();
    const scores = parseStage1(raw);
    const strong = selectStrong(scores, transcript);
    const weak = selectWeak(scores, transcript, strong);
    const context = buildContext(question, transcript, strong, weak, scores);

    return res.status(200).json({ scores, strong, weak, context });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}

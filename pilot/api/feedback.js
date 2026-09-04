// POST /api/feedback  — PHASE 2 for ONE condition. Comparison tail calls this 3x in parallel.
// in:  { context, condition }            condition ∈ reversing | minimizing | direct
// out: { condition, feedback, raw }       feedback = parsed FEEDBACK; raw = GROUNDING+FEEDBACK (for logging)

import OpenAI from "openai";
import { STAGE2 } from "../prompts.js";
import { extractFeedback } from "../lib/pipeline.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = "gpt-4o";
const STAGE2_TEMP = 0.3;
const CONDITIONS = ["reversing", "minimizing", "direct"];

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const { context, condition } = req.body || {};
    if (!context || !CONDITIONS.includes(condition)) {
      return res.status(400).json({ error: "context and valid condition required" });
    }

    const prompt = STAGE2[condition].replace("<<CONTEXT>>", () => context);

    const r = await openai.chat.completions.create({
      model: MODEL,
      temperature: STAGE2_TEMP,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = r.choices[0].message.content.trim();
    const feedback = extractFeedback(raw);

    return res.status(200).json({ condition, feedback, raw });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}

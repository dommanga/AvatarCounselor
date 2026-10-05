// POST /api/feedback  — PHASE 2 for ONE condition. Dev "API 테스트" view only (calls this 3x in parallel);
// researcher login required.
// in:  { context, condition }            condition ∈ reversing | minimizing | direct
// out: { condition, feedback, raw }       feedback = parsed FEEDBACK; raw = GROUNDING+FEEDBACK

import { requireResearcher } from "../lib/auth.js";
import { generateFeedback } from "../lib/llm.js";
import { CONDITIONS } from "../src/questions.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!requireResearcher(req, res)) return;
  try {
    const { context, condition } = req.body || {};
    if (!context || !CONDITIONS.includes(condition)) {
      return res.status(400).json({ error: "context and valid condition required" });
    }
    const { raw, feedback } = await generateFeedback(context, condition);
    return res.status(200).json({ condition, feedback, raw });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}

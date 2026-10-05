// POST /api/assess  — PHASE 1 (rate STAR) + tie-break + build TRq context. Dev "API 테스트" view only;
// researcher login required (the participant flow goes through /api/session/answer).
// in:  { question, transcript }
// out: { scores:{situation,task_and_action,result}, strong, weak, context }

import { requireResearcher } from "../lib/auth.js";
import { assess } from "../lib/llm.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!requireResearcher(req, res)) return;
  try {
    const { question, transcript } = req.body || {};
    if (!question || !transcript) {
      return res.status(400).json({ error: "question and transcript required" });
    }
    const { scores, strong, weak, context } = await assess(question, transcript);
    return res.status(200).json({ scores, strong, weak, context });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}

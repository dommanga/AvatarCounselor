// Port of experiment/run.py core logic (parse / tie-break / context).
// Kept behaviorally identical to the Python so the pilot validates the real pipeline.

import crypto from "crypto";

export const ELEMENTS = ["situation", "task_and_action", "result"];
const LABELS = { 0: "absent", 1: "vague", 2: "specific" };

// Fixed config = TRq (transcript on, full rating on, quote off) — settled in 0824.
const CFG = { transcript: true, rating: true, quote: false };

function sha256hex(s) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

// Matches Python: int(sha256(seed).hexdigest(), 16) % n  — BigInt keeps full 256-bit precision.
function hashPick(seed, n) {
  return Number(BigInt("0x" + sha256hex(seed)) % BigInt(n));
}

export function parseStage1(raw) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const d = JSON.parse(raw.slice(start, end + 1));
  const out = {};
  for (const e of ELEMENTS) {
    const v = d[e] || d[e.toUpperCase()] || {};
    out[e] = { rating: v.rating ?? 0, quote: v.quote ?? "" };
  }
  return out;
}

// Highest-rated element. Ties broken deterministically by hash(transcript + "_strong").
export function selectStrong(scores, seed) {
  const hi = Math.max(...ELEMENTS.map((e) => scores[e].rating));
  const tied = ELEMENTS.filter((e) => scores[e].rating === hi).sort();
  if (tied.length === 1) return tied[0];
  return tied[hashPick(seed + "_strong", tied.length)];
}

// Lowest-rated element excluding the strength. Ties broken by hash(transcript).
export function selectWeak(scores, seed, exclude) {
  const pool = ELEMENTS.filter((e) => e !== exclude);
  const lo = Math.min(...pool.map((e) => scores[e].rating));
  const tied = pool.filter((e) => scores[e].rating === lo).sort();
  if (tied.length === 1) return tied[0];
  return tied[hashPick(seed, tied.length)];
}

export function buildContext(question, transcript, strong, weak, scores) {
  const lines = [`Question: ${question}`];
  if (CFG.rating) {
    lines.push("Assessment of the candidate's answer (0=absent, 1=vague, 2=specific):");
    for (const e of ELEMENTS) {
      const r = scores[e].rating;
      lines.push(`- ${e.toUpperCase()}: ${r} (${LABELS[r]})`);
    }
  }
  lines.push(`Strength to praise: ${strong.toUpperCase()}`);
  lines.push(`Weakness to address: ${weak.toUpperCase()}`);
  if (CFG.transcript) {
    lines.push(`Full answer transcript: "${transcript}"`);
  }
  return lines.join("\n");
}

// PHASE 2 output is "GROUNDING: ...\nFEEDBACK: ...". Participant sees only the FEEDBACK part.
export function extractFeedback(raw) {
  const i = raw.search(/FEEDBACK:/i);
  if (i === -1) return raw.trim();
  return raw.slice(i).replace(/FEEDBACK:\s*/i, "").trim();
}

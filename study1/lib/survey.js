// Server-side view of survey_items.json (the single source of survey wording/structure; the browser
// fetches the same file). Validates one submitted block and turns it into Response rows.

import crypto from "crypto";
import SURVEY from "../survey_items.json" with { type: "json" };
import { OTHER_LABEL, otherItemId, optionsOf, AGE_RANGE } from "../src/survey-shared.js";

export { SURVEY };
const MAX_TEXT = 500;
export const PHASES = ["pre", "mid", "post"]; // mid = the self-rating between the answer and the feedback

// Order in which one block's items are shown: items marked "fixed": true keep their configured
// position, the others are shuffled into the remaining positions. "shuffle": false keeps config order.
export function orderBlock(block, randomInt = crypto.randomInt) {
  const ids = block.items.map((it) => it.id);
  if (block.shuffle === false) return ids;
  const free = block.items.flatMap((it, i) => (it.fixed ? [] : [i]));
  const movable = free.map((i) => ids[i]);
  for (let i = movable.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [movable[i], movable[j]] = [movable[j], movable[i]];
  }
  const out = [...ids];
  free.forEach((pos, k) => { out[pos] = movable[k]; });
  return out;
}

// { phase: { block: [item ids] } } for every block; drawn once per session at consent and stored,
// so a reload shows the same order.
export function buildSurveyOrder() {
  return Object.fromEntries(PHASES.map((ph) => [ph, Object.fromEntries((SURVEY[ph] || []).map((b) => [b.block, orderBlock(b)]))]));
}

export function findBlock(phase, blockId) {
  return (SURVEY[phase] || []).find((b) => b.block === blockId) || null;
}

// answers: { item_id: value, [item_id + "_other"]: text }; order: the session's stored item order for this block
// -> { rows: [{ scale_id, item_id, value, display_order }], clear: [item_id] }  or  { error }
//    clear = "_other" rows to delete because 기타 is no longer picked (on re-submission)
// scale_id is the block id (MH, ISE_pre, FOS, S, C, L, ISE_post, background); subscales come from the config.
export function validateBlock(phase, blockId, answers, order = null) {
  const block = findBlock(phase, blockId);
  if (!block) return { error: "unknown survey block" };
  if (!answers || typeof answers !== "object") return { error: "answers required" };

  const allowed = new Set();
  const rows = [];
  const clear = [];
  const position = (id) => {
    const i = (order || block.items.map((it) => it.id)).indexOf(id);
    return i < 0 ? null : i + 1;
  };
  for (const item of block.items) {
    allowed.add(item.id);
    const v = answers[item.id];
    const bad = (why) => ({ error: `${item.id}: ${why}` });
    switch (item.type) {
      case undefined: { // Likert
        const { min, max } = block.scale;
        if (!Number.isInteger(v) || v < min || v > max) return bad(`must be an integer ${min}–${max}`);
        break;
      }
      case "single":
        if (!optionsOf(item).includes(v)) return bad("not one of the options");
        break;
      case "number":
        if (!Number.isInteger(v) || v < AGE_RANGE[0] || v > AGE_RANGE[1]) return bad(`must be an integer ${AGE_RANGE[0]}–${AGE_RANGE[1]}`);
        break;
      case "multi": {
        const opts = optionsOf(item);
        if (!Array.isArray(v) || !v.length || new Set(v).size !== v.length || !v.every((o) => opts.includes(o))) {
          return bad("choose at least one option");
        }
        break;
      }
      default:
        return bad(`unsupported type ${item.type}`);
    }
    rows.push({ scale_id: block.block, item_id: item.id, value: v, display_order: position(item.id) });

    const picked = Array.isArray(v) ? v : [v];
    if (item.other && picked.includes(OTHER_LABEL)) {
      const oid = otherItemId(item.id);
      allowed.add(oid);
      const t = typeof answers[oid] === "string" ? answers[oid].trim() : "";
      if (!t || t.length > MAX_TEXT) return bad("기타 내용을 입력해주세요");
      rows.push({ scale_id: block.block, item_id: oid, value: t, display_order: position(item.id) });
    } else if (item.other) {
      clear.push(otherItemId(item.id));
    }
  }
  const extra = Object.keys(answers).find((k) => !allowed.has(k));
  if (extra) return { error: `unexpected item ${extra}` };
  return { rows, clear };
}

// Attention checks: items carrying "check": {"correct": value | [values]} in survey_items.json.
// responses: [{ phase, item_id, value }] -> { defined: [item_id], failed: [item_id], valid }
// valid is true only when every check item (AT1, AT2) was answered correctly; null if none is configured.
export function evaluateChecks(responses) {
  const got = new Map(responses.map((r) => [`${r.phase}:${r.item_id}`, r.value]));
  const defined = [], failed = [];
  for (const phase of PHASES) {
    for (const block of SURVEY[phase] || []) {
      for (const item of block.items) {
        if (!item.check) continue;
        defined.push(item.id);
        const ok = [].concat(item.check.correct).some((c) => JSON.stringify(c) === JSON.stringify(got.get(`${phase}:${item.id}`)));
        if (!ok) failed.push(item.id);
      }
    }
  }
  return { defined, failed, valid: defined.length ? failed.length === 0 : null };
}

// Server-side view of survey_items.json (the single source of survey wording/structure; the browser
// fetches the same file). Validates one submitted block and turns it into Response rows.

import SURVEY from "../survey_items.json" with { type: "json" };
import { OTHER_LABEL, otherItemId, optionsOf, AGE_RANGE } from "../src/survey-shared.js";

export { SURVEY };
const MAX_TEXT = 500;

export function findBlock(phase, blockId) {
  return (SURVEY[phase] || []).find((b) => b.block === blockId) || null;
}

// answers: { item_id: value, [item_id + "_other"]: text }
// -> { rows: [{ scale_id, item_id, value }], clear: [item_id] }  or  { error }
//    clear = "_other" rows to delete because 기타 is no longer picked (on re-submission)
// scale_id is the block id (MH, ISE_pre, FOS, S, C, L, ISE_post, background); subscales come from the config.
export function validateBlock(phase, blockId, answers) {
  const block = findBlock(phase, blockId);
  if (!block) return { error: "unknown survey block" };
  if (!answers || typeof answers !== "object") return { error: "answers required" };

  const allowed = new Set();
  const rows = [];
  const clear = [];
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
    rows.push({ scale_id: block.block, item_id: item.id, value: v });

    const picked = Array.isArray(v) ? v : [v];
    if (item.other && picked.includes(OTHER_LABEL)) {
      const oid = otherItemId(item.id);
      allowed.add(oid);
      const t = typeof answers[oid] === "string" ? answers[oid].trim() : "";
      if (!t || t.length > MAX_TEXT) return bad("기타 내용을 입력해주세요");
      rows.push({ scale_id: block.block, item_id: oid, value: t });
    } else if (item.other) {
      clear.push(otherItemId(item.id));
    }
  }
  const extra = Object.keys(answers).find((k) => !allowed.has(k));
  if (extra) return { error: `unexpected item ${extra}` };
  return { rows, clear };
}

// Server-side view of survey_items.json (the single source of survey wording/structure; the browser
// fetches the same file). Draws the per-session item order, validates one submitted block and turns
// it into Response rows. Scores are stored as given; reverse coding is an analysis step.

import crypto from "crypto";
import SURVEY from "../survey_items.json" with { type: "json" };
import { otherItemId, otherLabelOf, optionsOf, rangeOf, conditionalText, referencedItemIds } from "../src/survey-shared.js";
import { OE_MIN_CHARS } from "./config.js";

export { SURVEY };
const MAX_OTHER_TEXT = 500;
const MAX_OE_TEXT = 3000;
export const PHASES = ["pre", "mid", "post"]; // mid = the self-rating between the answer and the feedback

// Order in which one block's items are shown. Items move only within their own group (items without a
// group form one pool); "fixed" items never move; "shuffle": false keeps the config order.
export function orderBlock(block, randomInt = crypto.randomInt) {
  const ids = block.items.map((it) => it.id);
  if (block.shuffle === false) return ids;
  const pools = new Map(); // group -> positions of its movable items
  block.items.forEach((it, i) => {
    if (it.fixed) return;
    const key = it.group ?? "";
    if (!pools.has(key)) pools.set(key, []);
    pools.get(key).push(i);
  });
  const out = [...ids];
  for (const positions of pools.values()) {
    const movable = positions.map((i) => ids[i]);
    for (let i = movable.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [movable[i], movable[j]] = [movable[j], movable[i]];
    }
    positions.forEach((pos, k) => { out[pos] = movable[k]; });
  }
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

export const CONDITION_SOURCE_IDS = referencedItemIds(SURVEY);
export const blockHasConditional = (block) => block.items.some((it) => it.conditional);

// answers: { item_id: value, [item_id + "_other"]: text }
// order:   the session's stored item order for this block (display_order comes from it)
// values:  earlier answers { item_id: value } for items with a conditional wording
// -> { rows: [{ scale_id, block_id, item_id, value, display_order, shown_text }], clear: [item_id] }  or  { error }
//    clear = "_other" rows to delete because the other option is no longer picked (on re-submission)
export function validateBlock(phase, blockId, answers, order = null, values = {}) {
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
    const type = item.type ?? "likert";
    let value = v;
    switch (type) {
      case "likert":
      case "semantic":
      case "number": {
        const [min, max] = rangeOf(item, block);
        if (!Number.isInteger(v) || v < min || v > max) return bad(`must be an integer ${min}–${max}`);
        break;
      }
      case "single":
        if (!optionsOf(item).includes(v)) return bad("not one of the options");
        break;
      case "multi": {
        const opts = optionsOf(item);
        if (!Array.isArray(v) || !v.length || new Set(v).size !== v.length || !v.every((o) => opts.includes(o))) {
          return bad("choose at least one option");
        }
        break;
      }
      case "text": {
        value = typeof v === "string" ? v.trim() : "";
        if ([...value].length < OE_MIN_CHARS) return bad(`at least ${OE_MIN_CHARS} characters`);
        if (value.length > MAX_OE_TEXT) return bad("too long");
        break;
      }
      default:
        return bad(`unsupported type ${type}`);
    }
    // the wording the participant actually saw, for items that depend on earlier answers
    let shown = null;
    if (item.conditional) {
      shown = conditionalText(item, values);
      if (shown === null) return bad("earlier answers needed for this question are missing");
    }
    rows.push({ scale_id: item.scale ?? block.scale, block_id: block.block, item_id: item.id, value, display_order: position(item.id), shown_text: shown });

    const other = otherLabelOf(item);
    const picked = Array.isArray(v) ? v : [v];
    if (other && picked.includes(other)) {
      const oid = otherItemId(item.id);
      allowed.add(oid);
      const t = typeof answers[oid] === "string" ? answers[oid].trim() : "";
      if (!t || t.length > MAX_OTHER_TEXT) return bad(`${other}: 내용을 입력해주세요`);
      rows.push({ scale_id: item.scale ?? block.scale, block_id: block.block, item_id: oid, value: t, display_order: position(item.id), shown_text: null });
    } else if (other) {
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

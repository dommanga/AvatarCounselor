// codebook.csv from survey_items.json: one row per item, in config order, with everything an analysis needs to score it
// (scale, subscale, range, anchors, reverse, check, fixed). Scores are stored raw, so reverse = true means
// "apply (min + max) - x at analysis". Shared by scripts/codebook.js and the export (lib/export.js).

import { SURVEY } from "./survey.js";
import { rangeOf, anchorsOf, optionsOf } from "../src/survey-shared.js";

const COLUMNS = ["survey_version", "phase", "block", "id", "scale", "subscale", "group", "stem", "text", "format", "options", "range", "anchors", "reverse", "check", "fixed"];
const plain = (s) => String(s ?? "").replace(/\*\*/g, ""); // **bold** markers are display only

function itemText(item, anchors) {
  if (item.conditional) return `[다를 때] ${plain(item.conditional.different)} [같을 때] ${plain(item.conditional.same)}`;
  if (item.type === "semantic") { const [lo, hi] = Object.values(anchors); return `${lo} ↔ ${hi}`; }
  return plain(item.text);
}

export const codebookVersion = SURVEY.version;
const rows = [];
for (const phase of ["pre", "mid", "post"]) {
  for (const block of SURVEY[phase] || []) {
    const groups = new Map((block.groups || []).map((g) => [g.id, g]));
    for (const item of block.items) {
      const type = item.type ?? "likert";
      const scaled = type === "likert" || type === "semantic";
      const range = item.range ?? block.range;
      const anchors = anchorsOf(item, block);
      rows.push({
        survey_version: SURVEY.version, phase, block: block.block, id: item.id, scale: item.scale ?? block.scale,
        subscale: item.subscale ?? "", group: item.group ?? "",
        stem: plain(groups.get(item.group)?.stem ?? block.stem ?? ""),
        text: itemText(item, anchors), format: type,
        options: type === "single" || type === "multi" ? optionsOf(item).join("|") : "",
        range: range ? `${range[0]}-${range[1]}` : "",
        anchors: scaled ? Object.entries(anchors).map(([v, t]) => `${v}=${t}`).join(";") : "",
        reverse: scaled ? String(item.reverse ?? false) : "",
        check: item.check ? `correct=${[].concat(item.check.correct).join("|")}` : "",
        fixed: String(item.fixed ?? false),
      });
    }
  }
}

const cell = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const csv = [COLUMNS.join(","), ...rows.map((r) => COLUMNS.map((c) => cell(String(r[c]))).join(","))].join("\n") + "\n";

export const codebookCsv = () => csv;
export const codebookItems = () => rows.length;

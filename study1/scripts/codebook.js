// Generates codebook.csv from survey_items.json: one row per item, in config order, with everything an
// analysis needs to score it (scale, subscale, range, anchors, reverse, check, fixed). Scores are stored
// raw, so reverse = true means "apply (min + max) - x at analysis" (e.g. 8 - x on a 1-7 scale).
//   npm run codebook                 # writes codebook.csv
//   npm run codebook -- --check      # exits 1 if codebook.csv is not up to date with survey_items.json
//   npm run codebook -- --out <file> [--bom]     (--bom: UTF-8 BOM, for Excel on Windows)

import fs from "fs";
import { parseArgs } from "node:util";
import { codebookCsv, codebookItems, codebookVersion } from "../lib/codebook.js";

const { values } = parseArgs({ options: { out: { type: "string" }, check: { type: "boolean", default: false }, bom: { type: "boolean", default: false } } });
const outFile = values.out ? new URL(`file://${process.cwd()}/${values.out}`) : new URL("../codebook.csv", import.meta.url);

const content = (values.bom ? "\uFEFF" : "") + codebookCsv();

if (values.check) {
  const current = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : null;
  if (current !== content) { console.error("codebook.csv is out of date: run `npm run codebook`"); process.exit(1); }
  console.log(`codebook.csv is up to date (${codebookItems()} items, survey ${codebookVersion})`);
} else {
  fs.writeFileSync(outFile, content);
  console.log(`${outFile.pathname}: ${codebookItems()} items, survey ${codebookVersion}`);
}

// Checks that every wording key the page uses exists in src/copy.js: data-copy / data-copy-list in index.html and
// COPY.<key> in src/*.js and the API. (A stale save of copy.js once dropped keys; the page then shows empty texts.)
//   npm run check:copy

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COPY } from "../src/copy.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// -> [{ key, where }] keys that are used but missing
export function missingCopyKeys() {
  const used = [];
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  for (const m of html.matchAll(/data-copy(?:-list)?="(\w+)"/g)) if (m[1] !== "key") used.push({ key: m[1], where: "index.html" });
  const files = [...fs.readdirSync(path.join(ROOT, "src")).filter((f) => f.endsWith(".js") && f !== "copy.js").map((f) => `src/${f}`), "api/session/[action].js"];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    for (const m of src.matchAll(/\bCOPY\.(\w+)(?!\w|\?)/g)) used.push({ key: m[1], where: f }); // COPY.x?.… marks an optional key
  }
  const seen = new Set();
  return used.filter(({ key, where }) => !(key in COPY) && !seen.has(key + where) && seen.add(key + where));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const missing = missingCopyKeys();
  if (missing.length) { console.error("missing in src/copy.js:\n" + missing.map((m) => `  ${m.key}  (used in ${m.where})`).join("\n")); process.exit(1); }
  console.log(`copy.js has every key the page uses (${Object.keys(COPY).length} keys)`);
}

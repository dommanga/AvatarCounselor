// Renders one survey block from survey_items.json. All wording comes from the config; items appear in
// the order the caller gives (the session's stored order). Every item is required; the caller decides
// what to do with the `missing` list (highlight + block submission).
// Item types: likert / semantic (a scale with labels under chosen numbers), single, multi, number, text.

import { escapeHtml } from "./shared.js";
import { otherItemId, otherLabelOf, optionsOf, rangeOf, anchorsOf, conditionalText } from "./survey-shared.js";
import { COPY } from "./copy.js";

export async function loadSurveyConfig() {
  const r = await fetch("/survey_items.json", { cache: "no-cache" });
  if (!r.ok) throw new Error(`survey_items.json: HTTP ${r.status}`);
  return r.json();
}

// **bold** -> <strong>; everything else is escaped
export const richText = (s) => escapeHtml(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

// A row of numbered choices with the anchor labels under their numbers (e.g. 1 / 4 / 7 on a 1-7 scale).
function scaleHtml(id, item, block) {
  const [min, max] = rangeOf(item, block);
  const n = max - min + 1;
  const pills = Array.from({ length: n }, (_, k) => {
    const v = min + k;
    return `<label><input type="radio" name="${id}" value="${v}"><span class="pill">${v}</span></label>`;
  }).join("");
  const labels = Object.entries(anchorsOf(item, block)).map(([value, text]) => {
    const col = Number(value) - min + 1;
    const align = col === 1 ? "start" : col === n ? "end" : "center";
    return `<span class="anchor" style="grid-column:${col};justify-self:${align}">${richText(text)}</span>`;
  }).join("");
  return `<div class="scale" style="--n:${n}"><div class="pills">${pills}</div><div class="anchors">${labels}</div></div>`;
}

function itemHtml(block, item, ctx) {
  const id = escapeHtml(item.id);
  const type = item.type ?? "likert";
  const other = otherLabelOf(item);
  const otherBox = other
    ? `<input type="text" class="othertext hidden" data-other-for="${id}" maxlength="500" placeholder="직접 입력" aria-label="${escapeHtml(other)} 내용">`
    : "";
  let body;
  switch (type) {
    case "likert":
    case "semantic":
      body = scaleHtml(id, item, block);
      break;
    case "single":
    case "multi": {
      const kind = type === "single" ? "radio" : "checkbox";
      body = `<div class="choices">${optionsOf(item).map((o) =>
        `<label class="choice"><input type="${kind}" name="${id}" value="${escapeHtml(o)}"> <span>${escapeHtml(o)}</span></label>`).join("")}
        ${otherBox}</div>`;
      break;
    }
    case "number": {
      const [, max] = rangeOf(item, block);
      body = `<input type="text" class="numinput" name="${id}" inputmode="numeric" autocomplete="off" maxlength="${String(max).length}">`;
      break;
    }
    case "text":
      body = `<textarea class="oetext" name="${id}" rows="5" maxlength="3000" placeholder="${escapeHtml(COPY.surveyTextPlaceholder(ctx.oeMinChars))}"></textarea>`;
      break;
    default:
      body = `<div class="err">지원하지 않는 문항 형식: ${escapeHtml(type)}</div>`;
  }
  const text = item.conditional ? conditionalText(item, ctx.values) : item.text;
  const label = text ? `<div class="qlabel">${richText(text)}</div>` : "";
  const hint = item.hint ? `<div class="hint">${richText(item.hint)}</div>` : "";
  return `<div class="evalitem" data-item="${id}">${label}${hint}${body}</div>`;
}

// ctx: { values: earlier answers {item_id: value}, oeMinChars }
export function renderSurveyBlock(container, block, { values = {}, oeMinChars = 5 } = {}) {
  const ctx = { values, oeMinChars };
  const groups = new Map((block.groups || []).map((g) => [g.id, g]));
  let html = block.stem ? `<div class="blockstem">${richText(block.stem)}</div>` : "";
  let lastGroup;
  for (const item of block.items) {
    if (item.group !== lastGroup) { // a group's stem heads its run of items; fixed items (no group) sit between groups
      const stem = groups.get(item.group)?.stem;
      if (stem) html += `<div class="groupstem">${richText(stem)}</div>`;
      lastGroup = item.group;
    }
    html += itemHtml(block, item, ctx);
  }
  container.innerHTML = html;

  const q = (sel) => container.querySelector(sel);
  const qa = (sel) => [...container.querySelectorAll(sel)];
  const byName = (id) => qa("input, textarea").filter((i) => i.name === id);
  const otherBox = (id) => qa(".othertext").find((i) => i.dataset.otherFor === id);

  // show the free-text box only while the "other" option is picked; clear an item's highlight once it's touched
  container.addEventListener("input", (e) => {
    const box = e.target.closest(".evalitem");
    const item = block.items.find((it) => it.id === box?.dataset.item);
    const other = item && otherLabelOf(item);
    if (other) {
      const on = byName(item.id).some((i) => i.checked && i.value === other);
      const ob = otherBox(item.id);
      ob.classList.toggle("hidden", !on);
      if (on && e.target !== ob && e.target.value === other) ob.focus();
    }
    box?.classList.remove("missing");
  });

  function collect() {
    const answers = {};
    const missing = [];
    for (const item of block.items) {
      const type = item.type ?? "likert";
      let v;
      const checked = byName(item.id).filter((i) => i.checked).map((i) => i.value);
      if (type === "likert" || type === "semantic") v = checked.length ? Number(checked[0]) : undefined;
      else if (type === "single") v = checked[0];
      else if (type === "multi") v = checked.length ? checked : undefined;
      else if (type === "number") {
        const [min, max] = rangeOf(item, block);
        const raw = byName(item.id)[0].value.trim();
        const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
        v = n >= min && n <= max ? n : undefined;
      } else if (type === "text") {
        const t = byName(item.id)[0].value.trim();
        v = [...t].length >= oeMinChars ? t : undefined;
      }
      let ok = v !== undefined;
      if (ok) answers[item.id] = v;
      const other = otherLabelOf(item);
      if (ok && other && [].concat(v).includes(other)) {
        const t = otherBox(item.id).value.trim();
        if (t) answers[otherItemId(item.id)] = t;
        else ok = false;
      }
      if (!ok) missing.push(item.id);
    }
    return { answers, missing };
  }

  function markMissing(ids) {
    qa(".evalitem").forEach((el) => el.classList.toggle("missing", ids.includes(el.dataset.item)));
    if (ids.length) q(`.evalitem[data-item="${CSS.escape(ids[0])}"]`).scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // dev mode (test sessions): random valid answers
  function fillRandom() {
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    for (const item of block.items) {
      const type = item.type ?? "likert";
      const inputs = byName(item.id);
      if (type === "number") { const [min, max] = rangeOf(item, block); inputs[0].value = String(min + Math.floor(Math.random() * (max - min + 1))); }
      else if (type === "text") inputs[0].value = "테스트 응답입니다. 자동으로 채운 내용입니다.";
      else if (type === "multi") {
        inputs.forEach((i) => { i.checked = Math.random() < 0.3; });
        if (!inputs.some((i) => i.checked)) inputs[0].checked = true;
      } else pick(inputs).checked = true; // likert, semantic, single
      const other = otherLabelOf(item);
      if (other && inputs.some((i) => i.checked && i.value === other)) {
        otherBox(item.id).classList.remove("hidden");
        otherBox(item.id).value = "테스트";
      }
    }
    markMissing([]);
  }

  return { collect, markMissing, fillRandom };
}

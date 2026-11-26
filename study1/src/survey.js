// Renders one survey block from survey_items.json. All wording comes from the config; item order is
// the config order (no randomization). Every item is required; the caller decides what to do with
// the `missing` list (highlight + block submission).

import { escapeHtml } from "./shared.js";
import { OTHER_LABEL, otherItemId, optionsOf, AGE_RANGE } from "./survey-shared.js";

export async function loadSurveyConfig() {
  const r = await fetch("/survey_items.json", { cache: "no-cache" });
  if (!r.ok) throw new Error(`survey_items.json: HTTP ${r.status}`);
  return r.json();
}

function itemHtml(block, item) {
  const id = escapeHtml(item.id);
  const otherBox = item.other
    ? `<input type="text" class="othertext hidden" data-other-for="${id}" maxlength="500" placeholder="직접 입력" aria-label="${escapeHtml(OTHER_LABEL)} 내용">`
    : "";
  let body;
  switch (item.type) {
    case undefined: { // Likert: numbers min..max with the two end labels
      const { min, max, minLabel, maxLabel } = block.scale;
      const nums = Array.from({ length: max - min + 1 }, (_, k) => min + k);
      body = `<div class="likert">
        <span class="anchor">${escapeHtml(minLabel)}</span>
        <div class="likert-opts">${nums.map((n) =>
          `<label><input type="radio" name="${id}" value="${n}"><span class="pill">${n}</span></label>`).join("")}</div>
        <span class="anchor">${escapeHtml(maxLabel)}</span>
      </div>`;
      break;
    }
    case "single":
    case "multi": {
      const kind = item.type === "single" ? "radio" : "checkbox";
      body = `<div class="choices">${optionsOf(item).map((o) =>
        `<label class="choice"><input type="${kind}" name="${id}" value="${escapeHtml(o)}"> <span>${escapeHtml(o)}</span></label>`).join("")}
        ${otherBox}</div>`;
      break;
    }
    case "number":
      body = `<input type="text" class="numinput" name="${id}" inputmode="numeric" autocomplete="off" maxlength="3">`;
      break;
    default:
      body = `<div class="err">지원하지 않는 문항 형식: ${escapeHtml(item.type)}</div>`;
  }
  return `<div class="evalitem" data-item="${id}"><div class="qlabel">${escapeHtml(item.text)}</div>${body}</div>`;
}

export function renderSurveyBlock(container, block) {
  container.innerHTML = block.items.map((it) => itemHtml(block, it)).join("");
  const q = (sel) => container.querySelector(sel);
  const qa = (sel) => [...container.querySelectorAll(sel)];
  const byName = (id) => qa("input").filter((i) => i.name === id);
  const otherBox = (id) => qa(".othertext").find((i) => i.dataset.otherFor === id);

  // show the free-text box only while 기타 is picked; clear an item's highlight once it's touched
  container.addEventListener("input", (e) => {
    const box = e.target.closest(".evalitem");
    const item = block.items.find((it) => it.id === box?.dataset.item);
    if (item?.other) {
      const on = byName(item.id).some((i) => i.checked && i.value === OTHER_LABEL);
      const ob = otherBox(item.id);
      ob.classList.toggle("hidden", !on);
      if (on && e.target !== ob && e.target.value === OTHER_LABEL) ob.focus();
    }
    box?.classList.remove("missing");
  });

  function collect() {
    const answers = {};
    const missing = [];
    for (const item of block.items) {
      let v;
      const checked = byName(item.id).filter((i) => i.checked).map((i) => i.value);
      if (item.type === undefined) v = checked.length ? Number(checked[0]) : undefined;
      else if (item.type === "single") v = checked[0];
      else if (item.type === "multi") v = checked.length ? checked : undefined;
      else if (item.type === "number") {
        const raw = byName(item.id)[0].value.trim();
        const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
        v = n >= AGE_RANGE[0] && n <= AGE_RANGE[1] ? n : undefined;
      }
      let ok = v !== undefined;
      if (ok) answers[item.id] = v;
      if (ok && item.other && [].concat(v).includes(OTHER_LABEL)) {
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
      const inputs = byName(item.id);
      if (item.type === "number") inputs[0].value = String(20 + Math.floor(Math.random() * 10));
      else if (item.type === "multi") inputs.forEach((i) => { i.checked = Math.random() < 0.3; });
      if (item.type === "multi" && !inputs.some((i) => i.checked)) inputs[0].checked = true;
      if (item.type === undefined || item.type === "single") pick(inputs).checked = true;
      if (item.other && inputs.some((i) => i.checked && i.value === OTHER_LABEL)) {
        otherBox(item.id).classList.remove("hidden");
        otherBox(item.id).value = "테스트";
      }
    }
    markMissing([]);
  }

  return { collect, markMissing, fillRandom };
}

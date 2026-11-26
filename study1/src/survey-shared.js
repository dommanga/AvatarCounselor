// Survey rules shared by the browser renderer and the server validator (no deps).
// Wording/structure lives only in survey_items.json.

export const OTHER_LABEL = "기타";                    // default label of the free-text option when "other": true
export const otherItemId = (itemId) => `${itemId}_other`; // free text of an "other" option

// The option that opens a free-text box: "other": true -> 기타, "other": "<label>" -> that label, otherwise none.
export const otherLabelOf = (item) => (item.other === true ? OTHER_LABEL : typeof item.other === "string" ? item.other : null);

// Options as rendered: the "other" option is appended unless the list already has it.
export function optionsOf(item) {
  const opts = item.options || [];
  const other = otherLabelOf(item);
  return other && !opts.includes(other) ? [...opts, other] : opts;
}

// An item inherits range / anchors from its block unless it sets its own (semantic-differential items do).
export const rangeOf = (item, block) => item.range ?? block.range;
export const anchorsOf = (item, block) => item.anchors ?? block.anchors ?? {};

// A block with its items in the order stored for this session (config order if there is none).
export function applyOrder(block, order) {
  if (!Array.isArray(order)) return block;
  const byId = new Map(block.items.map((it) => [it.id, it]));
  const items = order.map((id) => byId.get(id)).filter(Boolean);
  return items.length === block.items.length ? { ...block, items } : block;
}

// Text of an item whose wording depends on earlier answers (OE1): "conditional": { vars: { name: itemId },
// compare: [a, b], same, different } with {name} placeholders. -> the text, or null while a value is missing.
// Used by the page to show the text and by the server to store exactly what was shown.
export function conditionalText(item, values) {
  const c = item.conditional;
  if (!c) return item.text ?? "";
  const v = Object.fromEntries(Object.entries(c.vars).map(([name, id]) => [name, values?.[id]]));
  if (Object.values(v).some((x) => x === undefined || x === null)) return null;
  const template = v[c.compare[0]] === v[c.compare[1]] ? c.same : c.different;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(v[name]));
}

// Item ids whose answers conditional items depend on.
export function referencedItemIds(config) {
  const ids = new Set();
  for (const phase of ["pre", "mid", "post"]) {
    for (const block of config[phase] || []) {
      for (const item of block.items) for (const id of Object.values(item.conditional?.vars ?? {})) ids.add(id);
    }
  }
  return [...ids];
}

// Survey rules shared by the browser renderer and the server validator (no deps).
// Wording/structure lives only in survey_items.json.

export const OTHER_LABEL = "기타";
export const otherItemId = (itemId) => `${itemId}_other`; // free text for "other": true items
export const AGE_RANGE = [1, 120]; // sanity bound for type "number" (catches typos, not eligibility)

// Options as rendered: "other": true appends 기타 unless the list already has it.
export function optionsOf(item) {
  const opts = item.options || [];
  return item.other && !opts.includes(OTHER_LABEL) ? [...opts, OTHER_LABEL] : opts;
}

// A block with its items in the order stored for this session (config order if there is none).
export function applyOrder(block, order) {
  if (!Array.isArray(order)) return block;
  const byId = new Map(block.items.map((it) => [it.id, it]));
  const items = order.map((id) => byId.get(id)).filter(Boolean);
  return items.length === block.items.length ? { ...block, items } : block;
}

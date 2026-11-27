// Content equality that ignores object key order. Values read back from Postgres jsonb come with their keys re-sorted,
// so JSON.stringify(dbValue) === JSON.stringify(jsValue) is wrong for objects: use this.

const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
export const sameContent = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

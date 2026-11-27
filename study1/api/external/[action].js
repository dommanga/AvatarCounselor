// External management API (for a later Apps Script). Header X-Admin-Secret = ADMIN_API_SECRET (separate from the login password).
//   POST /api/external/issue   { n, batch_id, expires_at? }     -> [{ participant_id, link }]
//   POST /api/external/status  { participant_ids: [...] }       -> [{ participant_id, status, current_stage, completed_at, valid }]
// Nothing else is reachable here: no purge, resume or condition change. Requests carrying personal-looking fields are refused.
// Limits: 30 calls per minute in all; 5 wrong secrets per IP in 10 minutes. Calls are written to audit_log (actor 'api').

import crypto from "crypto";
import { db } from "../../lib/db.js";
import { issueTokens } from "../../lib/issue.js";
import { sweep } from "../../lib/lifecycle.js";

const MAX_CALLS_PER_MIN = 30;
const MAX_WRONG_PER_IP = 5;
const MAX_IDS = 500;
const ALLOWED = { issue: ["n", "batch_id", "expires_at"], status: ["participant_ids"] };
// keys (at any depth) that look like personal data
const PERSONAL = /(phone|mobile|tel\b|cell|name|email|e-mail|mail|address|addr|birth|dob|ssn|resident|jumin|student_?id|contact|연락|전화|이름|성명|주소|이메일|학번|생년|주민)/i;

const httpError = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const clientIp = (req) => (String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "unknown");

export function personalKey(value, depth = 0) {
  if (depth > 5 || value === null || typeof value !== "object") return null;
  for (const [k, v] of Object.entries(value)) {
    if (PERSONAL.test(k)) return k;
    const inner = personalKey(v, depth + 1);
    if (inner) return inner;
  }
  return null;
}

function secretOk(req) {
  const want = process.env.ADMIN_API_SECRET;
  const got = String(req.headers["x-admin-secret"] || "");
  if (!want) return null; // not configured
  const A = Buffer.from(crypto.createHash("sha256").update(got).digest("hex")), B = Buffer.from(crypto.createHash("sha256").update(want).digest("hex"));
  return crypto.timingSafeEqual(A, B);
}

const ROUTES = {
  async issue(req, body) {
    const n = Number(body.n);
    const base = (process.env.STUDY1_BASE_URL || `https://${req.headers["x-forwarded-host"] || req.headers.host}`).replace(/\/+$/, "");
    const r = await issueTokens({ n, batch: body.batch_id, expires: body.expires_at ?? null, test: false, actor: "api" });
    return r.rows.map((x) => ({ participant_id: x.participant_id, link: `${base}/s/${x.token}` }));
  },
  async status(req, body) {
    const ids = body.participant_ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > MAX_IDS || !ids.every((i) => typeof i === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(i))) {
      throw httpError(400, `participant_ids must be 1–${MAX_IDS} participant ids`);
    }
    await sweep(null);
    const rows = await db()`SELECT participant_id, status, current_stage, completed_at, valid FROM sessions WHERE participant_id = ANY(${ids}::text[])`;
    const found = new Map(rows.map((r) => [r.participant_id, r]));
    return ids.map((id) => found.get(id) ?? { participant_id: id, status: "not_found", current_stage: null, completed_at: null, valid: null });
  },
};

export default async function handler(req, res) {
  const action = req.query.action;
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST" || !ROUTES[action]) return res.status(404).json({ error: "not found" });
  try {
    const ok = secretOk(req);
    if (ok === null) return res.status(503).json({ error: "external API is not configured" });
    const sql = db();
    const ip = clientIp(req);
    if (!ok) {
      const wrongKey = `api:${ip}`;
      const [w] = await sql`SELECT count(*)::int AS n FROM admin_login_failures WHERE ip = ${wrongKey} AND ts > now() - interval '10 minutes'`;
      if (w.n >= MAX_WRONG_PER_IP) return res.status(429).json({ error: "too many failed attempts" });
      await sql`INSERT INTO admin_login_failures (ip) VALUES (${wrongKey})`;
      return res.status(401).json({ error: "unauthorized" });
    }
    const [c] = await sql`SELECT count(*)::int AS n FROM audit_log WHERE actor = 'api' AND action LIKE 'api\\_%' AND ts > now() - interval '1 minute'`;
    if (c.n >= MAX_CALLS_PER_MIN) { res.setHeader("retry-after", "60"); return res.status(429).json({ error: "rate limit: 30 calls per minute" }); }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const personal = personalKey(body);
    if (personal) return res.status(400).json({ error: `refused: the field "${personal}" looks like personal data; this API takes no personal data` });
    const extra = Object.keys(body).filter((k) => !ALLOWED[action].includes(k));
    if (extra.length) return res.status(400).json({ error: `unknown field(s): ${extra.join(", ")}` });
    await sql`INSERT INTO audit_log (actor, action, detail) VALUES ('api', ${"api_" + action}, ${JSON.stringify({ ip_hash: crypto.createHash("sha256").update(ip).digest("hex").slice(0, 12) })}::jsonb)`;
    return res.status(200).json(await ROUTES[action](req, body));
  } catch (e) {
    if (!e.status) console.error(`[external/${action}]`, e);
    return res.status(e.status || 500).json({ error: String(e?.message || e) });
  }
}

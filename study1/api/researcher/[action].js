// Researcher API (password-protected via cookie). The cookie gates /admin and the dev "API 테스트" view.
//   POST /api/researcher/login     { password }     5 failures per IP in 10 minutes lock the login for the rest of that window
//   POST /api/researcher/logout

import { checkPassword, setResearcherCookie, clearResearcherCookie } from "../../lib/auth.js";
import { db } from "../../lib/db.js";

export const LOGIN_WINDOW_MIN = 10;
export const LOGIN_MAX_FAILURES = 5;      // per IP within the window
const LOGIN_MAX_FAILURES_ALL = 30;        // all IPs together

export default async function handler(req, res) {
  const action = req.query.action;
  const route = { "POST login": login, "POST logout": logout }[`${req.method} ${action}`];
  if (!route) return res.status(404).json({ error: "not found" });
  try {
    return await route(req, res);
  } catch (e) {
    console.error(`[researcher/${action}]`, e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}

const clientIp = (req) => (String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "unknown");

async function login(req, res) {
  const sql = db();
  const ip = clientIp(req);
  const [w] = await sql`
    SELECT count(*) FILTER (WHERE ip = ${ip})::int AS mine, count(*)::int AS all,
           ceil(extract(epoch from (min(ts) FILTER (WHERE ip = ${ip}) + make_interval(mins => ${LOGIN_WINDOW_MIN}) - now())))::int AS wait_s
    FROM admin_login_failures WHERE ts > now() - make_interval(mins => ${LOGIN_WINDOW_MIN})`;
  if (w.mine >= LOGIN_MAX_FAILURES || w.all >= LOGIN_MAX_FAILURES_ALL) {
    const wait = Math.max(w.wait_s ?? LOGIN_WINDOW_MIN * 60, 1);
    res.setHeader("retry-after", String(wait));
    return res.status(429).json({ error: `로그인 시도가 너무 많습니다. ${Math.ceil(wait / 60)}분 뒤에 다시 시도해 주세요.`, retry_after_s: wait });
  }
  if (!checkPassword(req.body?.password)) {
    await sql`INSERT INTO admin_login_failures (ip) VALUES (${ip})`;
    await sql`DELETE FROM admin_login_failures WHERE ts < now() - interval '1 day'`;
    await new Promise((r) => setTimeout(r, 800)); // slow down guessing
    return res.status(401).json({ error: "비밀번호가 올바르지 않습니다.", attempts_left: Math.max(LOGIN_MAX_FAILURES - w.mine - 1, 0) });
  }
  await sql`DELETE FROM admin_login_failures WHERE ip = ${ip}`;
  setResearcherCookie(res);
  return res.status(200).json({ ok: true });
}

async function logout(req, res) {
  clearResearcherCookie(res);
  return res.status(200).json({ ok: true });
}

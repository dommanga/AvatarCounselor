// Researcher API (password-protected via cookie). The cookie gates the dev "API 테스트" view.
//   POST /api/researcher/login     { password }
//   POST /api/researcher/logout

import { checkPassword, setResearcherCookie, clearResearcherCookie } from "../../lib/auth.js";

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

async function login(req, res) {
  if (!checkPassword(req.body?.password)) {
    await new Promise((r) => setTimeout(r, 800)); // slow down guessing
    return res.status(401).json({ error: "비밀번호가 올바르지 않습니다." });
  }
  setResearcherCookie(res);
  return res.status(200).json({ ok: true });
}

async function logout(req, res) {
  clearResearcherCookie(res);
  return res.status(200).json({ ok: true });
}

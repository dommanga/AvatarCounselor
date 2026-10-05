// Researcher API (password-protected via cookie, except login).
//   POST /api/researcher/login     { password }
//   POST /api/researcher/logout
//   GET  /api/researcher/overview  -> { sessions, sequence, next }
//   POST /api/researcher/create    { participant_id, condition, is_test, slot, client_ts }
//   POST /api/researcher/resume    { session_id }
// create/resume hand the device over to the participant: they return a participant token and clear
// the researcher cookie, so /researcher on that device asks for the password again.

import crypto from "crypto";
import { db, isUniqueViolation } from "../../lib/db.js";
import {
  checkPassword, setResearcherCookie, clearResearcherCookie, requireResearcher, newParticipantToken,
} from "../../lib/auth.js";
import { CONDITIONS } from "../../src/questions.js";

const PID_RE = /^[A-Za-z0-9_-]{1,32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  const action = req.query.action;
  const route = {
    "POST login": login, "POST logout": logout, "GET overview": overview,
    "POST create": create, "POST resume": resume,
  }[`${req.method} ${action}`];
  if (!route) return res.status(404).json({ error: "not found" });
  try {
    if (action !== "login" && action !== "logout" && !requireResearcher(req, res)) return;
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

// First slot not taken by a real session (test sessions never take one).
async function nextSlot(sql) {
  const [row] = await sql`
    SELECT b.slot, b.block, b.condition FROM block_sequence b
    WHERE NOT EXISTS (SELECT 1 FROM sessions s WHERE s.slot = b.slot)
    ORDER BY b.slot LIMIT 1`;
  return row ?? null;
}

async function overview(req, res) {
  const sql = db();
  const [sessions, sequence, next] = await Promise.all([
    sql`SELECT id, participant_id, condition, suggested_condition, slot, is_test, current_stage,
               created_at, updated_at
        FROM sessions ORDER BY created_at DESC`,
    sql`SELECT b.slot, b.block, b.condition, s.participant_id
        FROM block_sequence b LEFT JOIN sessions s ON s.slot = b.slot ORDER BY b.slot`,
    nextSlot(sql),
  ]);
  return res.status(200).json({ sessions, sequence, next });
}

async function create(req, res) {
  const { participant_id, condition, is_test = false, slot = null, client_ts = null } = req.body || {};
  const pid = String(participant_id ?? "").trim();
  if (!PID_RE.test(pid)) return res.status(400).json({ error: "참가자 ID는 영문/숫자/-/_ 1–32자입니다." });
  if (!CONDITIONS.includes(condition)) return res.status(400).json({ error: "조건이 올바르지 않습니다." });

  const sql = db();
  let useSlot = null, suggested = null;
  if (!is_test) {
    const next = await nextSlot(sql);
    // the form shows the slot it was suggesting; if another device created a session meanwhile, refuse
    if ((next?.slot ?? null) !== slot) {
      return res.status(409).json({ error: "다음 순번이 바뀌었습니다. 화면을 새로고침한 뒤 다시 시도해주세요." });
    }
    useSlot = next?.slot ?? null; // null = sequence exhausted (UI warns before allowing this)
    suggested = next?.condition ?? null;
  }

  const id = crypto.randomUUID();
  const { token, hash } = newParticipantToken();
  try {
    await sql.transaction([
      sql`INSERT INTO sessions (id, participant_id, condition, suggested_condition, slot, is_test, token_hash)
          VALUES (${id}, ${pid}, ${condition}, ${suggested}, ${useSlot}, ${!!is_test}, ${hash})`,
      sql`INSERT INTO events (id, session_id, type, client_ts)
          VALUES (${crypto.randomUUID()}, ${id}, 'session_created',
                  ${Number.isSafeInteger(client_ts) ? client_ts : null})`,
    ]);
  } catch (e) {
    if (isUniqueViolation(e)) {
      const msg = /participant/.test(e.constraint || e.message)
        ? `참가자 ID ${pid}로 만든 본 세션이 이미 있습니다.`
        : "다음 순번이 바뀌었습니다. 화면을 새로고침한 뒤 다시 시도해주세요.";
      return res.status(409).json({ error: msg });
    }
    throw e;
  }
  clearResearcherCookie(res);
  return res.status(200).json({ session_id: id, token });
}

// Re-issue the participant token (e.g. the tab was closed). The old token stops working.
async function resume(req, res) {
  const { session_id } = req.body || {};
  if (!UUID_RE.test(session_id || "")) return res.status(400).json({ error: "session_id required" });
  const { token, hash } = newParticipantToken();
  const rows = await db()`UPDATE sessions SET token_hash = ${hash}, updated_at = now()
                          WHERE id = ${session_id} RETURNING id`;
  if (!rows.length) return res.status(404).json({ error: "세션을 찾을 수 없습니다." });
  clearResearcherCookie(res);
  return res.status(200).json({ session_id, token });
}

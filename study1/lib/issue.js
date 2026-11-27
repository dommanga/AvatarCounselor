// Issues participant link tokens. Shared by scripts/issue-tokens.js and /admin (one implementation).
// The token itself is returned once and never stored (only its sha256); participant ids are numbered under a
// lock, so two issuances at the same time cannot hand out the same number.

import crypto from "crypto";
import { withTransaction } from "./db.js";
import { newParticipantToken } from "./auth.js";
import { weekEndKST } from "./lifecycle.js";
import { MODALITIES } from "./config.js";
import { CONDITIONS } from "../src/questions.js";

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

// n: how many; batch: e.g. W1; expires: Date | ISO string | null (default: Sunday 23:59:59 KST of this week);
// test: a test session (T1-xxx, preset stance + modality, no slot); actor: 'script' | 'admin'
// -> { rows: [{ participant_id, token }], expires_at: Date, test }
export async function issueTokens({ n, batch, expires = null, test = false, stance = null, modality = null, actor = "script" }) {
  const count = Number(n);
  if (!Number.isInteger(count) || count < 1 || count > 200) throw bad("개수는 1–200 사이의 정수입니다.");
  if (!/^[A-Za-z0-9_-]{1,16}$/.test(batch || "")) throw bad("batch는 영문·숫자·-·_ 1–16자입니다 (예: W1).");
  const expiresAt = expires ? new Date(expires) : weekEndKST();
  if (Number.isNaN(expiresAt.getTime())) throw bad("만료일 형식이 올바르지 않습니다.");
  if (expiresAt <= new Date()) throw bad("만료일이 이미 지났습니다.");
  if (test) {
    if (!CONDITIONS.includes(stance) || !MODALITIES.includes(modality)) throw bad(`테스트 세션은 stance(${CONDITIONS.join("|")})와 modality(${MODALITIES.join("|")})를 직접 지정해야 합니다.`);
  } else if (stance || modality) {
    throw bad("stance·modality 지정은 테스트 세션에만 쓸 수 있습니다 (실제 세션은 동의 시 배정됩니다).");
  }
  const prefix = test ? "T1" : "S1";

  const rows = await withTransaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext('study1_issue'))");
    const { rows: [{ max }] } = await c.query(
      "SELECT coalesce(max(substring(participant_id from '\\d+$')::int), 0) AS max FROM sessions WHERE participant_id LIKE $1", [`${prefix}-%`]);
    const out = [];
    for (let i = 1; i <= count; i++) {
      const pid = `${prefix}-${String(max + i).padStart(3, "0")}`;
      const id = crypto.randomUUID();
      const { token, hash } = newParticipantToken();
      await c.query(
        `INSERT INTO sessions (id, participant_id, batch_id, is_test, token_hash, expires_at, stance, modality)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, pid, batch, test, hash, expiresAt.toISOString(), test ? stance : null, test ? modality : null]);
      await c.query("INSERT INTO audit_log (actor, action, session_id, detail) VALUES ($1, 'issued', $2, $3)",
        [actor, id, JSON.stringify({ batch, expires_at: expiresAt.toISOString(), is_test: test })]);
      out.push({ participant_id: pid, token });
    }
    return out;
  });
  return { rows, expires_at: expiresAt, test };
}

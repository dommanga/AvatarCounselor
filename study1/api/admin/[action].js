// /admin API. Researcher cookie required (lib/auth.js; log in through POST /api/researcher/login).
//   GET  participants | participant?id | cells | slots | audit?actor&kind&participant_id&limit  (kind = audit action; `action` is the route) | issue_defaults
//   POST issue         { n, batch, expires?, test?, stance?, modality?, base_url }      -> [{ participant_id, link }]
//   POST extend        { id, expires_at, reason }       POST resume    { id, reason }
//   POST condition     { id, stance, modality, reason } POST target    { stance, modality, target }
//   POST slot_add      { stance, modality, reason }     POST slot_delete { seq, reason }
//   POST queue_dismiss { assignment_id, reason }
//   GET  stt_list?test&judged | stt_session?id | stt_audio?id&question_id&attempt (binary)     POST stt_judge { id, quality, note }
//   GET  purge_candidates?kind&test       POST purge_preview { kind, scope }  ->  plan_id     POST purge_execute { plan_id, count }
//   GET  export?incomplete&test (zip)
// No personal data in or out: participant ids, token states, conditions, progress records.

import { requireResearcher } from "../../lib/auth.js";
import { issueTokens } from "../../lib/issue.js";
import { weekEndKST } from "../../lib/lifecycle.js";
import * as A from "../../lib/admin.js";
import * as D from "../../lib/admin-data.js";
import { exportZip } from "../../lib/export.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const needId = (id) => { if (!UUID_RE.test(id || "")) throw Object.assign(new Error("id가 올바르지 않습니다."), { status: 400 }); return id; };

function linkBase(body, req) {
  const b = String(body?.base_url || "");
  if (/^https?:\/\/[^/\s]+$/.test(b)) return b; // the origin /admin itself is opened on: previews and production differ
  return `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
}

const ROUTES = {
  "GET participants": async () => ({ participants: await A.listParticipants() }),
  "GET participant": async (req) => A.participantDetail(needId(req.query.id)),
  "GET cells": async () => A.cellStats(),
  "GET slots": async () => A.listSlots(),
  "GET audit": async (req) => A.listAudit({ actor: req.query.actor || null, action: req.query.kind || null, participant_id: req.query.participant_id || null, limit: req.query.limit }),
  "GET issue_defaults": async () => ({ expires_at: weekEndKST().toISOString() }),
  "POST issue": async (req) => {
    const b = req.body || {};
    const r = await issueTokens({ n: b.n, batch: b.batch, expires: b.expires || null, test: !!b.test, stance: b.stance || null, modality: b.modality || null, actor: "admin" });
    const base = linkBase(b, req);
    return { expires_at: r.expires_at, test: r.test, rows: r.rows.map((x) => ({ participant_id: x.participant_id, link: `${base}/s/${x.token}` })) };
  },
  "POST extend": async (req) => A.extendExpiry({ ...req.body, id: needId(req.body?.id) }),
  "POST resume": async (req) => A.resumeSession({ ...req.body, id: needId(req.body?.id) }),
  "POST condition": async (req) => A.changeCondition({ ...req.body, id: needId(req.body?.id) }),
  "POST target": async (req) => A.setTarget(req.body || {}),
  "POST slot_add": async (req) => A.addSlot(req.body || {}),
  "POST slot_delete": async (req) => A.deleteSlot({ ...req.body, seq: Number(req.body?.seq) }),
  "GET stt_list": async (req) => ({ sessions: await D.sttList({ includeTest: req.query.test === "1", includeJudged: req.query.judged === "1" }) }),
  "GET stt_session": async (req) => D.sttSession(needId(req.query.id)),
  "GET stt_audio": async (req) => {
    const attempt = Number(req.query.attempt);
    if (!/^[\w-]{1,40}$/.test(req.query.question_id || "") || !Number.isInteger(attempt)) throw Object.assign(new Error("question_id / attempt가 올바르지 않습니다."), { status: 400 });
    return D.sttAudio({ id: needId(req.query.id), question_id: req.query.question_id, attempt });
  },
  "POST stt_judge": async (req) => D.sttJudge({ ...req.body, id: needId(req.body?.id) }),
  "GET purge_candidates": async (req) => D.purgeCandidates({ kind: req.query.kind, includeTest: req.query.test === "1" }),
  "POST purge_preview": async (req) => D.purgePreview(req.body || {}),
  "POST purge_execute": async (req) => D.purgeExecute(req.body || {}),
  "GET export": async (req) => {
    const x = await exportZip({ includeIncomplete: req.query.incomplete === "1", includeTest: req.query.test === "1", actor: "admin" });
    if (x.zip.length > 4 * 1024 * 1024) throw Object.assign(new Error("파일이 너무 커서 이 화면에서 받을 수 없습니다. npm run export를 사용해 주세요."), { status: 413 });
    return { binary: x.zip, mime: "application/zip", filename: x.name };
  },
  "POST queue_dismiss": async (req) => A.dismissQueueEntry({ ...req.body, assignment_id: Number(req.body?.assignment_id) }),
};

export default async function handler(req, res) {
  const action = req.query.action;
  const route = ROUTES[`${req.method} ${action}`];
  if (!route) return res.status(404).json({ error: "not found" });
  if (!requireResearcher(req, res)) return;
  res.setHeader("cache-control", "no-store");
  try {
    const out = await route(req);
    if (out?.binary) { // audio / zip
      res.setHeader("content-type", out.mime);
      if (out.filename) res.setHeader("content-disposition", `attachment; filename="${out.filename}"`);
      return res.status(200).end(out.binary);
    }
    return res.status(200).json(out);
  } catch (e) {
    if (!e.status) console.error(`[admin/${action}]`, e);
    return res.status(e.status || 500).json({ error: String(e?.message || e) });
  }
}

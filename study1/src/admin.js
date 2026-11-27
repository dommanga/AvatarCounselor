// /admin: operations screen of the researcher. Participant ids, token states, conditions and progress only.
// Left menu (participants / issue / cells / audit log); a row opens a detail panel on the right where everything
// about one participant is done; risky changes ask for a reason and are written to the audit log by the server.

import { paymentFormLink } from "./copy.js";
import { issuedCsv } from "./admin-csv.js";
import { CONDITIONS } from "./questions.js";

const MODALITIES = ["text", "voice"];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- formatting ----------
const KST = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hourCycle: "h23", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const kst = (ts) => Object.fromEntries(KST.formatToParts(new Date(ts)).map((p) => [p.type, p.value]));
const fmt = (ts) => { if (!ts) return ""; const p = kst(ts); return `${p.month}/${p.day} ${p.hour}:${p.minute}`; };
const fmtS = (ts) => { const p = kst(ts); return `${p.month}/${p.day} ${p.hour}:${p.minute}:${p.second}`; };
const sec = (ms) => (ms == null ? "–" : `${(ms / 1000).toFixed(1)}초`);
const toLocalInput = (iso) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 16); // KST wall clock for <input datetime-local>
const fromLocalInput = (v) => new Date(`${v}:00+09:00`).toISOString();

const STATUS = {
  issued: ["미접속", "gray"], opened: ["접속", "gray"], expired: ["만료", "gray"], consented: ["진행 중", "blue"], in_progress: ["진행 중", "blue"],
  completed: ["완료", "green"], locked: ["잠김", "red"], abandoned: ["이탈", "red"],
};
const badge = (text, cls) => `<span class="badge b-${cls}">${esc(text)}</span>`;
const statusBadge = (st) => badge(...STATUS[st] ?? [st, "gray"]);
const STAGE = {
  consent: "동의 전", device_test: "장치 테스트", pre_survey: "사전설문", notice: "진행 전 안내", scenario: "상황 안내", question_guide: "면접 연습 안내",
  q2_answering: "질문·답변", q2_selfrating: "자기평가", q2_feedback: "피드백", post_survey: "사후설문", debrief: "디브리핑", done: "완료",
};
const STT_LABEL = { none: "없음", minor: "경미", severe: "심각" };
const LOCK = { empty_answer: "빈 답변", tts_error: "음성 오류", resume_limit: "재접속 초과", admin: "관리자" };
const STANCE = { reversing: "Reversing", minimizing: "Minimizing", direct: "Direct" };
const flagBadges = (r) => [
  r.resume_count > 0 && badge(`재접속 ${r.resume_count}`, "gray"), r.retry_used && badge("재답변", "gray"), r.answer_short && badge("짧은 답변", "gray"),
  r.answer_truncated && badge("중단 제출", "gray"), r.stt_quality && badge(`STT ${STT_LABEL[r.stt_quality]}`, r.stt_quality === "severe" ? "red" : "gray"),
  r.audio_purged_at && badge(`원음 파기됨 ${fmt(r.audio_purged_at)}`, "gray"), r.data_purged_at && badge(`자료 파기됨 ${fmt(r.data_purged_at)}`, "gray"), r.lock_reason && badge(`잠금 ${LOCK[r.lock_reason] ?? r.lock_reason}`, "red"), r.destroy_pending && badge("파기 대기", "red"),
].filter(Boolean).join("");

// ---------- state + api ----------
const state = {
  view: "participants", participants: [], selected: null, detail: null, defaultExpiry: null, timelineAll: false,
  filter: { batch: "", status: "", test: false, cond: false }, sort: { key: "issued_at", dir: -1 }, issued: null,
};

async function api(method, path, body) {
  const r = await fetch(`/api/admin/${path}`, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) { showLogin(); throw Object.assign(new Error("login required"), { status: 401, silent: true }); }
  if (!r.ok) throw Object.assign(new Error(data.error || `HTTP ${r.status}`), { status: r.status });
  return data;
}

// ---------- login ----------
function showLogin() {
  $("app").classList.add("hidden");
  $("login").classList.remove("hidden");
  $("pw").focus();
}
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("loginErr").textContent = "";
  const r = await fetch("/api/researcher/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: $("pw").value }) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { $("loginErr").textContent = data.error || "로그인하지 못했습니다."; return; }
  $("pw").value = "";
  start();
});
$("logout").addEventListener("click", async () => { await fetch("/api/researcher/logout", { method: "POST" }); showLogin(); });

// ---------- dialog: confirm + reason (+ fields) ----------
// run(values) does the work; if it throws, the message shows in the dialog and it stays open. -> true when done
function ask({ title, text = "", fields = [], reason = true, ok = "확인", run }) {
  $("dlgTitle").textContent = title;
  $("dlgText").textContent = text;
  $("dlgFields").innerHTML = fields.map((f) => `<div class="field"><label for="df-${f.id}">${esc(f.label)}</label>${f.type === "select"
    ? `<select id="df-${f.id}">${f.options.map((o) => `<option value="${esc(o.value)}"${o.value === f.value ? " selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`
    : `<input id="df-${f.id}" type="${f.type || "text"}" value="${esc(f.value ?? "")}"${f.min != null ? ` min="${f.min}"` : ""} />`}</div>`).join("");
  $("dlgReasonRow").classList.toggle("hidden", !reason);
  $("dlgReason").value = "";
  $("dlgErr").textContent = "";
  $("dlgOk").textContent = ok;
  $("dlgOk").disabled = false;
  const dlg = $("dlg");
  dlg.showModal();
  return new Promise((resolve) => {
    const form = $("dlgForm");
    const done = (v) => { form.onsubmit = null; $("dlgCancel").onclick = null; dlg.close(); resolve(v); };
    $("dlgCancel").onclick = () => done(false);
    dlg.oncancel = () => done(false);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const values = Object.fromEntries(fields.map((f) => [f.id, $(`df-${f.id}`).value]));
      if (reason) {
        values.reason = $("dlgReason").value.trim();
        if (values.reason.length < 2) { $("dlgErr").textContent = "사유를 입력해 주세요."; return; }
      }
      $("dlgOk").disabled = true;
      try { await run(values); done(true); } catch (err) { if (!err.silent) { $("dlgErr").textContent = err.message; $("dlgOk").disabled = false; } }
    };
  });
}

// ---------- views ----------
function show(view) {
  state.view = view;
  for (const v of ["participants", "issue", "cells", "stt", "purge", "export", "audit"]) $(`v-${v}`).classList.toggle("hidden", v !== view);
  for (const a of document.querySelectorAll("nav.side a")) a.classList.toggle("active", a.dataset.view === view);
  if (view !== "participants") closePanel();
  refresh();
}
window.addEventListener("hashchange", () => show(location.hash.slice(1) || "participants"));

async function refresh() {
  if (state.view === "participants") await loadParticipants();
  else if (state.view === "issue") await loadIssueDefaults();
  else if (state.view === "cells") await loadCells();
  else if (state.view === "stt") await loadStt();
  else if (state.view === "purge") await loadPurgeCandidates();
  else if (state.view === "export") return;
  else await loadAudit();
}
setInterval(() => { if (!document.hidden && !$("dlg").open && !$("app").classList.contains("hidden")) refresh().catch(() => {}); }, 30_000);

// ===== participants =====
const COLS = [
  { key: "participant_id", label: "참가자", cell: (r) => esc(r.participant_id) + (r.is_test ? ` ${badge("테스트", "gray")}` : "") },
  { key: "batch_id", label: "batch", cell: (r) => esc(r.batch_id) },
  { key: "status", label: "상태", cell: (r) => statusBadge(r.status) },
  { key: "current_stage", label: "현재 단계", cell: (r) => esc(STAGE[r.current_stage] ?? r.current_stage) },
  { key: "consented_at", label: "동의", cell: (r) => fmt(r.consented_at), cls: "num" },
  { key: "last_activity_at", label: "마지막 활동", cell: (r) => fmt(r.last_activity_at), cls: "num" },
  { key: "completed_at", label: "완료", cell: (r) => fmt(r.completed_at), cls: "num" },
  { key: "valid", label: "valid", cell: (r) => (r.valid == null ? "" : r.valid ? "true" : badge("false", "red")) },
  { key: "flags", label: "플래그", sort: false, cell: (r) => `<span class="flags">${flagBadges(r)}</span>` },
  { key: "stance", label: "stance", cond: true, cell: (r) => esc(STANCE[r.stance] ?? "") },
  { key: "modality", label: "modality", cond: true, cell: (r) => esc(r.modality ?? "") },
];
const STATUS_FILTERS = [["", "상태 전체"], ["issued", "미접속"], ["opened", "접속(동의 전)"], ["expired", "만료"], ["active", "진행 중"], ["completed", "완료"], ["locked", "잠김"], ["abandoned", "이탈"]];
const QUICK = { unopened: "issued", active: "active", locked: "locked", done: "completed" };
const statusOk = (r, f) => !f || (f === "active" ? ["consented", "in_progress"].includes(r.status) : r.status === f);

function filtered() {
  const { batch, status, test } = state.filter;
  const { key, dir } = state.sort;
  const rows = state.participants.filter((r) => (test || !r.is_test) && (!batch || r.batch_id === batch) && statusOk(r, status));
  const val = (r) => r[key] ?? null;
  return rows.sort((a, b) => {
    const x = val(a), y = val(b);
    if (x === y) return a.participant_id < b.participant_id ? -1 : 1;
    if (x === null) return 1; // empty values last
    if (y === null) return -1;
    return (x < y ? -1 : 1) * dir;
  });
}

function renderParticipants() {
  const f = state.filter;
  const batches = [...new Set(state.participants.map((r) => r.batch_id))].sort();
  $("fBatch").innerHTML = `<option value="">batch 전체</option>` + batches.map((b) => `<option${b === f.batch ? " selected" : ""}>${esc(b)}</option>`).join("");
  $("fStatus").innerHTML = STATUS_FILTERS.map(([v, l]) => `<option value="${v}"${v === f.status ? " selected" : ""}>${l}</option>`).join("");
  for (const b of $("quick").children) b.classList.toggle("on", QUICK[b.dataset.q] === f.status);
  $("fTest").checked = f.test; $("fCond").checked = f.cond;
  $("legend").innerHTML = `${badge("진행 중", "blue")}${badge("완료", "green")}${badge("잠김·이탈", "red")}${badge("만료·미접속", "gray")}`;
  const cols = COLS.filter((c) => f.cond || !c.cond);
  const rows = filtered();
  $("count").textContent = `${rows.length}명`;
  $("ptable").innerHTML = `<thead><tr>${cols.map((c) => `<th data-key="${c.key}" class="${c.cls ?? ""}${c.sort === false ? " nosort" : ""}${state.sort.key === c.key ? " sorted" : ""}">${c.label}${state.sort.key === c.key ? (state.sort.dir > 0 ? " ↑" : " ↓") : ""}</th>`).join("")}</tr></thead>
    <tbody>${rows.length ? rows.map((r) => `<tr class="row${r.id === state.selected ? " sel" : ""}" data-id="${r.id}">${cols.map((c) => `<td class="${c.cls ?? ""}">${c.cell(r)}</td>`).join("")}</tr>`).join("")
      : `<tr><td colspan="${cols.length}" class="empty">${state.participants.length ? "조건에 맞는 참가자가 없습니다" : "발급된 토큰이 없습니다"}</td></tr>`}</tbody>`;
}

async function loadParticipants() {
  state.participants = (await api("GET", "participants")).participants;
  renderParticipants();
  if (state.selected) await openPanel(state.selected, { keepScroll: true });
}

$("fBatch").addEventListener("change", (e) => { state.filter.batch = e.target.value; renderParticipants(); });
$("fStatus").addEventListener("change", (e) => { state.filter.status = e.target.value; renderParticipants(); });
$("quick").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-q]");
  if (b) { state.filter.status = state.filter.status === QUICK[b.dataset.q] ? "" : QUICK[b.dataset.q]; renderParticipants(); }
});
$("fTest").addEventListener("change", (e) => { state.filter.test = e.target.checked; renderParticipants(); });
$("fCond").addEventListener("change", (e) => { state.filter.cond = e.target.checked; renderParticipants(); });
$("ptable").addEventListener("click", (e) => {
  const th = e.target.closest("th[data-key]");
  if (th && !th.classList.contains("nosort")) {
    state.sort = { key: th.dataset.key, dir: state.sort.key === th.dataset.key ? -state.sort.dir : 1 };
    return renderParticipants();
  }
  const tr = e.target.closest("tr.row");
  if (tr) openPanel(tr.dataset.id);
});

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); } catch {
    const t = Object.assign(document.createElement("textarea"), { value: text });
    document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove();
  }
}
let copiedTimer;
function flash(el, text) { el.textContent = text; clearTimeout(copiedTimer); copiedTimer = setTimeout(() => { el.textContent = ""; }, 2500); }
$("copyIds").addEventListener("click", async () => {
  const ids = filtered().map((r) => r.participant_id);
  await copyText(ids.join("\n"));
  flash($("copied"), `${ids.length}개 복사됨`);
});

// ===== detail panel =====
const EVENT_LABEL = {
  speaker_tone_start: "스피커 재생", speaker_tone_stop: "스피커 정지", mic_test_attempt: "마이크 테스트", device_test_done: "장치 테스트 완료",
  survey_pre_submitted: "사전설문 제출", notice_confirmed: "진행 전 안내 확인", scenario_shown: "상황 안내", question_guide_shown: "면접 연습 안내",
  question_shown: "질문 표시", answer_start: "답변 시작", answer_end: "답변 완료", stt_restart: "음성 인식 재시작", self_rating_shown: "자기평가",
  feedback_loading_shown: "피드백 로딩", feedback_shown: "피드백 공개 (text)", audio_started: "피드백 재생 시작 (voice)", audio_ended: "재생 종료",
  audio_replay: "다시 듣기", audio_progress: "재생 진행", audio_play_blocked: "자동 재생 막힘", next_clicked: "설문으로 이동", client_timeout: "로딩 시간 초과",
  survey_post_submitted: "사후설문 제출", debrief_shown: "디브리핑 표시", debrief_confirmed: "디브리핑 확인", tab_hidden: "탭 숨김", tab_visible: "탭 복귀",
  window_blur: "창 포커스 이탈", window_focus: "창 포커스 복귀",
};
const NOISE = new Set(["tab_hidden", "tab_visible", "window_blur", "window_focus", "audio_progress", "stt_restart", "speaker_tone_start", "speaker_tone_stop", "mic_test_attempt"]);
const AUDIT_LABEL = {
  issued: "발급", opened: "링크 열림", consented: "동의", slot_assigned: "슬롯 배정", slot_returned: "슬롯 반환", locked: "잠김", abandoned: "이탈 처리",
  expired: "만료", completed: "완료 처리", debriefed: "디브리핑 확인", retry_granted: "재답변 기회", resumed: "재개", condition_changed: "조건 변경",
  expiry_extended: "만료 연장", destroy_pending: "파기 대기", withdrawn_data_purged: "자료 파기", audio_purged: "음성 파기", stt_judged: "STT 판정", purge_planned: "파기 plan", purge_executed: "파기 실행", exported: "내보내기", queue_dismissed: "큐에서 제거",
  slot_added: "슬롯 추가", slot_deleted: "슬롯 삭제", target_set: "목표 변경", resumed_by_admin: "재개",
};
function eventDetail(e) {
  const d = e.data || {};
  switch (e.type) {
    case "answer_start": return d.auto_started ? "자동 시작" : "";
    case "answer_end": return d.auto_submitted ? "자동 제출 (시간 종료)" : "";
    case "feedback_shown": case "audio_started": return [d.loading_ms != null && `로딩 ${sec(d.loading_ms)}`, d.min_wait_ms ? `최소 대기 ${sec(d.min_wait_ms)}` : ""].filter(Boolean).join(" · ");
    case "audio_ended": return `${sec(d.duration_s * 1000)} 재생` + (d.hidden_ms ? ` · 탭 숨김 ${sec(d.hidden_ms)}` : "");
    case "next_clicked": return [d.hidden_ms ? `탭 숨김 ${sec(d.hidden_ms)}` : "", d.replays ? `다시 듣기 ${d.replays}회` : ""].filter(Boolean).join(" · ");
    case "client_timeout": return `로딩 ${sec(d.loading_ms)}`;
    case "speaker_tone_stop": return `${sec(d.duration_ms)} 재생`;
    case "mic_test_attempt": return `${d.attempt}회: ${d.text || "인식 없음"}`;
    case "audio_progress": return `${d.position_s}초 지점`;
    default: return d.stage ? STAGE[d.stage] ?? d.stage : "";
  }
}
function auditDetail(a) {
  const d = a.detail || {};
  const bits = [d.reason && `사유: ${d.reason}`, d.reason ? "" : d.batch && `batch ${d.batch}`, d.stance && `${STANCE[d.stance] ?? d.stance}/${d.modality}`, d.source, d.exposed != null && `노출 ${d.exposed ? "후" : "전"}`,
    d.cell?.to && `→ ${STANCE[d.cell.to.stance]}/${d.cell.to.modality}`, d.to && typeof d.to === "object" && `→ ${STANCE[d.to.stance]}/${d.to.modality}`, a.slot_seq && `슬롯 #${a.slot_seq}`].filter(Boolean);
  return bits.join(" · ");
}

function timeline(d) {
  const items = [
    ...d.events.filter((e) => state.timelineAll || !NOISE.has(e.type)).map((e) => ({ ts: e.server_ts, label: EVENT_LABEL[e.type] ?? e.type, detail: eventDetail(e), kind: "event" })),
    ...d.audit.filter((a) => AUDIT_LABEL[a.action]).map((a) => ({ ts: a.ts, label: AUDIT_LABEL[a.action], detail: auditDetail(a), kind: "audit" })),
  ].sort((x, y) => new Date(x.ts) - new Date(y.ts));
  return items.length ? `<ol class="timeline">${items.map((i) => `<li class="${i.kind}"><span class="t">${fmtS(i.ts)}</span><span><span class="l">${esc(i.label)}</span>${i.detail ? ` <span class="d">${esc(i.detail)}</span>` : ""}</span></li>`).join("")}</ol>`
    : `<div class="empty">기록이 없습니다</div>`;
}

function renderPanel(d) {
  const s = d.session, a = d.actions;
  const showCond = state.filter.cond;
  const t = d.timing;
  const kv = [
    ["batch", esc(s.batch_id)], ["발급", fmt(s.issued_at)], ["만료", fmt(s.expires_at)], ["열림", fmt(s.opened_at)], ["동의", fmt(s.consented_at)], ["마지막 활동", fmt(s.last_activity_at)],
    ["완료", fmt(s.completed_at)], ["현재 단계", esc(STAGE[s.current_stage] ?? s.current_stage)], ["valid", s.valid == null ? "" : String(s.valid)],
    ...(s.audio_purged_at ? [["원음 파기됨", fmt(s.audio_purged_at)]] : []), ...(s.data_purged_at ? [["자료 파기됨", fmt(s.data_purged_at)]] : []),
    ...(s.stt_quality ? [["STT 판정", `${STT_LABEL[s.stt_quality]} (${fmt(s.stt_judged_at)})`]] : []),
    ["재접속", s.resume_count], ["재답변 기회", s.retry_used ? "사용" : "남음"], ["노출", s.exposed ? "노출됨" : "노출 전"],
    ...(s.lock_reason ? [["잠금 사유", esc(LOCK[s.lock_reason] ?? s.lock_reason)]] : []),
    ...(t ? [["피드백 공개", `준비 ${sec(t.ready_after_ms)} · 공개 ${sec(t.reveal_after_ms)} · 로딩 ${sec(t.loading_ms)}`]] : []),
    ...(showCond ? [["조건", `${esc(STANCE[s.stance] ?? "–")} / ${esc(s.modality ?? "–")}`], ["슬롯", d.assignments.map((x) => `#${x.slot_seq}${x.returned_at ? ` (반환 ${esc(x.return_reason)})` : ""}`).join(", ") || "–"]] : []),
    ["배포 커밋", s.commit ? `<code>${esc(String(s.commit).slice(0, 7))}</code>` : ""],
  ];
  const whyLines = [
    ["locked", "abandoned"].includes(s.status) && a.resume.why && `재개 불가: ${a.resume.why}`,
    ["issued", "opened", "expired"].includes(s.status) ? "" : "",
    ["consented", "in_progress"].includes(s.status) && a.condition.why && `조건 변경 불가: ${a.condition.why}`,
  ].filter(Boolean);
  $("panel").innerHTML = `
    <header><strong>${esc(s.participant_id)}</strong>${statusBadge(s.status)}${s.is_test ? badge("테스트", "gray") : ""}<button id="pClose">닫기</button></header>
    <dl class="kv">${kv.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
    <div class="actions">
      <button id="pExtend" ${a.extend.why ? "disabled" : ""} title="${esc(a.extend.why ?? "")}">만료 연장</button>
      <button id="pResume" ${a.resume.why ? "disabled" : ""} title="${esc(a.resume.why ?? "")}">재개</button>
      <button id="pCond" ${a.condition.why ? "disabled" : ""} title="${esc(a.condition.why ?? "")}">조건 변경</button>
      <button id="pPay">사례비 링크 복사</button><span class="muted" id="pCopied"></span>
    </div>
    ${whyLines.map((w) => `<div class="why">${esc(w)}</div>`).join("")}
    <h3 style="display:flex;align-items:center;gap:10px">진행 기록 <label class="inline muted" style="font-weight:400"><input type="checkbox" id="pAll" ${state.timelineAll ? "checked" : ""} />세부 이벤트</label></h3>
    ${timeline(d)}`;
  $("pClose").onclick = closePanel;
  $("pAll").onchange = (e) => { state.timelineAll = e.target.checked; renderPanel(d); };
  $("pPay").onclick = async () => { await copyText(paymentFormLink(s.participant_id)); flash($("pCopied"), "복사됨"); };
  $("pExtend").onclick = () => extendDialog(d);
  $("pResume").onclick = () => resumeDialog(d);
  $("pCond").onclick = () => conditionDialog(d);
}

async function openPanel(id, { keepScroll = false } = {}) {
  state.selected = id;
  const scroll = $("panel").scrollTop;
  try { state.detail = await api("GET", `participant?id=${id}`); } catch (e) { if (!e.silent) closePanel(); return; }
  renderPanel(state.detail);
  $("panel").classList.add("open");
  if (keepScroll) $("panel").scrollTop = scroll;
  for (const tr of $("ptable").querySelectorAll("tr.row")) tr.classList.toggle("sel", tr.dataset.id === id);
}
function closePanel() {
  state.selected = null; state.detail = null;
  $("panel").classList.remove("open");
  for (const tr of $("ptable").querySelectorAll("tr.row.sel")) tr.classList.remove("sel");
}

const reload = async () => { await loadParticipants(); };
function suggestExpiry(currentIso) {
  let t = new Date(state.defaultExpiry ?? Date.now() + 7 * 864e5).getTime();
  const floor = Math.max(new Date(currentIso).getTime(), Date.now()) + 3600_000;
  while (t < floor) t += 7 * 864e5;
  return toLocalInput(new Date(t).toISOString());
}
async function extendDialog(d) {
  if (!state.defaultExpiry) state.defaultExpiry = (await api("GET", "issue_defaults")).expires_at;
  await ask({
    title: `${d.session.participant_id} 만료 연장`, text: "동의 전 링크의 만료일을 바꿉니다.",
    fields: [{ id: "until", label: "새 만료일 (KST)", type: "datetime-local", value: suggestExpiry(d.session.expires_at) }], ok: "연장",
    run: async (v) => { await api("POST", "extend", { id: d.session.id, expires_at: fromLocalInput(v.until), reason: v.reason }); await reload(); },
  });
}
const resumeDialog = (d) => ask({
  title: `${d.session.participant_id} 재개`, text: "멈춘 단계부터 이어갑니다. 슬롯을 새로 배정하고, 재답변 기회와 재접속 횟수를 처음으로 돌립니다. 사전설문 응답은 유지됩니다.", ok: "재개",
  run: async (v) => { await api("POST", "resume", { id: d.session.id, reason: v.reason }); await reload(); },
});
const conditionDialog = (d) => ask({
  title: `${d.session.participant_id} 조건 변경`, text: "피드백에 노출되기 전 세션의 조건을 바꿉니다.",
  fields: [
    { id: "stance", label: "stance", type: "select", value: d.session.stance, options: CONDITIONS.map((c) => ({ value: c, label: STANCE[c] })) },
    { id: "modality", label: "modality", type: "select", value: d.session.modality, options: MODALITIES.map((m) => ({ value: m, label: m })) },
  ], ok: "변경",
  run: async (v) => { await api("POST", "condition", { id: d.session.id, stance: v.stance, modality: v.modality, reason: v.reason }); await reload(); },
});

// ===== issue =====
for (const [id, list] of [["iStance", CONDITIONS], ["sStance", CONDITIONS]]) $(id).innerHTML = list.map((c) => `<option value="${c}">${STANCE[c]}</option>`).join("");
for (const id of ["iModality", "sModality"]) $(id).innerHTML = MODALITIES.map((m) => `<option>${m}</option>`).join("");
$("iTest").addEventListener("change", (e) => { for (const el of document.querySelectorAll(".testonly")) el.classList.toggle("hidden", !e.target.checked); });

async function loadIssueDefaults() {
  if (state.defaultExpiry) return;
  state.defaultExpiry = (await api("GET", "issue_defaults")).expires_at;
  $("iExpires").value = toLocalInput(state.defaultExpiry);
}
$("issueForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("issueErr").textContent = "";
  try {
    const test = $("iTest").checked;
    const r = await api("POST", "issue", {
      n: Number($("iN").value), batch: $("iBatch").value.trim(), expires: fromLocalInput($("iExpires").value), test,
      ...(test && { stance: $("iStance").value, modality: $("iModality").value }), base_url: location.origin,
    });
    state.issued = r;
    $("issueNote").textContent = "이 화면을 벗어나면 링크를 다시 볼 수 없습니다";
    $("itable").innerHTML = `<thead><tr><th class="nosort">participant_id</th><th class="nosort">링크</th></tr></thead><tbody>${r.rows.map((x) => `<tr><td>${esc(x.participant_id)}</td><td class="mono">${esc(x.link)}</td></tr>`).join("")}</tbody>`;
    const old = $("csvDl").dataset.url; if (old) URL.revokeObjectURL(old);
    const url = URL.createObjectURL(new Blob([issuedCsv(r.rows)], { type: "text/csv;charset=utf-8" }));
    Object.assign($("csvDl"), { href: url, download: `links_${$("iBatch").value.trim()}_${new Date().toISOString().slice(0, 10)}.csv` });
    $("csvDl").dataset.url = url;
    $("issueResult").classList.remove("hidden");
  } catch (err) { if (!err.silent) $("issueErr").textContent = err.message; }
});
$("linksCopy").addEventListener("click", async () => {
  if (!state.issued) return;
  await copyText(state.issued.rows.map((x) => `${x.participant_id}\t${x.link}`).join("\n"));
  flash($("issueNote"), `${state.issued.rows.length}개 복사됨`);
});

// ===== cells =====
const cellTitle = (c) => `${STANCE[c.stance]} / ${c.modality}`;
async function loadCells() {
  const d = await api("GET", "cells");
  const get = (st, mo) => d.cells.find((c) => c.stance === st && c.modality === mo);
  const REASON = { abandoned: "이탈", locked: "잠김", invalid: "무효", other: "기타" };
  const box = (c) => {
    const r = c.returned;
    const reasons = Object.entries(r.by_reason).map(([k, v]) => `${REASON[k]} ${v.before + v.after}`).join(" · ");
    return `<div class="l1">완료 ${c.valid_done} / <button class="link" data-target="${c.stance}|${c.modality}" title="목표 수정">${c.target}</button></div>
      <div class="l">진행 중 ${c.in_progress}</div>
      <div class="l">반환 ${r.total}${r.total ? ` (노출 전 ${r.before} · 후 ${r.after})` : ""}</div>${reasons ? `<div class="l muted">${reasons}</div>` : ""}
      <div class="l">재충전 대기 ${c.queue}</div>`;
  };
  const sum = (f) => d.cells.filter(f).reduce((a, c) => ({ done: a.done + c.valid_done, target: a.target + c.target, prog: a.prog + c.in_progress, ret: a.ret + c.returned.total, q: a.q + c.queue }), { done: 0, target: 0, prog: 0, ret: 0, q: 0 });
  const tot = (t) => `<div class="l1">완료 ${t.done} / ${t.target}</div><div class="l">진행 중 ${t.prog}</div><div class="l">반환 ${t.ret}</div><div class="l">재충전 대기 ${t.q}</div>`;
  $("ctable").innerHTML = `<thead><tr><th></th>${MODALITIES.map((m) => `<th>${m}</th>`).join("")}<th>합계</th></tr></thead><tbody>
    ${CONDITIONS.map((st) => `<tr><th>${STANCE[st]}</th>${MODALITIES.map((m) => `<td>${box(get(st, m))}</td>`).join("")}<td>${tot(sum((c) => c.stance === st))}</td></tr>`).join("")}
    <tr><th>합계</th>${MODALITIES.map((m) => `<td>${tot(sum((c) => c.modality === m))}</td>`).join("")}<td>${tot(sum(() => true))}</td></tr></tbody>`;
  const t = d.totals;
  $("ctotals").innerHTML = `<div class="l1" style="font-variant-numeric:tabular-nums">목표까지 남은 인원 ${t.remaining}명 <span class="muted" style="font-weight:400">· 진행 중이 모두 유효 완료되면 ${t.remaining_if_in_progress_finish}명 · 미배정 슬롯 ${t.unassigned}개</span></div>`;
  if ($("emergency").open) await loadEmergency();
}
$("ctable").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-target]");
  if (!b) return;
  const [stance, modality] = b.dataset.target.split("|");
  ask({
    title: `목표 인원 — ${STANCE[stance]} / ${modality}`, reason: false, ok: "저장",
    fields: [{ id: "target", label: "유효 완료 목표 (명)", type: "number", value: b.textContent, min: 0 }],
    run: async (v) => { await api("POST", "target", { stance, modality, target: Number(v.target) }); await loadCells(); },
  });
});

async function loadEmergency() {
  const d = await api("GET", "slots");
  const when = (iso) => fmt(iso);
  $("qtable").innerHTML = `<thead><tr><th>슬롯</th><th>조건</th><th>반환</th><th>사유</th><th>노출</th><th>참가자</th><th class="nosort"></th></tr></thead><tbody>${d.queue.length ? d.queue.map((q) => `<tr>
    <td class="num">#${q.slot_seq}</td><td>${STANCE[q.stance]} / ${q.modality}</td><td class="num">${when(q.returned_at)}</td><td>${esc(q.return_reason)}</td><td>${q.exposed ? "후" : "전"}</td>
    <td>${esc(q.participant_id)}</td><td><button data-dismiss="${q.id}">제거</button></td></tr>`).join("") : `<tr><td colspan="7" class="empty">재충전 대기 중인 슬롯이 없습니다</td></tr>`}</tbody>`;
  $("utable").innerHTML = `<thead><tr><th>슬롯</th><th>블록</th><th>조건</th><th class="nosort"></th></tr></thead><tbody>${d.upcoming.length ? d.upcoming.map((u) => `<tr>
    <td class="num">#${u.seq}</td><td class="num">${u.block}</td><td>${STANCE[u.stance]} / ${u.modality}</td><td><button data-delete="${u.seq}">삭제</button></td></tr>`).join("") : `<tr><td colspan="4" class="empty">미배정 슬롯이 없습니다</td></tr>`}</tbody>`;
}
$("emergency").addEventListener("toggle", () => { if ($("emergency").open) loadEmergency().catch(() => {}); });
$("qtable").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-dismiss]");
  if (b) ask({ title: "재충전 대기 슬롯 제거", text: "이 슬롯은 다시 배정되지 않습니다.", ok: "제거",
    run: async (v) => { await api("POST", "queue_dismiss", { assignment_id: Number(b.dataset.dismiss), reason: v.reason }); await loadCells(); } });
});
$("utable").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-delete]");
  if (b) ask({ title: `슬롯 #${b.dataset.delete} 삭제`, text: "배정된 적 없는 슬롯만 삭제할 수 있습니다. 해당 셀의 남은 슬롯이 줄어듭니다.", ok: "삭제",
    run: async (v) => { await api("POST", "slot_delete", { seq: Number(b.dataset.delete), reason: v.reason }); await loadCells(); } });
});
$("slotAddForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const stance = $("sStance").value, modality = $("sModality").value;
  ask({ title: "슬롯 추가", text: `${STANCE[stance]} / ${modality} 슬롯을 시퀀스 끝에 추가합니다.`, ok: "추가",
    run: async (v) => { await api("POST", "slot_add", { stance, modality, reason: v.reason }); await loadCells(); } });
});

// ===== audit log =====
async function loadAudit() {
  const actor = $("aActor").value, action = $("aAction").value, pid = $("aPid").value.trim();
  const q = new URLSearchParams({ ...(actor && { actor }), ...(action && { kind: action }), ...(pid && { participant_id: pid }) });
  const d = await api("GET", `audit?${q}`);
  const actors = [...new Set(d.actions.map((x) => x.actor))], actions = [...new Set(d.actions.map((x) => x.action))];
  if (!$("aActor").options.length || $("aActor").options.length - 1 !== actors.length) {
    $("aActor").innerHTML = `<option value="">actor 전체</option>` + actors.map((a) => `<option${a === actor ? " selected" : ""}>${esc(a)}</option>`).join("");
    $("aAction").innerHTML = `<option value="">action 전체</option>` + actions.map((a) => `<option${a === action ? " selected" : ""}>${esc(a)}</option>`).join("");
  }
  $("atable").innerHTML = `<thead><tr><th class="nosort">시각</th><th class="nosort">actor</th><th class="nosort">action</th><th class="nosort">참가자</th><th class="nosort">내용</th></tr></thead><tbody>${d.rows.length ? d.rows.map((r) => `<tr>
    <td class="num">${fmtS(r.ts)}</td><td>${esc(r.actor)}</td><td>${esc(r.action)}</td><td>${esc(r.participant_id ?? "")}</td><td class="wrap muted">${esc(auditDetail(r))}</td></tr>`).join("") : `<tr><td colspan="5" class="empty">기록이 없습니다</td></tr>`}</tbody>`;
}
for (const id of ["aActor", "aAction"]) $(id).addEventListener("change", () => loadAudit().catch(() => {}));
$("aPid").addEventListener("input", () => { clearTimeout(loadAudit.t); loadAudit.t = setTimeout(() => loadAudit().catch(() => {}), 300); });

// ===== voice check =====
const QUALITY_DEF = { none: "없음", minor: "경미 — 일부 단어가 틀렸지만 답변의 의미는 유지됨", severe: "심각 — 핵심 내용이 빠지거나 바뀌어 피드백이 실제 답변과 다른 내용을 다룰 수 있음" };
const sttState = { sel: null };
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
async function loadStt() {
  const q = new URLSearchParams({ test: $("sttTest").checked ? "1" : "0", judged: $("sttJudged").checked ? "1" : "0" });
  const { sessions } = await api("GET", `stt_list?${q}`);
  $("sttCount").textContent = `${sessions.length}명`;
  $("sttTable").innerHTML = `<thead><tr><th class="nosort">참가자</th><th class="nosort">batch</th><th class="nosort">상태</th><th class="nosort num">조각</th><th class="nosort num">용량</th><th class="nosort">판정</th></tr></thead><tbody>${sessions.length ? sessions.map((r) => `
    <tr class="row${r.id === sttState.sel ? " sel" : ""}" data-id="${r.id}"><td>${esc(r.participant_id)}${r.is_test ? ` ${badge("테스트", "gray")}` : ""}</td><td>${esc(r.batch_id)}</td><td>${statusBadge(r.status)}</td>
    <td class="num">${r.chunks}</td><td class="num">${kb(r.bytes)}</td><td>${r.stt_quality ? badge(STT_LABEL[r.stt_quality], r.stt_quality === "severe" ? "red" : "gray") : ""}</td></tr>`).join("")
    : `<tr><td colspan="6" class="empty">확인할 원음이 없습니다</td></tr>`}</tbody>`;
}
for (const id of ["sttTest", "sttJudged"]) $(id).addEventListener("change", () => loadStt().catch(() => {}));
$("sttTable").addEventListener("click", (e) => { const tr = e.target.closest("tr.row"); if (tr) openStt(tr.dataset.id); });

async function openStt(id) {
  sttState.sel = id;
  let d;
  try { d = await api("GET", `stt_session?id=${id}`); } catch (e) { if (!e.silent) closePanel(); return; }
  const s = d.session;
  const finalOf = (qid) => d.answers.filter((a) => a.question_id === qid && a.status === "done").at(-1);
  $("panel").innerHTML = `
    <header><strong>${esc(s.participant_id)}</strong>${statusBadge(s.status)}<button id="pClose">닫기</button></header>
    <dl class="kv"><dt>batch</dt><dd>${esc(s.batch_id)}</dd><dt>STT 재시작</dt><dd>${d.stt_restart_total}회</dd>
      ${s.stt_judged_at ? `<dt>판정</dt><dd>${STT_LABEL[s.stt_quality]} (${fmt(s.stt_judged_at)})</dd>` : ""}</dl>
    ${d.audio.length ? d.audio.map((a) => {
      const fin = finalOf(a.question_id);
      const segs = d.segments.filter((x) => x.question_id === a.question_id && x.attempt === a.attempt);
      const isFinal = fin && fin.attempt === a.attempt;
      return `<h3>${esc(a.question_id)} · 시도 ${a.attempt} ${isFinal ? badge("피드백에 사용", "blue") : ""}</h3>
        <audio controls preload="none" src="/api/admin/stt_audio?id=${s.id}&question_id=${encodeURIComponent(a.question_id)}&attempt=${a.attempt}" style="width:100%"></audio>
        <div class="muted" style="font-size:12px">조각 ${a.chunks}개 · ${kb(a.bytes)} · ${fmtS(a.first_at)} – ${fmtS(a.last_at)}</div>
        ${isFinal ? `<div class="muted" style="margin-top:8px;font-size:12px">최종 transcript${fin.answer_truncated ? " (중단 제출)" : ""}${fin.answer_short ? " (짧은 답변)" : ""}</div><div style="white-space:pre-wrap;margin-bottom:6px">${esc(fin.transcript)}</div>` : `<div class="muted" style="margin-top:8px;font-size:12px">이 시도는 피드백에 쓰이지 않았습니다</div>`}
        <details style="margin-top:6px"><summary>확정 구간 ${segs.length}개</summary>${segs.length ? `<ol class="timeline">${segs.map((x) => `<li><span class="t">${fmtS(x.server_ts)}</span><span>${esc(x.text)}</span></li>`).join("")}</ol>` : `<div class="empty">구간 기록이 없습니다</div>`}</details>`;
    }).join("") : `<div class="empty">원음이 없습니다</div>`}
    <h3>오인식 정도</h3>
    <div id="sttOpts">${["none", "minor", "severe"].map((k) => `<label style="display:block;margin-bottom:4px"><input type="radio" name="sttq" value="${k}" ${s.stt_quality === k ? "checked" : ""} /> ${esc(QUALITY_DEF[k])}</label>`).join("")}</div>
    <label for="sttNote" class="muted" style="font-size:12px">메모 (선택)</label>
    <textarea id="sttNote" rows="3" maxlength="1000">${esc(s.stt_note ?? "")}</textarea>
    <div class="actions"><button class="primary" id="sttSave">판정 저장</button><span class="muted" id="sttMsg"></span></div>
    <div class="why">판정은 파기와 연결되지 않습니다. 저장해도 원음은 그대로 남습니다.</div>`;
  $("panel").classList.add("open");
  $("pClose").onclick = () => { sttState.sel = null; closePanel(); loadStt().catch(() => {}); };
  $("sttSave").onclick = async () => {
    const q = document.querySelector('input[name="sttq"]:checked')?.value;
    if (!q) { $("sttMsg").textContent = "오인식 정도를 선택해 주세요."; return; }
    try { await api("POST", "stt_judge", { id, quality: q, note: $("sttNote").value }); $("sttMsg").textContent = "저장됨"; await loadStt(); } catch (e) { if (!e.silent) $("sttMsg").textContent = e.message; }
  };
  for (const tr of $("sttTable").querySelectorAll("tr.row")) tr.classList.toggle("sel", tr.dataset.id === id);
}

// ===== purge =====
const purgeState = { cand: [], kind: "audio", plan: null, picked: new Set() };
const KIND_LABEL = { audio: "원음 파기", withdrawn: "중단자 데이터 파기" };
const candDetail = (kind, r) => (kind === "audio" ? `조각 ${r.chunks} · ${kb(r.bytes)}` : `${Object.entries(r.deleted).filter(([, n]) => n).map(([t, n]) => `${t} ${n}`).join(" · ") || "행 없음"}`);
const scopeMode = () => document.querySelector('input[name="pScope"]:checked').value;

async function loadPurgeCandidates() {
  const kind = $("pKind").value;
  const d = await api("GET", `purge_candidates?kind=${kind}&test=${$("pTest").checked ? "1" : "0"}`);
  if (kind !== $("pKind").value) return; // the kind was switched while this was loading: a newer load is on its way
  purgeState.cand = d.sessions; purgeState.kind = d.kind;
  purgeState.picked = new Set([...purgeState.picked].filter((id) => d.sessions.some((s) => s.id === id)));
  const batches = [...new Set(d.sessions.map((s) => s.batch_id))].sort();
  const cur = $("pBatch").value;
  $("pBatch").innerHTML = batches.map((b) => `<option${b === cur ? " selected" : ""}>${esc(b)}</option>`).join("");
  renderCandidates();
}
function renderCandidates() {
  const kind = purgeState.kind, mode = scopeMode(), rows = purgeState.cand; // the kind the rows were loaded for
  const inScope = (r) => mode === "all" || (mode === "batch" && r.batch_id === $("pBatch").value) || (mode === "sessions" && purgeState.picked.has(r.id));
  $("pCand").innerHTML = `<thead><tr>${mode === "sessions" ? '<th class="nosort"></th>' : ""}<th class="nosort">참가자</th><th class="nosort">batch</th><th class="nosort">내용</th><th class="nosort">범위</th></tr></thead><tbody>${rows.length ? rows.map((r) => `
    <tr>${mode === "sessions" ? `<td><input type="checkbox" data-pick="${r.id}" ${purgeState.picked.has(r.id) ? "checked" : ""} /></td>` : ""}<td>${esc(r.participant_id)}</td><td>${esc(r.batch_id)}</td><td class="muted">${esc(candDetail(kind, r))}</td><td>${inScope(r) ? badge("대상", "blue") : ""}</td></tr>`).join("")
    : `<tr><td colspan="5" class="empty">파기할 대상이 없습니다</td></tr>`}</tbody>`;
}
$("pCand").addEventListener("change", (e) => {
  const c = e.target.closest("input[data-pick]");
  if (c) { c.checked ? purgeState.picked.add(c.dataset.pick) : purgeState.picked.delete(c.dataset.pick); renderCandidates(); }
});
for (const id of ["pKind", "pTest"]) $(id).addEventListener("change", () => { purgeState.plan = null; $("pPlan").classList.add("hidden"); loadPurgeCandidates().catch(() => {}); });
$("pScope").addEventListener("change", renderCandidates);

$("pPreview").addEventListener("click", async () => {
  $("pErr").textContent = ""; $("pResult").classList.add("hidden");
  try {
    const plan = await api("POST", "purge_preview", { kind: $("pKind").value, scope: { mode: scopeMode(), batch: $("pBatch").value, ids: [...purgeState.picked], include_test: $("pTest").checked } });
    purgeState.plan = plan;
    $("pPlanTitle").textContent = `${KIND_LABEL[plan.kind]} — ${plan.count}명`;
    $("pPlanExp").textContent = `${fmt(plan.expires_at)}까지 유효`;
    $("pPlanTable").innerHTML = `<thead><tr><th class="nosort">참가자</th><th class="nosort">내용</th></tr></thead><tbody>${plan.sessions.length ? plan.sessions.map((r) => `<tr><td>${esc(r.participant_id)}</td><td class="muted">${esc(candDetail(plan.kind, r))}</td></tr>`).join("") : `<tr><td colspan="2" class="empty">대상이 없습니다</td></tr>`}</tbody>`;
    $("pCount").value = ""; $("pExec").disabled = true;
    $("pPlan").classList.remove("hidden");
    $("pCount").focus();
  } catch (e) { if (!e.silent) { $("pErr").textContent = e.message; $("pPlan").classList.add("hidden"); purgeState.plan = null; } }
});
$("pCount").addEventListener("input", () => { $("pExec").disabled = !purgeState.plan || !purgeState.plan.count || $("pCount").value.trim() !== String(purgeState.plan.count); });
$("pExecForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!purgeState.plan) return;
  $("pErr").textContent = ""; $("pExec").disabled = true;
  try {
    const r = await api("POST", "purge_execute", { plan_id: purgeState.plan.plan_id, count: $("pCount").value.trim() });
    purgeState.plan = null; $("pPlan").classList.add("hidden");
    $("pResult").innerHTML = `<div class="toolbar"><strong>${r.done.length}명 파기, ${r.skipped.length}명 건너뜀</strong></div>${r.skipped.length ? `<div class="muted">${r.skipped.map((s) => `${esc(s.participant_id)}: ${esc(s.reason)}`).join("<br>")}</div>` : ""}`;
    $("pResult").classList.remove("hidden");
    purgeState.picked.clear();
    await loadPurgeCandidates();
  } catch (err) { if (!err.silent) { $("pErr").textContent = err.message; $("pExec").disabled = false; } }
});

// ===== export =====
$("xGo").addEventListener("click", async () => {
  $("xErr").textContent = ""; $("xNote").textContent = "";
  $("xGo").disabled = true;
  try {
    const q = new URLSearchParams({ incomplete: $("xIncomplete").checked ? "1" : "0", test: $("xTest").checked ? "1" : "0" });
    const r = await fetch(`/api/admin/export?${q}`);
    if (r.status === 401) { showLogin(); return; }
    if (!r.ok) { $("xErr").textContent = (await r.json().catch(() => ({}))).error || `HTTP ${r.status}`; return; }
    const blob = await r.blob();
    const name = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") || "")?.[1] || "study1-export.zip";
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    $("xNote").textContent = `${name} · ${kb(blob.size)}`;
  } finally { $("xGo").disabled = false; }
});

// ---------- start ----------
async function start() {
  try { await api("GET", "issue_defaults"); } catch (e) { if (e.silent) return; throw e; }
  $("login").classList.add("hidden");
  $("app").classList.remove("hidden");
  show(location.hash.slice(1) || "participants");
}
start();

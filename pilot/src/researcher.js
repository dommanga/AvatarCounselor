// /researcher — Phase 1: login, session creation (with the block-sequence suggestion), and
// handing this device over to the participant. Live/Prep dashboards come in Phases 3–4.

import { escapeHtml } from "./shared.js";
import { setToken } from "./session-client.js";

const $ = (id) => document.getElementById(id);
const STAGE_LABEL = {
  pre_survey: "사전설문", scenario: "시나리오", practice: "연습",
  q1_answering: "Q1 답변", q1_feedback: "Q1 피드백", q2_answering: "Q2 답변", q2_feedback: "Q2 피드백",
  q3_answering: "Q3 답변", q3_feedback: "Q3 피드백", post_survey: "사후설문", done: "완료",
};

let overview = null;

async function call(method, path, body) {
  const r = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || `HTTP ${r.status}`), { status: r.status });
  return data;
}

function showLogin() {
  $("r-main").classList.add("hidden");
  $("r-login").classList.remove("hidden");
  $("r-password").focus();
}

async function load() {
  try {
    overview = await call("GET", "/api/researcher/overview");
  } catch (e) {
    if (e.status === 401) return showLogin();
    $("r-createErr").textContent = `불러오기 실패: ${e.message}`;
    return;
  }
  $("r-login").classList.add("hidden");
  $("r-main").classList.remove("hidden");
  render();
}

function render() {
  const { sessions, sequence, next } = overview;

  $("r-nextNote").innerHTML = next
    ? `다음 순번: <b>#${next.slot}</b> (블록 ${next.block}의 ${((next.slot - 1) % 3) + 1}번째) → 제안 조건 <b>${escapeHtml(next.condition)}</b>`
    : "블록 시퀀스 30개를 모두 사용했습니다 (IRB 상한).";
  if (next) $("r-condition").value = next.condition;
  updateWarn();

  $("r-sessions").innerHTML = sessions.map((s) => `
    <tr>
      <td>${escapeHtml(s.participant_id)} ${s.is_test ? '<span class="tag test">테스트</span>' : ""}</td>
      <td>${escapeHtml(s.condition)}${s.suggested_condition && s.suggested_condition !== s.condition
        ? ` <span class="muted">(제안: ${escapeHtml(s.suggested_condition)})</span>` : ""}</td>
      <td>${s.slot ?? "—"}</td>
      <td><span class="tag">${escapeHtml(STAGE_LABEL[s.current_stage] || s.current_stage)}</span></td>
      <td class="muted">${new Date(s.created_at).toLocaleString("ko-KR")}</td>
      <td>${s.current_stage !== "done"
        ? `<button class="small" data-resume="${s.id}" data-pid="${escapeHtml(s.participant_id)}">이 기기에서 이어하기</button>` : ""}</td>
    </tr>`).join("") || '<tr><td colspan="6" class="muted">아직 세션이 없습니다.</td></tr>';

  const blocks = {};
  for (const r of sequence) (blocks[r.block] ||= []).push(r);
  $("r-seq").innerHTML = Object.entries(blocks).map(([b, rows]) => `
    <div class="blk"><div class="bh">블록 ${b}</div>
      ${rows.map((r) => `<div class="slot ${r.participant_id ? "used" : ""} ${next?.slot === r.slot ? "next" : ""}">
        #${r.slot} ${escapeHtml(r.condition)}${r.participant_id ? ` · ${escapeHtml(r.participant_id)}` : ""}</div>`).join("")}
    </div>`).join("") || '<div class="muted">시퀀스가 없습니다. <code>npm run db:init</code>을 실행하세요.</div>';
}

function updateWarn() {
  const isTest = $("r-isTest").checked;
  const next = overview?.next;
  const cond = $("r-condition").value;
  let msg = "";
  if (isTest) msg = "테스트 세션은 순번을 소모하지 않으며 분석에서 제외됩니다. 개발자 모드(Cmd/Ctrl+Shift+P)를 쓸 수 있습니다.";
  else if (!next) msg = "순번 없이 본 세션을 만듭니다. IRB 상한(30명)을 넘지 않는지 확인하세요.";
  else if (cond !== next.condition) msg = `제안 조건(${next.condition})과 다른 조건으로 만듭니다. 순번 #${next.slot}은 이 세션이 소모합니다.`;
  $("r-createWarn").textContent = msg;
  $("r-createWarn").classList.toggle("hidden", !msg);
}
$("r-condition").addEventListener("change", updateWarn);
$("r-isTest").addEventListener("change", updateWarn);

// Store the participant token in this tab and leave for the participant page. The server has
// already cleared the researcher cookie, so back/URL to /researcher asks for the password again.
function handOff(token) {
  if (!setToken(token)) {
    $("r-createErr").textContent = "이 브라우저에 세션을 저장할 수 없습니다 (sessionStorage 차단).";
    return;
  }
  location.replace("/");
}

$("r-loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("r-loginErr").textContent = "";
  try {
    await call("POST", "/api/researcher/login", { password: $("r-password").value });
    $("r-password").value = "";
    load();
  } catch (err) {
    $("r-loginErr").textContent = err.message;
  }
});

$("r-createForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("r-createErr").textContent = "";
  const participant_id = $("r-pid").value.trim();
  const condition = $("r-condition").value;
  const is_test = $("r-isTest").checked;
  const summary = `${participant_id} · ${condition}${is_test ? " · 테스트" : ` · 순번 #${overview.next?.slot ?? "없음"}`}`;
  if (!confirm(`${summary}\n\n세션을 만들고 이 기기를 참가자 화면으로 전환합니다.`)) return;
  $("r-create").disabled = true;
  try {
    const r = await call("POST", "/api/researcher/create", {
      participant_id, condition, is_test,
      slot: is_test ? null : overview.next?.slot ?? null,
      client_ts: Date.now(),
    });
    handOff(r.token);
  } catch (err) {
    $("r-createErr").textContent = err.message;
    if (err.status === 401) showLogin();
    else if (err.status === 409) load();
  } finally {
    $("r-create").disabled = false;
  }
});

$("r-sessions").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-resume]");
  if (!btn) return;
  if (!confirm(`${btn.dataset.pid} 세션을 이 기기에서 이어갑니다. 다른 기기에 열려 있는 참가자 화면은 더 이상 동작하지 않습니다.`)) return;
  try {
    const r = await call("POST", "/api/researcher/resume", { session_id: btn.dataset.resume });
    handOff(r.token);
  } catch (err) {
    $("r-createErr").textContent = err.message;
    if (err.status === 401) showLogin();
  }
});

$("r-refresh").addEventListener("click", load);
$("r-logout").addEventListener("click", async () => {
  await call("POST", "/api/researcher/logout").catch(() => {});
  showLogin();
});

load();

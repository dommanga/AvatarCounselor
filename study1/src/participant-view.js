import { QUESTIONS, QUESTION_SEQUENCE, LAST_QUESTION, CLABEL, RLABEL, ELNAME, escapeHtml, createTwoStepInput } from "./shared.js";
import { PRACTICE_ID, PRACTICE_PROMPT } from "./questions.js";
import { getToken, createSessionClient } from "./session-client.js";
import { loadSurveyConfig, renderSurveyBlock } from "./survey.js";
import { CORPUS } from "./corpus.js";

// Main-experiment participant flow, entered through the participant link /s/{token}.
//   consent -> pre-survey (blocks from survey_items.json) -> scenario -> practice -> QUESTION_SEQUENCE
//   -> post-survey -> done
// This tab first claims the session (one active tab per session); the server decides where a
// (re)loaded page continues (resume_to). Every step is logged as a server event.
// The stance is never sent to this page for real sessions; dev mode works only in test sessions.

// Copy for the screens that end or block the flow.
const BLOCKED = {
  expired: ["기간이 지났습니다", "기간이 지났습니다. 연구자에게 문의해 주세요."],
  completed: ["참여 완료", "이미 참여를 완료하셨습니다. 감사합니다."],
  locked: ["진행할 수 없습니다", "더 이상 진행할 수 없습니다. 연구자에게 문의해 주세요."],
  abandoned: ["진행할 수 없습니다", "더 이상 진행할 수 없습니다. 연구자에게 문의해 주세요."],
  other_window: ["다른 창에서 진행 중입니다",
    "이 연구는 다른 창(탭)에서 이미 진행 중입니다. 원래 창에서 계속해 주세요. 원래 창을 이미 닫았다면 1–2분 뒤 이 페이지를 새로고침해 주세요."],
  invalid: ["링크를 확인해 주세요", "유효하지 않은 링크입니다. 받으신 링크를 다시 확인하시거나 연구자에게 문의해 주세요."],
};

// dev-nav stage list (test sessions only)
const STAGES = ["pre_survey", "scenario", "practice", ...QUESTION_SEQUENCE, "post_survey", "done"];
const STAGE_LABELS = {
  pre_survey: "사전설문", scenario: "시나리오", practice: "연습", post_survey: "사후설문", done: "완료",
  ...Object.fromEntries(QUESTION_SEQUENCE.map((q) => [q, q.toUpperCase()])),
};

export function initParticipantView(root) {
  const $ = (id) => root.querySelector("#" + id);
  const screens = ["p-nosession", "p-consent", "p-blocked", "p-survey", "p-scenario", "p-interview", "p-end"].map($);

  const progressEl = $("p-progress");
  const practiceGuide = $("p-practiceGuide");
  const questionEl = $("p-question");
  const statusText = $("p-statusText");
  const feedbackWrap = $("p-feedbackWrap");
  const feedbackEl = $("p-feedback");
  const answerRetryBtn = $("p-answerRetry");
  const nextBtn = $("p-next");
  const devInfo = $("p-devInfo");
  const devNav = $("p-devNav");
  const devStageLabel = $("p-devStageLabel");
  const devInjectRow = $("p-devInjectRow");
  const devInjectSel = $("p-devInject");

  let client = null;
  let isTest = false;
  let devMode = false;
  let finished = false;
  let stage = null;          // dev-nav position: one of STAGES
  let turn = null;           // current interview turn: PRACTICE_ID | one of QUESTION_SEQUENCE
  let answers = {};          // qid -> { transcript, feedback, pending, scores?, strong?, weak? } (from server)
  let pendingTranscript = null; // kept for [다시 시도] after an LLM error
  let heartbeat = null;
  let survey = null;         // survey_items.json
  let surveyDone = { pre: [], post: [] }; // block ids already saved on the server
  let surveyPhase = null, surveyIdx = 0, surveyForm = null;

  const show = (id) => screens.forEach((s) => s.classList.toggle("hidden", s.id !== id));

  const input = createTwoStepInput({
    statusEl: $("p-status"), statusText, transcriptEl: $("p-transcript"),
    actionBtn: $("p-actionBtn"), retryBtn: $("p-retryBtn"),
    timeEl: $("p-recTime"), timeHintEl: $("p-recTimeHint"),
    onStart: () => client.log(turn === PRACTICE_ID ? "practice_start" : "answer_start", turn === PRACTICE_ID ? null : turn),
    onEnd: () => client.log(turn === PRACTICE_ID ? "practice_end" : "answer_end", turn === PRACTICE_ID ? null : turn),
    onSubmit: (t) => (turn === PRACTICE_ID ? submitPractice(t) : submitAnswer(t)),
    submitEmpty: () => turn !== PRACTICE_ID, // practice retries locally; questions go to the server
  });

  // ---------- boot / claim / consent ----------
  async function boot() {
    const token = getToken();
    if (!token) return noSession();
    client = createSessionClient(token, { onAuthError: () => showBlocked("invalid"), onBlocked: showBlocked });
    let st;
    try {
      [st, survey] = await Promise.all([client.claim(), loadSurveyConfig()]);
    } catch (e) {
      if ([401, 409, 410].includes(e.status)) return; // already on the matching screen
      $("p-nosessionText").innerHTML = `<span class="err">서버에 연결하지 못했습니다 (${escapeHtml(e.message)}). 잠시 후 다시 시도해 주세요.</span>`;
      $("p-bootRetry").classList.remove("hidden");
      return show("p-nosession");
    }
    enter(st);
  }

  // st: claim / consent payload from the server
  function enter(st) {
    if (st.screen !== "consent" && st.screen !== "active") return showBlocked(st.screen);
    startHeartbeat(st.heartbeat_ms);
    if (st.screen === "consent") return show("p-consent");
    isTest = st.is_test;
    answers = st.answers || {};
    surveyDone = st.surveys || surveyDone;
    window.dispatchEvent(new CustomEvent("study1:session", { detail: { active: true, isTest } }));
    guardNavigation();
    resume(st.resume_to);
  }

  function noSession() {
    window.dispatchEvent(new CustomEvent("study1:session", { detail: { active: false, isTest: false } }));
    $("p-nosessionText").textContent = "받으신 참여 링크로 접속해 주세요.";
    show("p-nosession");
  }

  function showBlocked(screen) {
    const [title, text] = BLOCKED[screen] || BLOCKED.locked;
    finished = true; // nothing left to protect from an accidental close
    clearInterval(heartbeat);
    $("p-blockedTitle").textContent = title;
    $("p-blockedText").textContent = text;
    show("p-blocked");
  }

  // Keeps this tab's claim alive; pagehide hands it back so a reopened tab can continue right away.
  function startHeartbeat(ms) {
    if (heartbeat) return;
    heartbeat = setInterval(() => client.heartbeat().catch(() => {}), ms);
    window.addEventListener("pagehide", () => client.release());
    window.addEventListener("pageshow", (e) => { if (e.persisted) client.heartbeat().catch(() => {}); }); // back from bfcache
  }

  $("p-bootRetry").addEventListener("click", () => location.reload());

  $("p-consentBtn").addEventListener("click", async () => {
    const btn = $("p-consentBtn");
    btn.disabled = true;
    $("p-consentErr").textContent = "";
    try {
      enter(await client.consent());
    } catch (e) {
      if ([401, 409, 410].includes(e.status)) return;
      $("p-consentErr").textContent = e.status === 503 ? e.message : `처리하지 못했습니다 (${e.message}). 다시 눌러주세요.`;
    } finally {
      btn.disabled = false;
    }
  });

  // rt: resume_to from the server
  function resume(rt) {
    switch (rt?.to) {
      case "pre_survey": return showSurvey("pre");
      case "scenario": return showScenario();
      case "practice": return showTurn(PRACTICE_ID);
      case "question": return showTurn(rt.question_id, { reanswer: rt.reanswer });
      case "submit_saved": return showTurn(rt.question_id, { submitSaved: true });
      case "feedback": return showTurn(rt.question_id); // stored feedback (or the one still generating)
      case "post_survey": return showSurvey("post");
      default: return showEnd();
    }
  }

  // Once a session is running, the browser's back button and accidental tab closes shouldn't
  // take the participant out of the flow.
  function guardNavigation() {
    history.pushState(null, "", location.href);
    window.addEventListener("popstate", () => history.pushState(null, "", location.href));
    window.addEventListener("beforeunload", (e) => {
      if ((!finished && !isTest) || client.pendingEvents() > 0) e.preventDefault();
    });
  }

  // ---------- surveys: one block per screen, saved block by block ----------
  // Resumes at the first block not yet saved. fromStart (dev nav) always begins at block 1.
  function showSurvey(phase, { fromStart = false } = {}) {
    stage = phase === "pre" ? "pre_survey" : "post_survey";
    surveyPhase = phase;
    const i = fromStart ? 0 : survey[phase].findIndex((b) => !surveyDone[phase].includes(b.block));
    if (i < 0) return finishSurvey(phase); // all blocks saved, only the *_submitted event was missing
    renderSurvey(i);
  }

  function renderSurvey(i) {
    surveyIdx = i;
    const blocks = survey[surveyPhase];
    const block = blocks[i];
    show("p-survey");
    $("p-surveyProgress").textContent = `${surveyPhase === "pre" ? "사전 설문" : "사후 설문"} ${i + 1} / ${blocks.length}`;
    $("p-surveyTitle").textContent = block.title || "";
    $("p-surveyInstr").textContent = block.instruction || "";
    $("p-surveyInstr").classList.toggle("hidden", !block.instruction);
    $("p-surveyErr").textContent = "";
    $("p-surveyNext").textContent = surveyPhase === "post" && i === blocks.length - 1 ? "제출" : "다음";
    surveyForm = renderSurveyBlock($("p-surveyItems"), block);
    updateDevPanel();
    window.scrollTo(0, 0);
  }

  $("p-surveyNext").addEventListener("click", async () => {
    const block = survey[surveyPhase][surveyIdx];
    const { answers: values, missing } = surveyForm.collect();
    surveyForm.markMissing(missing);
    if (missing.length) {
      $("p-surveyErr").textContent = `응답하지 않은 문항이 ${missing.length}개 있습니다. 모든 문항에 응답해주세요.`;
      return;
    }
    const btn = $("p-surveyNext");
    btn.disabled = true;
    $("p-surveyErr").textContent = "";
    try {
      await client.survey(surveyPhase, block.block, values);
      if (!surveyDone[surveyPhase].includes(block.block)) surveyDone[surveyPhase].push(block.block);
      if (surveyIdx < survey[surveyPhase].length - 1) renderSurvey(surveyIdx + 1);
      else finishSurvey(surveyPhase);
    } catch (e) {
      $("p-surveyErr").textContent = `저장하지 못했습니다 (${e.message}). 다시 눌러주세요. 계속되면 연구자에게 알려주세요.`;
    } finally {
      btn.disabled = false;
    }
  });

  $("p-surveyFill").addEventListener("click", () => surveyForm?.fillRandom());

  function finishSurvey(phase) {
    if (phase === "pre") { client.log("survey_pre_submitted"); showScenario(); }
    else { client.log("survey_post_submitted"); showEnd(); }
  }

  function showScenario() {
    stage = "scenario"; show("p-scenario"); updateDevPanel();
    client.log("scenario_shown");
  }
  $("p-scenarioNext").addEventListener("click", () => showTurn(PRACTICE_ID));

  function showEnd() { stage = "done"; finished = true; show("p-end"); updateDevPanel(); }

  // ---------- interview turns ----------
  // reanswer: the server granted the re-answer chance after an interrupted answer.
  // submitSaved: interrupted mid-answer with enough saved text — submit what the server saved.
  function showTurn(qid, { reanswer = false, submitSaved = false } = {}) {
    turn = qid;
    stage = qid;
    pendingTranscript = null;
    const isPractice = qid === PRACTICE_ID;
    show("p-interview");
    progressEl.textContent = isPractice ? "연습" : "면접 질문";
    practiceGuide.classList.toggle("hidden", !isPractice);
    questionEl.textContent = isPractice ? PRACTICE_PROMPT : QUESTIONS[qid];
    feedbackWrap.classList.add("hidden");
    answerRetryBtn.classList.add("hidden");
    nextBtn.classList.add("hidden");
    devInfo.classList.add("hidden");
    input.reset();
    populateInject();
    updateDevPanel();

    // reload after the answer was submitted: show the stored feedback (or wait for the one being
    // generated) — never re-ask and never generate again
    if (isPractice && answers[PRACTICE_ID]) {
      input.showDone(answers[PRACTICE_ID].transcript);
      practiceDone();
    } else if (!isPractice && answers[qid]) {
      input.showDone(answers[qid].transcript);
      if (answers[qid].feedback) renderFeedback(answers[qid]);
      else submitAnswer(answers[qid].transcript); // pending: the server answers 202 until it's done
    } else if (!isPractice && submitSaved) {
      input.showDone("");
      submitAnswer("", false, true);
    } else if (!isPractice) {
      client.log("question_shown", qid);
      if (reanswer) statusText.textContent = "이전 답변이 저장되지 않았습니다. 한 번 더 답변해 주세요.";
    }
  }

  // The server spent the one re-answer chance on an (almost) empty answer: ask once more.
  function askAgain(qid) {
    feedbackWrap.classList.add("hidden");
    input.reset();
    statusText.textContent = "답변이 거의 인식되지 않았습니다. 마이크를 확인한 뒤 한 번 더 답변해 주세요.";
    client.log("question_shown", qid);
  }

  async function submitPractice(transcript) {
    try { await client.answer(PRACTICE_ID, transcript); answers[PRACTICE_ID] = { transcript }; }
    catch (e) { console.error("[practice] not saved:", e.message); } // practice is excluded from analysis
    practiceDone();
  }

  function practiceDone() {
    statusText.textContent = "연습이 끝났습니다. 말한 내용이 화면에 제대로 표시되었는지 확인해주세요.";
    nextBtn.textContent = "면접 시작하기";
    nextBtn.classList.remove("hidden");
  }

  async function submitAnswer(transcript, injected = false, fromSaved = false) {
    const qid = turn;
    pendingTranscript = { transcript, injected, fromSaved };
    answerRetryBtn.classList.add("hidden");
    statusText.textContent = "피드백을 준비하는 중…";
    feedbackWrap.classList.remove("hidden");
    feedbackEl.innerHTML = '<span class="muted">…</span>';
    try {
      const r = await client.answer(qid, transcript, injected, fromSaved);
      if (turn !== qid) return; // dev nav moved on meanwhile
      if (r.retry) return askAgain(qid);
      if (r.pending) { // generated by an earlier request: poll until it's stored
        setTimeout(() => { if (turn === qid) submitAnswer(transcript, injected, fromSaved); }, 3000);
        return;
      }
      answers[qid] = { transcript, ...r };
      statusText.textContent = "";
      renderFeedback(answers[qid]);
    } catch (e) {
      if (turn !== qid) return;
      statusText.textContent = "";
      feedbackEl.innerHTML = `<span class="err">문제가 발생했습니다 (${escapeHtml(e.message)}). [다시 시도]를 눌러주세요. 계속되면 연구자에게 알려주세요.</span>`;
      answerRetryBtn.classList.remove("hidden");
    }
  }

  answerRetryBtn.addEventListener("click", () => {
    if (pendingTranscript) submitAnswer(pendingTranscript.transcript, pendingTranscript.injected, pendingTranscript.fromSaved);
  });

  function renderFeedback(a) {
    feedbackWrap.classList.remove("hidden");
    feedbackEl.textContent = a.feedback; // participant sees ONLY the feedback text
    client.log("feedback_shown", turn);
    renderDevInfo(a);
    nextBtn.textContent = turn === LAST_QUESTION ? "설문으로 넘어가기" : "다음 질문";
    nextBtn.classList.remove("hidden");
  }

  nextBtn.addEventListener("click", () => {
    if (turn === PRACTICE_ID) return showTurn(QUESTION_SEQUENCE[0]);
    client.log("next_clicked", turn); // for the last question this click ends its dwell time
    const i = QUESTION_SEQUENCE.indexOf(turn);
    if (i < QUESTION_SEQUENCE.length - 1) showTurn(QUESTION_SEQUENCE[i + 1]);
    else showSurvey("post");
  });

  // ---------- dev mode (test sessions only) ----------
  window.addEventListener("study1:devmode", (e) => {
    devMode = e.detail.on;
    updateDevPanel();
    if (!devMode) devInfo.classList.add("hidden");
    else if (turn && answers[turn]?.scores) renderDevInfo(answers[turn]);
  });

  function renderDevInfo(a) {
    if (!devMode || !a.scores) { devInfo.classList.add("hidden"); return; }
    $("p-devInfoScores").innerHTML = ["situation", "task_and_action", "result"].map((el) => {
      const r = a.scores[el].rating;
      let badge = "";
      if (el === a.strong) badge = '<span class="badge strong">strength</span>';
      else if (el === a.weak) badge = '<span class="badge weak">weakness</span>';
      return `<div class="score"><span class="sname">${ELNAME[el]}</span><span class="sval">${r} · ${RLABEL[r]}</span>${badge}</div>`;
    }).join("");
    $("p-devInfoStyle").textContent = a.stance ? `Coach style: ${CLABEL[a.stance]}` : "";
    devInfo.classList.remove("hidden");
  }

  function populateInject() {
    devInjectSel.innerHTML = '<option value="">— 테스트 대본 주입 —</option>' +
      CORPUS.filter((e) => e.questionId === turn).map((e) => {
        const [s, t, r] = e.profile;
        return `<option value="${e.id}">${escapeHtml(e.id)} · S${s} T${t} R${r}</option>`;
      }).join("");
  }

  devInjectSel.addEventListener("change", () => {
    const e = CORPUS.find((c) => c.id === devInjectSel.value);
    devInjectSel.value = "";
    if (!e || !isTest) return;
    input.showDone(e.transcript);
    submitAnswer(e.transcript, true);
  });

  function updateDevPanel() {
    devNav.classList.toggle("hidden", !devMode);
    devStageLabel.textContent = stage ? `단계: ${STAGE_LABELS[stage]}` : "";
    const idx = STAGES.indexOf(stage);
    $("p-devPrev").disabled = idx <= 0;
    $("p-devNext").disabled = idx < 0 || idx >= STAGES.length - 1;
    devInjectRow.classList.toggle("hidden", !(devMode && QUESTION_SEQUENCE.includes(stage)));
    $("p-surveyDevRow").classList.toggle("hidden", !(devMode && /_survey$/.test(stage || "")));
  }

  function goToStage(s) {
    if (s === "pre_survey") showSurvey("pre", { fromStart: true });
    else if (s === "scenario") showScenario();
    else if (s === "practice") showTurn(PRACTICE_ID);
    else if (QUESTION_SEQUENCE.includes(s)) showTurn(s);
    else if (s === "post_survey") showSurvey("post", { fromStart: true });
    else showEnd();
  }
  $("p-devPrev").addEventListener("click", () => goToStage(STAGES[STAGES.indexOf(stage) - 1]));
  $("p-devNext").addEventListener("click", () => goToStage(STAGES[STAGES.indexOf(stage) + 1]));

  show("p-nosession");
  boot();
}

import { QUESTIONS, QUESTION_SEQUENCE, LAST_QUESTION, CLABEL, RLABEL, ELNAME, escapeHtml, createTwoStepInput } from "./shared.js";
import { PRACTICE_ID, PRACTICE_PROMPT } from "./questions.js";
import { getToken, clearToken, createSessionClient } from "./session-client.js";
import { loadSurveyConfig, renderSurveyBlock } from "./survey.js";
import { CORPUS } from "./corpus.js";

// Main-experiment participant flow. This page only holds the bearer token for the session.
//   pre-survey (blocks from survey_items.json) -> scenario -> practice -> QUESTION_SEQUENCE -> post-survey -> done
// Every step is logged as a server event; a reload resumes at the stage the server recorded.
// The condition is never sent to this page for real sessions; dev mode works only in test sessions.

// dev-nav stage list (test sessions only)
const STAGES = ["pre_survey", "scenario", "practice", ...QUESTION_SEQUENCE, "post_survey", "done"];
const STAGE_LABELS = {
  pre_survey: "사전설문", scenario: "시나리오", practice: "연습", post_survey: "사후설문", done: "완료",
  ...Object.fromEntries(QUESTION_SEQUENCE.map((q) => [q, q.toUpperCase()])),
};

export function initParticipantView(root) {
  const $ = (id) => root.querySelector("#" + id);
  const screens = ["p-nosession", "p-survey", "p-scenario", "p-interview", "p-end"].map($);

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
  let answers = {};          // qid -> { transcript, feedback, scores?, strong?, weak? } (from server)
  let pendingTranscript = null; // kept for [다시 시도] after an LLM error
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
  });

  // ---------- boot / resume ----------
  async function boot() {
    const token = getToken();
    if (!token) return noSession();
    client = createSessionClient(token, { onAuthError: () => { clearToken(); noSession(); } });
    let st;
    try {
      [st, survey] = await Promise.all([client.state(), loadSurveyConfig()]);
    } catch (e) {
      if (e.status === 401) return; // onAuthError already switched screens
      $("p-nosessionText").innerHTML = `<span class="err">서버에 연결하지 못했습니다 (${escapeHtml(e.message)}). 연구자에게 알려주세요.</span>`;
      $("p-bootRetry").classList.remove("hidden");
      return show("p-nosession");
    }
    isTest = st.is_test;
    answers = st.answers || {};
    surveyDone = st.surveys || surveyDone;
    window.dispatchEvent(new CustomEvent("study1:session", { detail: { active: true, isTest } }));
    guardNavigation();
    resume(st.stage);
  }

  function noSession() {
    window.dispatchEvent(new CustomEvent("study1:session", { detail: { active: false, isTest: false } }));
    show("p-nosession");
  }

  $("p-bootRetry").addEventListener("click", () => location.reload());

  function resume(serverStage) {
    if (serverStage === "pre_survey") return showSurvey("pre");
    if (serverStage === "scenario") return showScenario();
    if (serverStage === "practice") return showTurn(PRACTICE_ID);
    const m = /^(.+)_(answering|feedback)$/.exec(serverStage);
    if (m && QUESTIONS[m[1]]) return showTurn(m[1]);
    if (serverStage === "post_survey") return showSurvey("post");
    return showEnd();
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
  function showTurn(qid) {
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

    // reload while this question's feedback was already generated: show it again, don't re-ask
    if (isPractice && answers[PRACTICE_ID]) {
      input.showDone(answers[PRACTICE_ID].transcript);
      practiceDone();
    } else if (!isPractice && answers[qid]?.feedback) {
      input.showDone(answers[qid].transcript);
      renderFeedback(answers[qid]);
    } else if (!isPractice) {
      client.log("question_shown", qid);
    }
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

  async function submitAnswer(transcript, injected = false) {
    const qid = turn;
    pendingTranscript = { transcript, injected };
    answerRetryBtn.classList.add("hidden");
    statusText.textContent = "피드백을 준비하는 중…";
    feedbackWrap.classList.remove("hidden");
    feedbackEl.innerHTML = '<span class="muted">…</span>';
    try {
      const r = await client.answer(qid, transcript, injected);
      if (turn !== qid) return; // dev nav moved on meanwhile
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
    if (pendingTranscript) submitAnswer(pendingTranscript.transcript, pendingTranscript.injected);
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
    $("p-devInfoStyle").textContent = a.condition ? `Coach style: ${CLABEL[a.condition]}` : "";
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

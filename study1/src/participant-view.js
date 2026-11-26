import { QUESTIONS, QUESTION_SEQUENCE, LAST_QUESTION, CLABEL, RLABEL, ELNAME, escapeHtml } from "./shared.js";
import { getToken, createSessionClient } from "./session-client.js";
import { loadSurveyConfig, renderSurveyBlock } from "./survey.js";
import { applyOrder } from "./survey-shared.js";
import { COPY, paymentFormLink } from "./copy.js";
import { checkEnvironment } from "./env.js";
import { createVisibilityTracker } from "./visibility.js";
import { createAnswerRecorder } from "./recorder.js";
import { createDeviceTest } from "./device-test.js";
import { CORPUS } from "./corpus.js";

// Main-experiment participant flow, entered through the participant link /s/{token}.
//   environment check -> consent -> device test -> notice -> pre-survey -> scenario -> answer instructions ->
//   question (thinking time, answer) -> self-rating -> loading -> feedback -> post-survey -> debriefing -> done
// The page first claims the session (one active tab per session); the server decides where a
// (re)loaded page continues (resume_to). Every step is logged as a server event.
// The stance is never sent to this page for real sessions; dev mode works only in test sessions.

// dev-nav stage list (test sessions only)
const STAGES = ["device_test", "notice", "pre_survey", "scenario", "question_guide", ...QUESTION_SEQUENCE, "self_rating", "feedback", "post_survey", "debrief", "done"];
const STAGE_LABELS = {
  device_test: "장치 테스트", notice: "진행 전 안내", pre_survey: "사전설문", scenario: "시나리오", question_guide: "답변 안내",
  self_rating: "자기평가", feedback: "피드백",
  post_survey: "사후설문", debrief: "디브리핑", done: "완료",
  ...Object.fromEntries(QUESTION_SEQUENCE.map((q) => [q, `질문 ${q.toUpperCase()}`])),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BLOCKED_STATUS = [401, 409, 410]; // the client already switched to the matching screen
const mmss = (ms) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

// Fills every data-copy element from COPY (static page wording lives in src/copy.js).
function applyCopy(root) {
  for (const el of root.querySelectorAll("[data-copy]")) {
    const v = COPY[el.dataset.copy];
    if (typeof v === "string") el.textContent = v;
  }
  for (const el of root.querySelectorAll("[data-copy-list]")) { // one <li> per string
    el.replaceChildren(...COPY[el.dataset.copyList].map((t) => Object.assign(document.createElement("li"), { textContent: t })));
  }
}

export function initParticipantView(root) {
  const $ = (id) => root.querySelector("#" + id);
  applyCopy(root);
  const screens = ["p-nosession", "p-consent", "p-blocked", "p-device", "p-notice", "p-survey", "p-scenario", "p-qguide", "p-question", "p-loading", "p-feedback", "p-debrief", "p-end"].map($);
  const show = (id) => { screens.forEach((s) => s.classList.toggle("hidden", s.id !== id)); window.scrollTo(0, 0); };

  let client = null, tracker = null, heartbeat = null, device = null;
  let session = null;        // claim / consent payload: timing, survey_order, attempt, audio_upload, ...
  let survey = null;         // survey_items.json
  let surveyDone = { pre: [], mid: [], post: [] };
  let surveyValues = {};     // earlier answers that later questions quote (OE1 shows both self-ratings)
  let surveyPhase = null, surveyIdx = 0, surveyForm = null;
  let isTest = false, devMode = false, finished = false;
  let stage = null;          // dev-nav position and the stage label on tab events
  let turn = null;           // current question id
  let participantId = null;
  // question screen
  let thinkTimer = null, answerTimer = null, recorder = null, answering = false, finishing = false, pendingSubmit = null;
  // feedback screen
  let pollToken = 0, feedbackMark = null;

  const qMessage = $("p-qMessage"), qError = $("p-qError"), submitRetry = $("p-submitRetry");

  // ---------- boot / claim / consent ----------
  async function boot() {
    const token = getToken();
    if (!token) return noSession();
    // Browser check first: claiming the session marks the link as opened, and an unsupported browser must not change it.
    if (!checkEnvironment().ok) return showBlocked("unsupported");
    client = createSessionClient(token, { onAuthError: () => showBlocked("invalid"), onBlocked: showBlocked });
    let st;
    try {
      [st, survey] = await Promise.all([client.claim(), loadSurveyConfig()]);
    } catch (e) {
      if (BLOCKED_STATUS.includes(e.status)) return;
      $("p-nosessionText").innerHTML = `<span class="err">${escapeHtml(COPY.connectFail(e.message))}</span>`;
      $("p-bootRetry").classList.remove("hidden");
      return show("p-nosession");
    }
    enter(st);
  }

  // st: claim / consent payload from the server
  function enter(st) {
    session = st;
    isTest = !!st.is_test;
    if (st.screen === "completed") { // debriefing / completion screen of a finished session
      participantId = st.participant_id;
      return resume(st.resume_to);
    }
    if (st.screen !== "consent" && st.screen !== "active") return showBlocked(st.screen);
    startHeartbeat(st.heartbeat_ms);
    if (st.screen === "consent") return show("p-consent");
    surveyDone = { pre: [], mid: [], post: [], ...st.surveys };
    surveyValues = { ...st.values };
    window.dispatchEvent(new CustomEvent("study1:session", { detail: { active: true, isTest } }));
    guardNavigation();
    startTracker();
    resume(st.resume_to);
  }

  function noSession() {
    window.dispatchEvent(new CustomEvent("study1:session", { detail: { active: false, isTest: false } }));
    $("p-nosessionText").textContent = COPY.noToken;
    show("p-nosession");
  }

  function showBlocked(screen) {
    const [title, text] = COPY.blocked[screen] || COPY.blocked.locked;
    finished = true; // nothing left to protect from an accidental close
    clearInterval(heartbeat);
    stopTracker();
    cleanupQuestion();
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

  function startTracker() {
    if (tracker) return;
    tracker = createVisibilityTracker({ log: (type, data) => client.log(type, null, { data }), getStage: () => stage || "boot" });
  }
  function stopTracker() { tracker?.stop(); tracker = null; }

  // Once a session is running, the browser's back button and accidental tab closes shouldn't
  // take the participant out of the flow.
  function guardNavigation() {
    history.pushState(null, "", location.href);
    window.addEventListener("popstate", () => history.pushState(null, "", location.href));
    window.addEventListener("beforeunload", (e) => {
      if ((!finished && !isTest) || client.pendingEvents() > 0) e.preventDefault();
    });
  }

  $("p-bootRetry").addEventListener("click", () => location.reload());

  $("p-consentBtn").addEventListener("click", async () => {
    const btn = $("p-consentBtn");
    const picked = (name) => root.querySelector(`input[name="${name}"]:checked`)?.value;
    const choices = { withdraw_data: picked("p-withdrawData"), notify: picked("p-notify") };
    if (!$("p-consentAgree").checked || !choices.withdraw_data || !choices.notify) {
      $("p-consentErr").textContent = COPY.consentChoicesMissing;
      return;
    }
    btn.disabled = true;
    $("p-consentErr").textContent = "";
    try {
      enter(await client.consent(choices));
    } catch (e) {
      if (BLOCKED_STATUS.includes(e.status)) return;
      $("p-consentErr").textContent = e.status === 503 ? e.message : COPY.consentFail(e.message);
    } finally {
      btn.disabled = false;
    }
  });

  // rt: resume_to from the server
  function resume(rt) {
    switch (rt?.to) {
      case "device_test": return showDevice();
      case "notice": return showNotice();
      case "pre_survey": return showSurvey("pre");
      case "scenario": return showScenario();
      case "question_guide": return showQuestionGuide(rt.question_id, { reanswer: rt.reanswer });
      case "question": return showQuestion(rt.question_id, { reanswer: rt.reanswer });
      case "submit_saved": return showQuestion(rt.question_id, { submitSaved: true });
      case "self_rating": return showSelfRating(rt.question_id);
      case "feedback": return showLoading(rt.question_id, { seen: rt.seen }); // stored feedback; never generated again
      case "post_survey": return showSurvey("post");
      case "debrief": return showDebrief({ logShown: true });
      default: return showEnd();
    }
  }

  // ---------- device test ----------
  function showDevice() {
    stage = "device_test";
    show("p-device");
    device ??= createDeviceTest({ $, client, onDone: showNotice });
    device.reset();
    updateDevPanel();
  }

  // ---------- notice before the survey part ----------
  function showNotice() {
    stage = "notice";
    show("p-notice");
    updateDevPanel();
  }
  $("p-noticeConfirm").addEventListener("click", () => {
    client.log("notice_confirmed"); // the confirmation time
    showSurvey("pre");
  });

  // ---------- surveys: one block per screen, saved block by block ----------
  // Items appear in the order drawn for this session at consent (the server stores it). Resumes at the
  // first block not yet saved. fromStart (dev nav) always begins at block 1.
  const surveyStage = { pre: "pre_survey", mid: "self_rating", post: "post_survey" };

  function showSurvey(phase, { fromStart = false } = {}) {
    stage = surveyStage[phase];
    surveyPhase = phase;
    const blocks = survey[phase] || [];
    const i = fromStart ? 0 : blocks.findIndex((b) => !surveyDone[phase].includes(b.block));
    if (i < 0) return finishSurvey(phase);
    renderSurvey(i);
  }

  function renderSurvey(i) {
    surveyIdx = i;
    const blocks = survey[surveyPhase];
    const block = applyOrder(blocks[i], session.survey_order?.[surveyPhase]?.[blocks[i].block]);
    show("p-survey");
    $("p-surveyProgress").textContent = COPY.surveyOf(surveyPhase, i + 1, blocks.length);
    $("p-surveyTitle").textContent = block.title || "";
    $("p-surveyTitle").classList.toggle("hidden", !block.title);
    $("p-surveyInstr").textContent = block.instruction || "";
    $("p-surveyInstr").classList.toggle("hidden", !block.instruction);
    $("p-surveyErr").textContent = "";
    $("p-surveyNext").textContent = surveyPhase === "post" && i === blocks.length - 1 ? COPY.surveySubmit : COPY.surveyNext;
    surveyForm = renderSurveyBlock($("p-surveyItems"), block, { values: surveyValues, oeMinChars: session.rules?.oe_min_chars });
    updateDevPanel();
  }

  $("p-surveyNext").addEventListener("click", async () => {
    const block = survey[surveyPhase][surveyIdx];
    const { answers: values, missing } = surveyForm.collect();
    surveyForm.markMissing(missing);
    if (missing.length) {
      $("p-surveyErr").textContent = COPY.surveyMissing(missing.length);
      return;
    }
    const btn = $("p-surveyNext");
    btn.disabled = true;
    $("p-surveyErr").textContent = "";
    try {
      try {
        await client.survey(surveyPhase, block.block, values);
      } catch (e) {
        if (!BLOCKED_STATUS.includes(e.status)) $("p-surveyErr").textContent = COPY.surveySaveFail(e.message);
        return;
      }
      Object.assign(surveyValues, values);
      if (!surveyDone[surveyPhase].includes(block.block)) surveyDone[surveyPhase].push(block.block);
      if (surveyIdx < survey[surveyPhase].length - 1) renderSurvey(surveyIdx + 1);
      else await finishSurvey(surveyPhase);
    } finally {
      btn.disabled = false;
    }
  });

  $("p-surveyFill").addEventListener("click", () => surveyForm?.fillRandom());

  async function finishSurvey(phase) {
    if (phase === "pre") { client.log("survey_pre_submitted"); return showScenario(); }
    if (phase === "mid") return showLoading(turn || QUESTION_SEQUENCE[0], {});
    // post-survey: the server completes the session; the page moves on only once that has happened
    try {
      const r = await client.complete();
      participantId = r.participant_id ?? participantId;
    } catch (e) {
      if (!BLOCKED_STATUS.includes(e.status)) $("p-surveyErr").textContent = COPY.completeFail(e.message);
      return;
    }
    client.close(); // the session no longer takes events
    stopTracker();
    clearInterval(heartbeat);
    showDebrief({ logShown: true });
  }

  // ---------- scenario ----------
  function showScenario() {
    stage = "scenario";
    show("p-scenario");
    updateDevPanel();
    client.log("scenario_shown");
  }
  $("p-scenarioNext").addEventListener("click", () => showQuestionGuide(QUESTION_SEQUENCE[0]));

  // ---------- answer instructions: the thinking time starts when the question appears, not here ----------
  let guideReanswer = false;
  function showQuestionGuide(qid = QUESTION_SEQUENCE[0], { reanswer = false } = {}) {
    cleanupQuestion();
    turn = qid;
    stage = "question_guide";
    guideReanswer = reanswer;
    show("p-qguide");
    updateDevPanel();
    client.log("question_guide_shown");
  }
  $("p-qguideStart").addEventListener("click", () => showQuestion(turn, { reanswer: guideReanswer }));

  // ---------- question: thinking time, then the answer ----------
  function cleanupQuestion() {
    clearInterval(thinkTimer); clearInterval(answerTimer);
    thinkTimer = answerTimer = null;
    recorder?.abort();
    recorder = null;
    answering = finishing = false;
  }

  // reanswer: the server spent the re-answer chance on an interrupted answer.
  // submitSaved: interrupted mid-answer with enough saved text — confirm what the server saved.
  // message: shown above the answer box (a retry after an empty answer).
  function showQuestion(qid, { reanswer = false, submitSaved = false, message = "" } = {}) {
    cleanupQuestion();
    turn = qid;
    stage = qid;
    show("p-question");
    $("p-questionText").textContent = QUESTIONS[qid];
    $("p-questionHint").textContent = COPY.questionHints?.[qid] ?? ""; // screen only: the LLM gets QUESTIONS[qid] alone
    qMessage.textContent = reanswer ? COPY.answerReanswer : message;
    qError.textContent = "";
    submitRetry.classList.add("hidden");
    $("p-think").classList.remove("hidden");
    $("p-answering").classList.add("hidden");
    $("p-startBtn").disabled = false;
    $("p-meter").style.width = "0";
    populateInject();
    updateDevPanel();
    if (submitSaved) {
      $("p-think").classList.add("hidden");
      return submitAnswer({ interrupted: true });
    }
    client.log("question_shown", qid);
    startThinking();
  }

  // Thinking time always counts down from the start (also after a reload). Zero or [답변 시작] starts the recording.
  function startThinking() {
    const total = session.timing.think_ms;
    const t0 = performance.now();
    const tick = () => {
      const left = Math.max(0, total - (performance.now() - t0));
      $("p-thinkTime").textContent = `${Math.ceil(left / 1000)}초`;
      $("p-thinkBar").style.width = `${(left / total) * 100}%`;
      if (left <= 0) { clearInterval(thinkTimer); startAnswer({ auto: true }); }
    };
    clearInterval(thinkTimer);
    thinkTimer = setInterval(tick, 200);
    tick();
  }

  $("p-startBtn").addEventListener("click", () => startAnswer({ auto: false }));

  async function startAnswer({ auto }) {
    if (answering) return;
    answering = true;
    clearInterval(thinkTimer);
    const ts = Date.now(); // the click, not when the microphone became ready
    const startBtn = $("p-startBtn");
    startBtn.disabled = true;
    qError.textContent = "";
    const qid = turn;
    const rec = createAnswerRecorder({
      client, questionId: qid, attempt: session.attempt, recordAudio: session.audio_upload, chunkMs: session.timing.audio_chunk_ms,
      onVolume: (v) => { $("p-meter").style.width = `${Math.round(v * 100)}%`; },
      onError: (code) => { if (code !== "aborted") $("p-statusText").textContent = COPY.sttFail(code); },
      onSttRestart: () => client.log("stt_restart", qid),
    });
    recorder = rec;
    const r = await rec.start();
    if (turn !== qid || recorder !== rec) return; // the screen changed meanwhile
    if (!r.ok) { // no microphone: stay on the thinking panel, no countdown, ready to try again
      recorder = null;
      answering = false;
      startBtn.disabled = false;
      qError.textContent = COPY.micFail;
      return;
    }
    client.log("answer_start", qid, { data: { auto_started: auto }, ts });
    $("p-think").classList.add("hidden");
    $("p-answering").classList.remove("hidden");
    $("p-doneBtn").disabled = false;
    $("p-statusText").textContent = COPY.answeringStatus;
    const t0 = performance.now();
    const max = session.timing.answer_max_ms;
    answerTimer = setInterval(() => {
      const elapsed = performance.now() - t0;
      $("p-elapsed").textContent = mmss(elapsed);
      if (elapsed >= max) finishAnswer({ auto: true }); // the time is up: submitted automatically
    }, 250);
  }

  $("p-doneBtn").addEventListener("click", () => finishAnswer({ auto: false }));

  async function finishAnswer({ auto }) {
    if (!answering || finishing) return;
    finishing = true;
    clearInterval(answerTimer);
    const qid = turn;
    client.log("answer_end", qid, { data: { auto_submitted: auto } });
    $("p-doneBtn").disabled = true;
    $("p-statusText").textContent = COPY.answerFinishing;
    const rec = recorder;
    recorder = null;
    const { clientTranscript } = await rec.stop();
    if (turn !== qid) return;
    await submitAnswer({ clientTranscript });
  }

  // Confirms the answer on the server (from its saved segments) and moves on to the self-rating; the
  // feedback is already being generated by then.
  async function submitAnswer(opts = {}) {
    const qid = turn;
    pendingSubmit = opts;
    submitRetry.classList.add("hidden");
    qError.textContent = "";
    try {
      const r = await client.answer(qid, {
        client_transcript: opts.clientTranscript ?? null,
        interrupted: !!opts.interrupted,
        ...(opts.injected && { injected: true, transcript: opts.transcript }),
      });
      if (turn !== qid) return;
      if (r.retry) { // (almost) empty: the one re-answer chance, from the start of the thinking time
        session.attempt = r.attempt;
        return showQuestion(qid, { message: COPY.answerAskAgain });
      }
      showSelfRating(qid);
    } catch (e) {
      if (BLOCKED_STATUS.includes(e.status) || turn !== qid) return;
      qError.textContent = COPY.answerSubmitFail(e.message);
      submitRetry.classList.remove("hidden");
    }
  }

  submitRetry.addEventListener("click", () => { if (pendingSubmit) submitAnswer(pendingSubmit); });

  // ---------- self-rating (a one-item survey block), then loading -> feedback ----------
  function showSelfRating(qid) {
    cleanupQuestion();
    turn = qid;
    client.log("self_rating_shown", qid);
    showSurvey("mid");
  }

  function showLoading(qid, { seen = false } = {}) {
    cleanupQuestion();
    turn = qid;
    stage = "feedback";
    show("p-loading");
    $("p-loadErr").textContent = "";
    $("p-loadRetry").classList.add("hidden");
    $("p-loading").querySelector(".spinner").classList.remove("hidden");
    updateDevPanel();
    if (!seen) client.log("feedback_loading_shown", qid); // the minimum wait is counted from here
    pollFeedback(qid, performance.now(), seen ? 0 : session.timing.feedback_min_wait_ms, seen);
  }

  // The server generates the feedback after the answer was confirmed; this only waits for it.
  async function pollFeedback(qid, t0, minWait, seen) {
    const mine = ++pollToken;
    for (;;) {
      let f;
      try {
        f = await client.feedback(qid);
      } catch (e) {
        if (BLOCKED_STATUS.includes(e.status)) return;
        await sleep(2000); // network blip: keep trying
        if (mine !== pollToken) return;
        continue;
      }
      if (mine !== pollToken || turn !== qid) return;
      if (f.state === "done") {
        await sleep(Math.max(0, minWait - (performance.now() - t0)));
        if (mine !== pollToken) return;
        return showFeedback(qid, f, { seen });
      }
      if (f.state === "error" || f.state === "none") {
        $("p-loading").querySelector(".spinner").classList.add("hidden");
        $("p-loadErr").textContent = COPY.feedbackError;
        $("p-loadRetry").classList.remove("hidden");
        return;
      }
      await sleep(1500);
      if (mine !== pollToken) return;
    }
  }

  $("p-loadRetry").addEventListener("click", async () => {
    $("p-loadRetry").classList.add("hidden");
    $("p-loadErr").textContent = "";
    try {
      const r = await client.answer(turn, {}); // regenerates from the confirmed answer
      if (r.retry) { session.attempt = r.attempt; return showQuestion(turn, { message: COPY.answerAskAgain }); }
    } catch (e) {
      if (BLOCKED_STATUS.includes(e.status)) return;
    }
    showLoading(turn, { seen: true });
  });

  function showFeedback(qid, f, { seen }) {
    stage = "feedback";
    show("p-feedback");
    $("p-feedbackText").textContent = f.feedback; // the whole text at once; the participant sees ONLY the feedback
    client.log("feedback_shown", qid);
    renderDevInfo(f);
    feedbackMark = tracker?.snapshot() ?? { hidden: 0, blur: 0 };
    const btn = $("p-toSurvey");
    const dwell = seen ? 0 : f.feedback.length * session.timing.text_min_dwell_ms_per_char; // 0 unless Phase 4 sets it
    btn.disabled = dwell > 0;
    if (dwell > 0) setTimeout(() => { btn.disabled = false; }, dwell);
    updateDevPanel();
  }

  $("p-toSurvey").addEventListener("click", () => {
    const now = tracker?.snapshot() ?? feedbackMark ?? { hidden: 0, blur: 0 };
    client.log("next_clicked", turn, {
      data: { hidden_ms: Math.round(now.hidden - (feedbackMark?.hidden ?? 0)), blur_ms: Math.round(now.blur - (feedbackMark?.blur ?? 0)) },
    });
    showSurvey("post");
  });

  // ---------- debriefing, completion ----------
  function showDebrief({ logShown }) {
    stage = "debrief";
    finished = true;
    show("p-debrief");
    updateDevPanel();
    if (logShown) client.debrief("shown").catch(() => {});
  }

  $("p-debriefConfirm").addEventListener("click", async () => {
    const btn = $("p-debriefConfirm");
    btn.disabled = true;
    $("p-debriefErr").textContent = "";
    try {
      await client.debrief("confirmed");
      showEnd();
    } catch (e) {
      if (!BLOCKED_STATUS.includes(e.status)) $("p-debriefErr").textContent = COPY.debriefFail(e.message);
    } finally {
      btn.disabled = false;
    }
  });

  function showEnd() {
    stage = "done";
    finished = true;
    $("p-paymentLink").href = paymentFormLink(participantId ?? "");
    show("p-end");
    updateDevPanel();
  }

  // ---------- dev mode (test sessions only) ----------
  window.addEventListener("study1:devmode", (e) => {
    devMode = e.detail.on;
    updateDevPanel();
    if (!devMode) $("p-devInfo").classList.add("hidden");
  });

  let lastFeedback = null;
  function renderDevInfo(f) {
    lastFeedback = f;
    if (!devMode || !f.scores) { $("p-devInfo").classList.add("hidden"); return; }
    $("p-devInfoScores").innerHTML = ["situation", "task_and_action", "result"].map((el) => {
      const r = f.scores[el].rating;
      let badge = "";
      if (el === f.strong) badge = '<span class="badge strong">strength</span>';
      else if (el === f.weak) badge = '<span class="badge weak">weakness</span>';
      return `<div class="score"><span class="sname">${ELNAME[el]}</span><span class="sval">${r} · ${RLABEL[r]}</span>${badge}</div>`;
    }).join("");
    $("p-devInfoStyle").textContent = f.stance ? `Coach style: ${CLABEL[f.stance]}` : "";
    $("p-devInfo").classList.remove("hidden");
  }
  window.addEventListener("study1:devmode", () => { if (lastFeedback) renderDevInfo(lastFeedback); });

  function populateInject() {
    $("p-devInject").innerHTML = `<option value="">${COPY.devInject}</option>` +
      CORPUS.filter((e) => e.questionId === turn).map((e) => {
        const [s, t, r] = e.profile;
        return `<option value="${e.id}">${escapeHtml(e.id)} · S${s} T${t} R${r}</option>`;
      }).join("");
  }

  $("p-devInject").addEventListener("change", () => {
    const e = CORPUS.find((c) => c.id === $("p-devInject").value);
    $("p-devInject").value = "";
    if (!e || !isTest) return;
    cleanupQuestion();
    $("p-think").classList.add("hidden");
    submitAnswer({ injected: true, transcript: e.transcript });
  });

  function updateDevPanel() {
    $("p-devNav").classList.toggle("hidden", !devMode);
    $("p-devStageLabel").textContent = stage ? `단계: ${STAGE_LABELS[stage] ?? stage}` : "";
    const idx = STAGES.indexOf(stage);
    $("p-devPrev").disabled = idx <= 0;
    $("p-devNext").disabled = idx < 0 || idx >= STAGES.length - 1;
    $("p-devInjectRow").classList.toggle("hidden", !(devMode && QUESTION_SEQUENCE.includes(stage)));
    $("p-surveyDevRow").classList.toggle("hidden", !(devMode && /_survey$|^self_rating$/.test(stage || "")));
  }

  function goToStage(s) {
    const first = turn || QUESTION_SEQUENCE[0];
    if (s === "device_test") showDevice();
    else if (s === "pre_survey") showSurvey("pre", { fromStart: true });
    else if (s === "notice") showNotice();
    else if (s === "scenario") showScenario();
    else if (s === "question_guide") showQuestionGuide(first);
    else if (QUESTION_SEQUENCE.includes(s)) showQuestion(s);
    else if (s === "self_rating") { turn = first; showSurvey("mid", { fromStart: true }); }
    else if (s === "feedback") showLoading(first, { seen: true });
    else if (s === "post_survey") showSurvey("post", { fromStart: true });
    else if (s === "debrief") showDebrief({ logShown: false });
    else showEnd();
  }
  $("p-devPrev").addEventListener("click", () => goToStage(STAGES[STAGES.indexOf(stage) - 1]));
  $("p-devNext").addEventListener("click", () => goToStage(STAGES[STAGES.indexOf(stage) + 1]));

  show("p-nosession");
  boot();
}

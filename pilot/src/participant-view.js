import { QUESTIONS, QUESTION_SEQUENCE, CONDITIONS, CLABEL, RLABEL, ELNAME, api, escapeHtml, createAnswerInput, rotationFor } from "./shared.js";
import { CORPUS } from "./corpus.js";

// Participant flow (A1 skeleton + A2 eval panel + A3 comparison tail). Logging is console-only
// plus an end-of-session JSON download (no Supabase). Eval wording is provisional [measurement design].
const EVAL_ITEMS = [
  // bipolar, 1-7: 1 = flattering ("told me what I wanted to hear"), 7 = honest. No separate prompt
  // text — the two anchors alone frame the item. Direction is reversed from a plain sycophancy score.
  { key: "sycophancy",   label: "", lo: "Felt like it told me what I wanted to hear", hi: "Felt like an honest assessment" },
  { key: "appropriate",  label: "How appropriate was this feedback as a response to your answer?", lo: "Not at all appropriate", hi: "Very appropriate" },
  { key: "frustrating",  label: "How frustrating did you find this feedback?", lo: "Not at all", hi: "Very frustrating" },
];

// comparison-stage card rating reuses the same bipolar sycophancy item as the per-block eval
const SYCOPHANCY_ITEM = EVAL_ITEMS.find((it) => it.key === "sycophancy");

// comparison-stage recognition options: plain-language behavior descriptions, no style names revealed
const RECOGNITION_OPTIONS = [
  { key: "direct_desc",     text: "Pointed out the weak part directly, as something to improve." },
  { key: "minimizing_desc", text: "Brushed the weak part off as no big deal." },
  { key: "reversing_desc",  text: "Spun the weak part into a strength or a smart move." },
  { key: "none_desc",       text: "None of these apply." },
];

// dev-mode stage list: landing, the 3 immersed questions, comparison, end.
const STAGE_LABELS = ["Landing", "Q1", "Q2", "Q3", "Comparison", "End"];

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function initParticipantView(root) {
  const $ = (id) => root.querySelector("#" + id);
  const screens = ["p-landing", "p-immersed", "p-comparison", "p-end"].map($);

  const idInput = $("p-id");
  const startBtn = $("p-start");
  const progressEl = $("p-progress");
  const questionEl = $("p-question");
  const feedbackWrap = $("p-feedbackWrap");
  const feedbackEl = $("p-feedback");
  // dev only: PHASE 1 scores/strength/weakness + which feedback style is being shown
  const devInfo = $("p-devInfo");
  const devInfoScores = $("p-devInfoScores");
  const devInfoStyle = $("p-devInfoStyle");
  const evalWrap = $("p-evalWrap");
  const nextBtn = $("p-next");
  // dev nav: persistent stage-jumping bar (lives outside the screens, shown on all of them)
  const devNav = $("p-devNav");
  const devPrevBtn = $("p-devPrev");
  const devNextBtn = $("p-devNext");
  const devStageLabel = $("p-devStageLabel");
  // per-question dev inject (only this question's corpus transcripts)
  const devInjectRow = $("p-devInjectRow");
  const devInjectSel = $("p-devInject");
  // comparison
  const compDevInjectRow = $("p-compDevInjectRow");
  const compDevInjectSel = $("p-compDevInject");
  const compDevInfo = $("p-compDevInfo");
  const compDevInfoScores = $("p-compDevInfoScores");
  const compDevInfoStyles = $("p-compDevInfoStyles");
  const compQuestion = $("p-compQuestion");
  const compAnswer = $("p-compAnswer");
  const compCards = $("p-compCards");
  const compHint = $("p-compHint");
  const compNext = $("p-compNext");
  const downloadBtn = $("p-download");
  const downloadHint = $("p-downloadHint");

  let session = null;
  let evalResponses = {};
  let evalOpenEnded = "";
  let devMode = false;
  let lastComparisonBlock = null;

  const show = (id) => {
    screens.forEach((s) => s.classList.toggle("hidden", s.id !== id));
    updateDevPanel();
  };

  window.addEventListener("pilot:devmode", (e) => {
    devMode = e.detail.on;
    devNav.classList.toggle("hidden", !devMode);
    // dev/injected sessions aren't real participant data — don't let them get downloaded as if they were
    downloadBtn.disabled = devMode;
    downloadHint.classList.toggle("hidden", !devMode);
    updateDevPanel();
    renderDevInfo();
    renderCompDevInfo(lastComparisonBlock);
  });

  const input = createAnswerInput({
    statusEl: $("p-status"), statusText: $("p-statusText"), transcriptEl: $("p-transcript"),
    recBtn: $("p-recBtn"), reRecBtn: $("p-reRecBtn"), submitBtn: $("p-submitBtn"),
    onSubmit: (t) => onAnswerSubmit(t),
  });

  startBtn.addEventListener("click", () => {
    const id = idInput.value.trim();
    if (!id) { idInput.focus(); return; }
    const rotation = rotationFor(id);
    session = { id, rotation, step: 0, blocks: [], startedAt: new Date().toISOString() };
    console.log("[pilot] session start:", id, "| rotation", rotation.index, rotation.map);
    show("p-immersed");
    startBlock();
  });

  // ---------- immersed ----------
  function startBlock() {
    const qid = QUESTION_SEQUENCE[session.step];
    progressEl.textContent = `Question ${session.step + 1} of ${QUESTION_SEQUENCE.length}`;
    questionEl.textContent = QUESTIONS[qid];
    feedbackWrap.classList.add("hidden");
    evalWrap.classList.add("hidden");
    evalWrap.innerHTML = "";
    nextBtn.classList.add("hidden");
    input.reset();
    devInjectSel.innerHTML = '<option value="">— inject test transcript —</option>' +
      CORPUS.filter((e) => e.questionId === qid).map((e) => {
        const [s, t, r] = e.profile;
        return `<option value="${e.id}">${escapeHtml(e.id)} · S${s} T${t} R${r}</option>`;
      }).join("");
    updateDevPanel();
    renderDevInfo();
  }

  // dev only: show PHASE 1 scores/strength/weakness + the coach's feedback style for this question,
  // right above the coach's feedback bubble — visually flagged as dev-only (amber, matches devnav/banner).
  function renderDevInfo() {
    const block = session && session.blocks[session.step];
    if (!devMode || !block) { devInfo.classList.add("hidden"); return; }
    devInfoScores.innerHTML = ["situation", "task_and_action", "result"].map((el) => {
      const r = block.scores[el].rating;
      let badge = "";
      if (el === block.strong) badge = '<span class="badge strong">strength</span>';
      else if (el === block.weak) badge = '<span class="badge weak">weakness</span>';
      return `<div class="score"><span class="sname">${ELNAME[el]}</span><span class="sval">${r} · ${RLABEL[r]}</span>${badge}</div>`;
    }).join("");
    devInfoStyle.textContent = `Coach style: ${CLABEL[block.condition]}`;
    devInfo.classList.remove("hidden");
  }

  devInjectSel.addEventListener("change", () => {
    if (!devInjectSel.value) return;
    const e = CORPUS.find((c) => c.id === devInjectSel.value);
    devInjectSel.value = "";
    if (!e) return;
    input.reset();
    input.setTranscript(e.transcript);
    input.lock();
    onAnswerSubmit(e.transcript);
  });

  async function onAnswerSubmit(transcript) {
    const qid = QUESTION_SEQUENCE[session.step];
    const condition = session.rotation.map[qid];
    input.lock();
    $("p-statusText").textContent = "Getting your feedback…";
    feedbackWrap.classList.remove("hidden");
    feedbackEl.innerHTML = '<span class="muted">…</span>';
    devInfo.classList.add("hidden"); // clear the previous assessment immediately, before the new one resolves
    try {
      const a = await api("/api/assess", { question: QUESTIONS[qid], transcript });
      const f = await api("/api/feedback", { context: a.context, condition });
      feedbackEl.textContent = f.feedback; // participant sees ONLY the feedback (no scores)
      session.blocks[session.step] = {
        qid, condition, transcript,
        scores: a.scores, strong: a.strong, weak: a.weak, context: a.context,
        feedback: f.feedback,
      };
      console.log("[pilot] block", session.step, "| qid", qid, "| condition", condition,
        "| scores", a.scores, "| strong", a.strong, "| weak", a.weak);
    } catch (err) {
      feedbackEl.innerHTML = `<span class="err">Something went wrong (${escapeHtml(err.message)}). Please let the researcher know.</span>`;
    }
    $("p-statusText").textContent = "";
    renderDevInfo();
    renderEval();
    evalWrap.classList.remove("hidden");
    nextBtn.classList.remove("hidden");
    nextBtn.disabled = true;
  }

  function renderEval() {
    evalResponses = {};
    evalOpenEnded = "";
    evalWrap.innerHTML = `
      <div class="evalitem openended">
        <label class="qlabel" for="p-evalOpen">In your own words, how did the coach's feedback come across to you?</label>
        <textarea id="p-evalOpen" rows="3"></textarea>
      </div>
      <div class="qlabel">About this feedback</div>` +
      EVAL_ITEMS.map((it) => `
      <div class="evalitem">
        ${it.label ? `<div class="qlabel">${escapeHtml(it.label)}</div>` : ""}
        <div class="likert${it.key === "sycophancy" ? " likert-bipolar" : ""}">
          <span class="anchor">${escapeHtml(it.lo)}</span>
          <div class="likert-opts">
            ${[1, 2, 3, 4, 5, 6, 7].map((n) =>
              `<label><input type="radio" name="eval-${it.key}" value="${n}"><span class="pill">${n}</span></label>`
            ).join("")}
          </div>
          <span class="anchor">${escapeHtml(it.hi)}</span>
        </div>
      </div>`).join("");

    const updateNextEnabled = () => {
      const allRated = EVAL_ITEMS.every((it) => evalResponses[it.key] != null);
      nextBtn.disabled = !(allRated && evalOpenEnded.trim().length > 0);
    };
    evalWrap.querySelector("#p-evalOpen").addEventListener("input", (e) => {
      evalOpenEnded = e.target.value;
      updateNextEnabled();
    });
    evalWrap.querySelectorAll('input[type="radio"]').forEach((r) => {
      r.addEventListener("change", (e) => {
        evalResponses[e.target.name.replace("eval-", "")] = Number(e.target.value);
        updateNextEnabled();
      });
    });
  }

  nextBtn.addEventListener("click", () => {
    if (session.blocks[session.step]) session.blocks[session.step].eval = { openEnded: evalOpenEnded, ...evalResponses };
    console.log("[pilot] eval block", session.step, "| responses", { openEnded: evalOpenEnded, ...evalResponses });
    session.step += 1;
    if (session.step < QUESTION_SEQUENCE.length) startBlock();
    else { show("p-comparison"); buildComparison(); }
  });

  // ---------- comparison tail (normally the LAST question's answer: Q3) ----------
  // In dev mode a transcript can be injected here directly (any question), via compDevInjectSel below,
  // so `blockOverride` lets that bypass the real Q3 answer.
  function buildComparison(blockOverride) {
    const block = blockOverride || session.blocks[QUESTION_SEQUENCE.length - 1];
    lastComparisonBlock = block || null;
    compHint.textContent = "";
    compNext.disabled = true;
    if (!block) {
      compCards.innerHTML = devMode
        ? '<div class="muted">Pick a transcript above to generate feedback for comparison.</div>'
        : '<div class="err">Missing answer data. Please restart.</div>';
      renderCompDevInfo(null);
      return;
    }

    compQuestion.textContent = QUESTIONS[block.qid];
    compAnswer.textContent = block.transcript;
    const labels = ["A", "B", "C"];
    const order = shuffle([...CONDITIONS]); // randomized left-right order
    session.comparison = { qid: block.qid, labelMap: {}, feedbacks: {}, ratings: {}, recognition: {} };
    order.forEach((cond, i) => { session.comparison.labelMap[labels[i]] = cond; });
    renderCompDevInfo(block);

    compCards.innerHTML = order.map((cond, i) => `
      <div class="card">
        <div class="clabel">Feedback ${labels[i]}</div>
        <div class="cbody muted" id="p-comp-body-${labels[i]}">Generating…</div>
        <div class="compcardrate">
          <div class="likert likert-bipolar">
            <span class="anchor">${escapeHtml(SYCOPHANCY_ITEM.lo)}</span>
            <div class="likert-opts">
              ${[1, 2, 3, 4, 5, 6, 7].map((n) =>
                `<label><input type="radio" name="comp-rate-${labels[i]}" value="${n}"><span class="pill">${n}</span></label>`
              ).join("")}
            </div>
            <span class="anchor">${escapeHtml(SYCOPHANCY_ITEM.hi)}</span>
          </div>
        </div>
        <div class="compcardrecog">
          <div class="reclabel">Which best describes this feedback?</div>
          ${RECOGNITION_OPTIONS.map((opt) =>
            `<label class="recopt"><input type="radio" name="comp-recog-${labels[i]}" value="${opt.key}"> ${escapeHtml(opt.text)}</label>`
          ).join("")}
        </div>
      </div>`).join("");

    // generate 3 fresh feedbacks in parallel on the answer's context
    order.forEach((cond, i) => {
      const lab = labels[i];
      api("/api/feedback", { context: block.context, condition: cond })
        .then((d) => {
          session.comparison.feedbacks[lab] = d.feedback;
          const b = root.querySelector(`#p-comp-body-${lab}`);
          if (b) { b.textContent = d.feedback; b.classList.remove("muted"); }
        })
        .catch((err) => {
          const b = root.querySelector(`#p-comp-body-${lab}`);
          if (b) { b.textContent = `⚠ ${err.message}`; b.classList.remove("muted"); b.classList.add("err"); }
        });
    });

    const updateCompGating = () => {
      const allRated = labels.every((lab) => session.comparison.ratings[lab] != null);
      const allRecognized = labels.every((lab) => session.comparison.recognition[lab] != null);
      compNext.disabled = !(allRated && allRecognized);
    };
    compCards.querySelectorAll('input[type="radio"][name^="comp-rate-"]').forEach((r) => {
      r.addEventListener("change", (e) => {
        session.comparison.ratings[e.target.name.replace("comp-rate-", "")] = Number(e.target.value);
        updateCompGating();
      });
    });
    compCards.querySelectorAll('input[type="radio"][name^="comp-recog-"]').forEach((r) => {
      r.addEventListener("change", (e) => {
        session.comparison.recognition[e.target.name.replace("comp-recog-", "")] = e.target.value;
        updateCompGating();
      });
    });
  }

  // dev only: show PHASE 1 scores/strength/weakness for the compared answer, plus which style
  // each of Feedback A/B/C actually is (normally randomized/hidden from participants).
  function renderCompDevInfo(block) {
    if (!devMode || !block || !block.scores) { compDevInfo.classList.add("hidden"); return; }
    compDevInfoScores.innerHTML = ["situation", "task_and_action", "result"].map((el) => {
      const r = block.scores[el].rating;
      let badge = "";
      if (el === block.strong) badge = '<span class="badge strong">strength</span>';
      else if (el === block.weak) badge = '<span class="badge weak">weakness</span>';
      return `<div class="score"><span class="sname">${ELNAME[el]}</span><span class="sval">${r} · ${RLABEL[r]}</span>${badge}</div>`;
    }).join("");
    compDevInfoStyles.textContent = ["A", "B", "C"]
      .map((lab) => `${lab}: ${CLABEL[session.comparison.labelMap[lab]]}`).join("   ·   ");
    compDevInfo.classList.remove("hidden");
  }

  // dev-only: inject any corpus transcript (any question) straight into the comparison stage
  compDevInjectSel.innerHTML = '<option value="">— inject test transcript —</option>' +
    QUESTION_SEQUENCE.flatMap((qid) => CORPUS.filter((e) => e.questionId === qid)).map((e) => {
      const [s, t, r] = e.profile;
      return `<option value="${e.id}">${e.questionId.toUpperCase()} · ${escapeHtml(e.id)} · S${s} T${t} R${r}</option>`;
    }).join("");
  compDevInjectSel.addEventListener("change", async () => {
    if (!compDevInjectSel.value) return;
    const e = CORPUS.find((c) => c.id === compDevInjectSel.value);
    compDevInjectSel.value = "";
    if (!e) return;
    compQuestion.textContent = QUESTIONS[e.questionId]; // update immediately — no need to wait on the assess call
    compAnswer.textContent = e.transcript;
    compCards.innerHTML = '<div class="muted">Assessing…</div>';
    compDevInfo.classList.add("hidden"); // clear the previous assessment immediately, before the new one resolves
    try {
      const a = await api("/api/assess", { question: QUESTIONS[e.questionId], transcript: e.transcript });
      buildComparison({ qid: e.questionId, transcript: e.transcript, context: a.context, scores: a.scores, strong: a.strong, weak: a.weak });
    } catch (err) {
      compCards.innerHTML = `<div class="err">Assess failed: ${escapeHtml(err.message)}</div>`;
    }
  });

  compNext.addEventListener("click", () => {
    console.log("[pilot] comparison | labelMap", session.comparison.labelMap,
      "| ratings", session.comparison.ratings, "| recognition", session.comparison.recognition);
    session.completedAt = new Date().toISOString();
    show("p-end");
    console.log("[pilot] SESSION COMPLETE\n" + JSON.stringify(session, null, 2));
  });

  // ---------- end: download full session (no backend) ----------
  downloadBtn.addEventListener("click", () => {
    if (!session) return;
    const blob = new Blob([JSON.stringify(session, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `pilot_${session.id}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // ---------- dev nav: a single, ungated way to jump to any stage (replaces Start/Next/rating gates) ----------
  function currentStageIndex() {
    const active = screens.find((s) => !s.classList.contains("hidden"));
    if (!active) return 0;
    if (active.id === "p-landing") return 0;
    if (active.id === "p-immersed") return 1 + (session ? session.step : 0);
    if (active.id === "p-comparison") return 4;
    return 5; // p-end
  }

  function updateDevPanel() {
    const idx = currentStageIndex();
    devStageLabel.textContent = `Stage: ${STAGE_LABELS[idx]}`;
    devPrevBtn.disabled = idx <= 0;
    devNextBtn.disabled = idx >= STAGE_LABELS.length - 1;
    devInjectRow.classList.toggle("hidden", !(devMode && idx >= 1 && idx <= 3));
    compDevInjectRow.classList.toggle("hidden", !(devMode && idx === 4));
  }

  function ensureDevSession() {
    if (!session) {
      const id = idInput.value.trim() || "DEV";
      session = { id, rotation: rotationFor(id), step: 0, blocks: [], startedAt: new Date().toISOString() };
    }
  }

  function goToStage(index) {
    const clamped = Math.max(0, Math.min(STAGE_LABELS.length - 1, index));
    ensureDevSession();
    if (clamped === 0) { show("p-landing"); }
    else if (clamped <= 3) { session.step = clamped - 1; show("p-immersed"); startBlock(); }
    else if (clamped === 4) { show("p-comparison"); buildComparison(); }
    else { show("p-end"); }
  }

  devPrevBtn.addEventListener("click", () => goToStage(currentStageIndex() - 1));
  devNextBtn.addEventListener("click", () => goToStage(currentStageIndex() + 1));

  show("p-landing");
}

import { CORPUS } from "./corpus.js";
import { QUESTIONS, CONDITIONS, CLABEL, RLABEL, ELNAME, api, escapeHtml, createAnswerInput } from "./shared.js";

// v0 inspection tool: pick/inject an answer -> PHASE 1 scores + all 3 condition feedbacks side by side.
export function initDevView(root) {
  const $ = (id) => root.querySelector("#" + id);
  const qsel = $("dev-qsel");
  const devsel = $("dev-inject");
  const questionEl = $("dev-question");
  const resultEl = $("dev-result");
  const scoresEl = $("dev-scores");
  const cardsEl = $("dev-cards");

  for (const [id, text] of Object.entries(QUESTIONS)) {
    const o = document.createElement("option");
    o.value = id; o.textContent = `${id.toUpperCase()} — ${text.slice(0, 48)}…`;
    qsel.appendChild(o);
  }
  qsel.value = "q3";

  // inject list is scoped to whichever question is currently selected above
  function populateInject() {
    devsel.innerHTML = '<option value="">— inject a corpus answer —</option>' +
      CORPUS.filter((e) => e.questionId === qsel.value).map((e) => {
        const [s, t, r] = e.profile;
        return `<option value="${e.id}">${escapeHtml(e.id)} · S${s} T${t} R${r}</option>`;
      }).join("");
  }
  const renderQuestion = () => { questionEl.textContent = QUESTIONS[qsel.value]; populateInject(); };
  renderQuestion();

  const input = createAnswerInput({
    statusEl: $("dev-status"), statusText: $("dev-statusText"), transcriptEl: $("dev-transcript"),
    recBtn: $("dev-recBtn"), reRecBtn: $("dev-reRecBtn"), submitBtn: $("dev-submitBtn"),
    onSubmit: (t) => runPipeline(QUESTIONS[qsel.value], t),
  });

  qsel.addEventListener("change", () => { renderQuestion(); resultEl.classList.add("hidden"); input.reset(); });

  devsel.addEventListener("change", () => {
    if (!devsel.value) return;
    const e = CORPUS.find((c) => c.id === devsel.value);
    devsel.value = "";
    if (!e) return;
    input.reset(); input.setTranscript(e.transcript); input.lock();
    runPipeline(QUESTIONS[qsel.value], e.transcript);
  });

  let runToken = 0;
  async function runPipeline(questionText, transcript) {
    const my = ++runToken;
    resultEl.classList.remove("hidden");
    scoresEl.innerHTML = '<span class="muted">Assessing answer…</span>';
    cardsEl.innerHTML = CONDITIONS.map((c) =>
      `<div class="card"><div class="clabel">${CLABEL[c]}</div><div class="cbody muted" id="dev-cbody-${c}">Generating…</div></div>`
    ).join("");

    let a;
    try { a = await api("/api/assess", { question: questionText, transcript }); }
    catch (err) { if (my !== runToken) return; scoresEl.innerHTML = `<span class="err">Assess failed: ${escapeHtml(err.message)}</span>`; cardsEl.innerHTML = ""; return; }
    if (my !== runToken) return;

    scoresEl.innerHTML = ["situation", "task_and_action", "result"].map((el) => {
      const r = a.scores[el].rating;
      let badge = "";
      if (el === a.strong) badge = '<span class="badge strong">strength</span>';
      else if (el === a.weak) badge = '<span class="badge weak">weakness</span>';
      return `<div class="score"><span class="sname">${ELNAME[el]}</span><span class="sval">${r} · ${RLABEL[r]}</span>${badge}</div>`;
    }).join("");

    for (const c of CONDITIONS) {
      api("/api/feedback", { context: a.context, condition: c })
        .then((d) => { if (my !== runToken) return; const b = root.querySelector("#dev-cbody-" + c); if (b) { b.textContent = d.feedback; b.classList.remove("muted"); } })
        .catch((err) => { if (my !== runToken) return; const b = root.querySelector("#dev-cbody-" + c); if (b) { b.textContent = `⚠ ${err.message}`; b.classList.remove("muted"); b.classList.add("err"); } });
    }
  }

  input.reset();
}

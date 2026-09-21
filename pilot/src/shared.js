import { SpeechRecognitionManager } from "./speech.js";

// Real Bangerter questions from the corpus (do not invent).
export const QUESTIONS = {
  q1: "함께 일하는 사람들과 의견이 달랐던 상황이 있었나요? 그때 어떻게 풀어나갔는지 말씀해 주세요.",
  q2: "본인이 주도해서 끝까지 완수했던 일에 대해 이야기해 주세요.",
  q3: "여러 가지 일을 동시에 처리해야 했던 경험에 대해 말씀해 주세요.",
};
export const QUESTION_SEQUENCE = ["q1", "q2", "q3"]; // fixed question order; only condition↔question mapping rotates
export const CONDITIONS = ["direct", "minimizing", "reversing"];
export const CLABEL = { direct: "Direct", minimizing: "Minimizing", reversing: "Reversing" };
export const RLABEL = { 1:"absent", 2:"vague", 3:"specific", 4:"specific and developed", 5:"specific and fully realized" };
export const ELNAME = { situation: "Situation", task_and_action: "Task & Action", result: "Result" };

// 3-order Latin square: which condition is assigned to each question. Across the 3 orders,
// every (question, condition) cell is covered. (Server will formalize this in the Supabase step.)
const ROTATIONS = [
  { q1: "direct",     q2: "minimizing", q3: "reversing"  },
  { q1: "minimizing", q2: "reversing",  q3: "direct"     },
  { q1: "reversing",  q2: "direct",     q3: "minimizing" },
];
export function rotationFor(participantId) {
  let h = 0;
  for (const ch of String(participantId)) h = (h + ch.charCodeAt(0)) % 100000;
  const index = h % ROTATIONS.length;
  return { index, map: ROTATIONS[index] };
}

export async function api(path, body) {
  const r = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Reusable record/stop/re-record/submit + STT wiring. Each view passes its own elements + onSubmit.
// Holds the current transcript (from STT, or injected via setTranscript for dev mode).
// reRecBtn and timeEl are both optional: the participant flow has no re-record button, and any
// view can skip the stopwatch display by not passing timeEl.
const SOFT_LIMIT_MS = 60_000; // informational only — no enforced cutoff

export function createAnswerInput({ statusEl, statusText, transcriptEl, recBtn, reRecBtn, submitBtn, timeEl, timeHintEl, onSubmit }) {
  const stt = new SpeechRecognitionManager();
  let currentTranscript = "";

  // stopwatch: counts up from 00:00 while recording, informational only (no enforced limit).
  // Past SOFT_LIMIT_MS the clock underlines/reddens and a "wrap up" hint appears next to it —
  // a nudge aimed at the timer itself, not at the content of any answer.
  let stopwatchStartedAt = null;
  let stopwatchInterval = null;
  const formatElapsed = (ms) => {
    const total = Math.floor(ms / 1000);
    const m = String(Math.floor(total / 60)).padStart(2, "0");
    const s = String(total % 60).padStart(2, "0");
    return `${m}:${s}`;
  };
  const stopwatchReset = () => {
    if (stopwatchInterval) { clearInterval(stopwatchInterval); stopwatchInterval = null; }
    stopwatchStartedAt = null;
    if (timeEl) { timeEl.textContent = "00:00"; timeEl.classList.remove("warn"); }
    if (timeHintEl) timeHintEl.classList.add("hidden");
  };
  const stopwatchStart = () => {
    stopwatchReset();
    stopwatchStartedAt = Date.now();
    if (timeEl) {
      stopwatchInterval = setInterval(() => {
        const elapsed = Date.now() - stopwatchStartedAt;
        timeEl.textContent = formatElapsed(elapsed);
        const overSoftLimit = elapsed >= SOFT_LIMIT_MS;
        timeEl.classList.toggle("warn", overSoftLimit);
        if (timeHintEl) timeHintEl.classList.toggle("hidden", !overSoftLimit);
      }, 1000);
    }
  };
  const stopwatchStop = () => {
    if (stopwatchInterval) { clearInterval(stopwatchInterval); stopwatchInterval = null; }
  };

  const placeholder = () => { transcriptEl.innerHTML = '<span class="placeholder">말한 답변이 여기에 표시됩니다.</span>'; };

  if (!stt.supported) {
    statusText.innerHTML = '<span class="err">음성 인식은 Chrome에서만 지원됩니다. Chrome에서 열고 마이크를 허용해주세요.</span>';
    recBtn.disabled = true;
  }

  stt.onUpdate = (finalText, interimText) => {
    currentTranscript = finalText;
    transcriptEl.innerHTML =
      (finalText ? escapeHtml(finalText) + " " : "") +
      (interimText ? `<span class="interim">${escapeHtml(interimText)}</span>` : "");
    if (!finalText && !interimText) placeholder();
  };
  stt.onStatusChange = (listening) => {
    if (listening) {
      statusEl.classList.add("live");
      statusText.textContent = "듣고 있습니다… 답변을 말한 뒤 정지를 눌러주세요.";
      recBtn.textContent = "정지"; recBtn.classList.add("live");
    } else {
      statusEl.classList.remove("live"); recBtn.classList.remove("live");
    }
  };
  stt.onError = (code) => {
    statusText.innerHTML = (code === "not-allowed" || code === "service-not-allowed")
      ? '<span class="err">마이크가 차단되었습니다. 마이크 접근을 허용한 뒤 다시 시도해주세요.</span>'
      : `인식 오류: ${escapeHtml(code)}. 다시 시도해주세요.`;
  };

  function toRecorded() {
    statusText.textContent = currentTranscript ? "녹음이 완료되었습니다. 제출해주세요." : "녹음된 내용이 없습니다. 다시 시도해주세요.";
    if (reRecBtn) {
      recBtn.classList.add("hidden");
      reRecBtn.classList.remove("hidden");
      submitBtn.classList.remove("hidden");
      submitBtn.disabled = !currentTranscript;
    } else if (currentTranscript) {
      recBtn.classList.add("hidden");
      submitBtn.classList.remove("hidden");
      submitBtn.disabled = false;
    } else {
      // nothing captured and no re-record button (participant flow) — relabel Record as a
      // retry affordance instead of showing Submit
      recBtn.textContent = "재녹음";
      recBtn.classList.remove("hidden");
      submitBtn.classList.add("hidden");
    }
  }

  recBtn.addEventListener("click", () => {
    if (!stt.isListening) { placeholder(); currentTranscript = ""; stt.start(); stopwatchStart(); }
    else { stt.stop(); stopwatchStop(); setTimeout(toRecorded, 150); }
  });
  if (reRecBtn) reRecBtn.addEventListener("click", () => {
    reRecBtn.classList.add("hidden"); submitBtn.classList.add("hidden");
    recBtn.classList.remove("hidden"); placeholder(); currentTranscript = ""; stt.start(); stopwatchStart();
  });
  submitBtn.addEventListener("click", () => {
    if (!currentTranscript) return;
    submitBtn.disabled = true;
    onSubmit(currentTranscript);
  });

  return {
    supported: stt.supported,
    getTranscript: () => currentTranscript,
    reset() {
      if (stt.isListening) stt.stop();
      stopwatchReset();
      currentTranscript = "";
      placeholder();
      statusEl.classList.remove("live");
      statusText.textContent = "답변을 녹음할 준비가 되었습니다.";
      recBtn.textContent = "녹음"; recBtn.classList.remove("live", "hidden");
      if (reRecBtn) reRecBtn.classList.add("hidden");
      submitBtn.classList.add("hidden"); submitBtn.disabled = false;
      if (timeEl) timeEl.classList.remove("hidden");
    },
    setTranscript(text) { currentTranscript = text; transcriptEl.textContent = text; }, // dev inject
    lock() { // after submit in participant flow: no re-record, and the stopwatch is no longer relevant
      if (stt.isListening) stt.stop();
      stopwatchStop();
      recBtn.classList.add("hidden"); submitBtn.classList.add("hidden");
      if (reRecBtn) reRecBtn.classList.add("hidden");
      if (timeEl) timeEl.classList.add("hidden");
      if (timeHintEl) timeHintEl.classList.add("hidden");
      statusEl.classList.remove("live");
    },
  };
}

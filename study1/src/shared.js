import { SpeechRecognitionManager } from "./speech.js";
import { QUESTIONS, QUESTION_SEQUENCE, CONDITIONS } from "./questions.js";

export { QUESTIONS, QUESTION_SEQUENCE, CONDITIONS };
export const CLABEL = { direct: "Direct", minimizing: "Minimizing", reversing: "Reversing" };
export const RLABEL = { 1:"absent", 2:"vague", 3:"specific", 4:"specific and developed", 5:"specific and fully realized" };
export const ELNAME = { situation: "Situation", task_and_action: "Task & Action", result: "Result" };

export async function api(path, body) {
  const r = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || `HTTP ${r.status}`), { status: r.status });
  return data;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const SOFT_LIMIT_MS = 60_000; // informational only — no enforced cutoff

// stopwatch: counts up from 00:00 while recording, informational only (no enforced limit).
// Past SOFT_LIMIT_MS the clock underlines/reddens and a "wrap up" hint appears next to it —
// a nudge aimed at the timer itself, not at the content of any answer.
function createStopwatch(timeEl, timeHintEl) {
  let startedAt = null;
  let interval = null;
  const formatElapsed = (ms) => {
    const total = Math.floor(ms / 1000);
    const m = String(Math.floor(total / 60)).padStart(2, "0");
    const s = String(total % 60).padStart(2, "0");
    return `${m}:${s}`;
  };
  const stop = () => {
    if (interval) { clearInterval(interval); interval = null; }
  };
  const reset = () => {
    stop();
    startedAt = null;
    if (timeEl) { timeEl.textContent = "00:00"; timeEl.classList.remove("warn"); }
    if (timeHintEl) timeHintEl.classList.add("hidden");
  };
  const start = () => {
    reset();
    startedAt = Date.now();
    if (timeEl) {
      interval = setInterval(() => {
        const elapsed = Date.now() - startedAt;
        timeEl.textContent = formatElapsed(elapsed);
        const overSoftLimit = elapsed >= SOFT_LIMIT_MS;
        timeEl.classList.toggle("warn", overSoftLimit);
        if (timeHintEl) timeHintEl.classList.toggle("hidden", !overSoftLimit);
      }, 1000);
    }
  };
  return { start, stop, reset };
}

// Record/stop/re-record/submit + STT wiring for the dev "API 테스트" view (the participant flow uses
// createTwoStepInput below). Holds the current transcript (from STT, or injected via setTranscript).
// reRecBtn and timeEl are both optional.
export function createAnswerInput({ statusEl, statusText, transcriptEl, recBtn, reRecBtn, submitBtn, timeEl, timeHintEl, onSubmit }) {
  const stt = new SpeechRecognitionManager();
  let currentTranscript = "";

  const stopwatch = createStopwatch(timeEl, timeHintEl);
  const stopwatchReset = stopwatch.reset, stopwatchStart = stopwatch.start, stopwatchStop = stopwatch.stop;

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
  // fires once the browser has actually flushed the last final result and ended recognition —
  // more reliable than a fixed delay after stop(), which raced the transcript on longer answers
  stt.onStop = () => toRecorded();

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
    else { statusText.textContent = "인식 결과를 정리하는 중…"; stt.stop(); stopwatchStop(); }
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

// Participant flow: [답변 시작] -> [답변 완료], one button that flips. onEnd fires at the click itself
// (that click time is answer_end); onSubmit fires only once STT has delivered its final result.
// If nothing was recognized, a [다시 답변하기] button appears instead (which calls onStart again).
const STT_FLUSH_TIMEOUT_MS = 5000; // fallback if the browser never fires onend after stop()

export function createTwoStepInput({ statusEl, statusText, transcriptEl, actionBtn, retryBtn, timeEl, timeHintEl, onStart, onEnd, onSubmit }) {
  const stt = new SpeechRecognitionManager();
  const stopwatch = createStopwatch(timeEl, timeHintEl);
  let finalText = "", interimText = "";
  let phase = "idle"; // idle | listening | flushing | done
  let flushTimer = null;

  const placeholder = () => { transcriptEl.innerHTML = '<span class="placeholder">말한 답변이 여기에 표시됩니다.</span>'; };
  const READY = "준비되면 [답변 시작]을 누르고 말씀해 주세요.";

  stt.onUpdate = (f, i) => {
    finalText = f; interimText = i;
    transcriptEl.innerHTML =
      (f ? escapeHtml(f) + " " : "") + (i ? `<span class="interim">${escapeHtml(i)}</span>` : "");
    if (!f && !i) placeholder();
  };
  stt.onStatusChange = (listening) => { statusEl.classList.toggle("live", listening); };
  stt.onError = (code) => {
    statusText.innerHTML = (code === "not-allowed" || code === "service-not-allowed")
      ? '<span class="err">마이크가 차단되었습니다. 연구자에게 알려주세요.</span>'
      : `<span class="err">인식 오류: ${escapeHtml(code)}</span>`;
  };
  stt.onStop = () => finalize();

  function start() {
    finalText = ""; interimText = "";
    placeholder();
    if (!stt.start()) {
      statusText.innerHTML = '<span class="err">음성 인식을 시작하지 못했습니다. 연구자에게 알려주세요.</span>';
      return;
    }
    phase = "listening";
    onStart?.();
    stopwatch.start();
    retryBtn.classList.add("hidden");
    actionBtn.classList.remove("hidden");
    actionBtn.textContent = "답변 완료";
    actionBtn.classList.add("live");
    actionBtn.disabled = false;
    statusText.textContent = "듣고 있습니다… 답변이 끝나면 [답변 완료]를 눌러주세요.";
  }

  function end() {
    phase = "flushing";
    onEnd?.();
    stopwatch.stop();
    actionBtn.disabled = true;
    statusText.textContent = "인식 결과를 정리하는 중…";
    if (stt.isListening) {
      stt.stop();
      flushTimer = setTimeout(finalize, STT_FLUSH_TIMEOUT_MS);
    } else {
      finalize(); // recognition already ended on its own (e.g. after an error)
    }
  }

  function finalize() {
    if (phase !== "flushing") return;
    clearTimeout(flushTimer); flushTimer = null;
    const transcript = [finalText, interimText].filter(Boolean).join(" ").trim();
    actionBtn.classList.add("hidden");
    actionBtn.classList.remove("live");
    if (transcript) {
      phase = "done";
      if (timeEl) timeEl.classList.add("hidden");
      if (timeHintEl) timeHintEl.classList.add("hidden");
      statusText.textContent = "";
      onSubmit(transcript);
    } else {
      phase = "idle";
      statusText.textContent = "인식된 내용이 없습니다. 마이크 상태를 확인한 뒤 [다시 답변하기]를 눌러주세요.";
      retryBtn.classList.remove("hidden");
    }
  }

  actionBtn.addEventListener("click", () => {
    if (phase === "idle") start();
    else if (phase === "listening") end();
  });
  retryBtn.addEventListener("click", () => { if (phase === "idle") start(); });

  function reset() {
    if (stt.isListening) stt.stop();
    clearTimeout(flushTimer); flushTimer = null;
    phase = "idle";
    finalText = ""; interimText = "";
    stopwatch.reset();
    placeholder();
    statusEl.classList.remove("live");
    actionBtn.textContent = "답변 시작";
    actionBtn.classList.remove("live", "hidden");
    actionBtn.disabled = !stt.supported;
    retryBtn.classList.add("hidden");
    if (timeEl) timeEl.classList.remove("hidden");
    statusText.innerHTML = stt.supported
      ? READY
      : '<span class="err">음성 인식은 Chrome에서만 지원됩니다. 연구자에게 알려주세요.</span>';
  }

  return {
    reset,
    // show a finished answer without recording (reload-resume, or dev-mode injection)
    showDone(text) {
      reset();
      phase = "done";
      transcriptEl.textContent = text;
      actionBtn.classList.add("hidden");
      if (timeEl) timeEl.classList.add("hidden");
      statusText.textContent = "";
    },
  };
}

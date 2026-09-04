import { SpeechRecognitionManager } from "./speech.js";

// Real Bangerter questions from the corpus (do not invent).
export const QUESTIONS = {
  q1: "Tell me about a situation in which you had to participate in a project with people whose ideas differed from yours.",
  q2: "Describe to me a situation where you took an initiative that you managed to bring to completion.",
  q3: "Can you tell me about a situation in which you had to manage several tasks in parallel?",
};
export const QUESTION_SEQUENCE = ["q1", "q2", "q3"]; // fixed question order; only condition↔question mapping rotates
export const CONDITIONS = ["direct", "minimizing", "reversing"];
export const CLABEL = { direct: "Direct", minimizing: "Minimizing", reversing: "Reversing" };
export const RLABEL = { 0: "absent", 1: "vague", 2: "specific" };
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
export function createAnswerInput({ statusEl, statusText, transcriptEl, recBtn, reRecBtn, submitBtn, onSubmit }) {
  const stt = new SpeechRecognitionManager();
  let currentTranscript = "";

  const placeholder = () => { transcriptEl.innerHTML = '<span class="placeholder">Your spoken answer will appear here.</span>'; };

  if (!stt.supported) {
    statusText.innerHTML = '<span class="err">Speech recognition needs Chrome. Open in Chrome and allow the microphone.</span>';
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
      statusText.textContent = "Listening… speak your answer, then press Stop.";
      recBtn.textContent = "Stop"; recBtn.classList.add("live");
    } else {
      statusEl.classList.remove("live"); recBtn.classList.remove("live");
    }
  };
  stt.onError = (code) => {
    statusText.innerHTML = (code === "not-allowed" || code === "service-not-allowed")
      ? '<span class="err">Microphone blocked. Allow mic access and try again.</span>'
      : `Recognition error: ${escapeHtml(code)}. Try again.`;
  };

  function toRecorded() {
    statusText.textContent = currentTranscript ? "Recorded. Re-record if needed, or submit." : "Nothing captured. Try again.";
    recBtn.classList.add("hidden");
    reRecBtn.classList.remove("hidden");
    submitBtn.classList.remove("hidden");
    submitBtn.disabled = !currentTranscript;
  }

  recBtn.addEventListener("click", () => {
    if (!stt.isListening) { placeholder(); currentTranscript = ""; stt.start(); }
    else { stt.stop(); setTimeout(toRecorded, 150); }
  });
  reRecBtn.addEventListener("click", () => {
    reRecBtn.classList.add("hidden"); submitBtn.classList.add("hidden");
    recBtn.classList.remove("hidden"); placeholder(); currentTranscript = ""; stt.start();
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
      currentTranscript = "";
      placeholder();
      statusEl.classList.remove("live");
      statusText.textContent = "Ready to record your answer.";
      recBtn.textContent = "Record"; recBtn.classList.remove("live", "hidden");
      reRecBtn.classList.add("hidden"); submitBtn.classList.add("hidden"); submitBtn.disabled = false;
    },
    setTranscript(text) { currentTranscript = text; transcriptEl.textContent = text; }, // dev inject
    lock() { // after submit in participant flow: no re-record
      if (stt.isListening) stt.stop();
      recBtn.classList.add("hidden"); reRecBtn.classList.add("hidden"); submitBtn.classList.add("hidden");
      statusEl.classList.remove("live");
    },
  };
}

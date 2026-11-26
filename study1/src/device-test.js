// Device test: speaker (a soft chime that repeats until [정지]) then microphone (permission, then read a
// fixed sentence aloud and see what the recognizer heard; retry without limit). Logged: speaker starts and
// stops with how long the tone played, and for every mic attempt its number and the recognized text.
// Not tied to the answer re-answer chance.

import { COPY } from "./copy.js";
import { SpeechRecognitionManager } from "./speech.js";

const STT_FLUSH_TIMEOUT_MS = 5000;
const CHIME_EVERY_MS = 2400;

// one soft two-note chime (long, quiet decay so repeats blend instead of clicking)
function chime(ctx, out) {
  const t0 = ctx.currentTime;
  for (const [freq, at] of [[659.25, 0], [880, 0.3]]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0 + at);
    gain.gain.exponentialRampToValueAtTime(0.16, t0 + at + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 1.6);
    osc.connect(gain).connect(out);
    osc.start(t0 + at);
    osc.stop(t0 + at + 1.7);
  }
}

export function createDeviceTest({ $, client, onDone }) {
  const show = (id, on) => $(id).classList.toggle("hidden", !on);
  let starts = 0, stops = 0, attempts = 0, lastText = "", listening = false, stt = null, flushTimer = null;
  let ctx = null, master = null, tone = null, toneStartedAt = 0; // tone: the repeat timer while the chime plays

  const playing = () => tone !== null;

  function renderSpeaker() {
    $("p-spkPlay").textContent = playing() ? COPY.speakerStop : COPY.speakerPlay;
    $("p-spkPlay").classList.toggle("live", playing());
    show("p-spkNext", starts > 0);
    $("p-spkNext").disabled = playing(); // stop first, then go on
  }

  function startTone() {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.connect(ctx.destination);
    chime(ctx, master);
    tone = setInterval(() => chime(ctx, master), CHIME_EVERY_MS);
    toneStartedAt = performance.now();
    starts++;
    client.log("speaker_tone_start", null, { data: { count: starts } });
  }

  // log = false when the screen is left or reset without the participant pressing [정지]
  function stopTone({ log = true } = {}) {
    if (!playing()) return;
    clearInterval(tone);
    tone = null;
    const ms = Math.round(performance.now() - toneStartedAt);
    if (log) { stops++; client.log("speaker_tone_stop", null, { data: { count: stops, duration_ms: ms } }); }
    master.gain.setTargetAtTime(0, ctx.currentTime, 0.05); // fade out instead of cutting the chime off
    const closing = ctx;
    setTimeout(() => closing.close().catch(() => {}), 400);
    ctx = master = null;
  }

  function reset() {
    stopTone({ log: false });
    show("p-spkStep", true); show("p-micStep", false);
    renderSpeaker();
    show("p-micAsk", true); show("p-micTest", false);
    $("p-micAllow").textContent = COPY.micAllow;
    $("p-micErr").textContent = "";
  }

  $("p-spkPlay").addEventListener("click", () => {
    if (playing()) stopTone(); else startTone();
    renderSpeaker();
  });

  $("p-spkNext").addEventListener("click", () => { show("p-spkStep", false); show("p-micStep", true); });

  $("p-micAllow").addEventListener("click", async () => {
    $("p-micErr").textContent = "";
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop()); // only the permission is needed here
      show("p-micAsk", false); show("p-micTest", true);
      resetAttempt();
    } catch (e) {
      $("p-micErr").textContent = e.name === "NotFoundError" || e.name === "OverconstrainedError" ? COPY.micUnavailable : COPY.micDenied;
      $("p-micAllow").textContent = COPY.micRetry;
    }
  });

  function resetAttempt() {
    listening = false;
    lastText = "";
    $("p-micResult").innerHTML = `<span class="placeholder">${COPY.micResult}</span>`;
    $("p-micStatus").textContent = "";
    $("p-micAction").textContent = attempts > 0 ? COPY.micRetry : COPY.micStart;
    $("p-micAction").classList.remove("live");
    $("p-micAction").disabled = false;
  }

  function finish() {
    if (!listening) return;
    clearTimeout(flushTimer);
    listening = false;
    attempts++;
    const text = lastText.trim();
    client.log("mic_test_attempt", null, { data: { attempt: attempts, text } });
    $("p-micResult").textContent = text || COPY.micEmpty;
    $("p-micStatus").textContent = text ? "" : COPY.micStuck;
    $("p-micAction").textContent = COPY.micRetry;
    $("p-micAction").classList.remove("live");
    $("p-micAction").disabled = false;
    show("p-micNext", !!text);
  }

  $("p-micAction").addEventListener("click", () => {
    if (listening) {
      $("p-micAction").disabled = true;
      if (stt.isListening) { stt.stop(); flushTimer = setTimeout(finish, STT_FLUSH_TIMEOUT_MS); } else finish();
      return;
    }
    stt = new SpeechRecognitionManager();
    stt.onUpdate = (final, interim) => {
      lastText = [final, interim].filter(Boolean).join(" ");
      $("p-micResult").textContent = lastText || COPY.micResult;
    };
    stt.onError = (code) => { $("p-micStatus").textContent = COPY.micSttError(code); };
    stt.onStop = finish;
    show("p-micNext", false);
    lastText = "";
    $("p-micResult").innerHTML = `<span class="placeholder">${COPY.micResult}</span>`;
    if (!stt.start()) { $("p-micStatus").textContent = COPY.micSttError("start"); return; }
    listening = true;
    $("p-micAction").textContent = COPY.micStop;
    $("p-micAction").classList.add("live");
    $("p-micStatus").textContent = COPY.micListening;
  });

  $("p-micNext").addEventListener("click", () => {
    client.log("device_test_done");
    onDone();
  });

  return { reset };
}

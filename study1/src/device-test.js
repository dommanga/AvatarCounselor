// Device test: speaker (a short non-speech chime, replayable) then microphone (permission, then read a
// fixed sentence aloud and see what the recognizer heard; retry without limit). Logged: the number of
// chime plays, and for every mic attempt its number and the recognized text. Not tied to the
// answer re-answer chance.

import { COPY } from "./copy.js";
import { SpeechRecognitionManager } from "./speech.js";

const STT_FLUSH_TIMEOUT_MS = 5000;

function playChime() {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  const t0 = ctx.currentTime;
  for (const [freq, at] of [[659.25, 0], [880, 0.22]]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0 + at);
    gain.gain.exponentialRampToValueAtTime(0.25, t0 + at + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.6);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + at);
    osc.stop(t0 + at + 0.65);
  }
  setTimeout(() => ctx.close().catch(() => {}), 1500);
}

export function createDeviceTest({ $, client, onDone }) {
  const show = (id, on) => $(id).classList.toggle("hidden", !on);
  let plays = 0, attempts = 0, lastText = "", listening = false, stt = null, flushTimer = null;

  function reset() {
    show("p-spkStep", true); show("p-micStep", false);
    show("p-spkNext", plays > 0);
    $("p-spkPlay").textContent = plays > 0 ? COPY.speakerReplay : COPY.speakerPlay;
    show("p-micAsk", true); show("p-micTest", false);
    $("p-micAllow").textContent = COPY.micAllow;
    $("p-micErr").textContent = "";
  }

  $("p-spkPlay").addEventListener("click", () => {
    playChime();
    plays++;
    client.log("speaker_tone_played", null, { data: { count: plays } });
    $("p-spkPlay").textContent = COPY.speakerReplay;
    show("p-spkNext", true);
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

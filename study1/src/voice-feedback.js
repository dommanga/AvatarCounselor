// Voice condition: plays the stored spoken feedback. The page never gets the feedback text. Autoplay; when
// the browser refuses play(), a [피드백 듣기] button appears (audio_play_blocked). No pause, seek bar or speed.
// After the first complete listening [다시 듣기] and [설문으로 넘어가기] are enabled. Logged: audio_started (the
// voice condition's feedback_shown), audio_progress (every PROGRESS_EVERY_MS: how far the participant got),
// audio_ended (with the time the tab was hidden during that listening), audio_replay (count),
// audio_play_blocked.

import { COPY } from "./copy.js";

const PROGRESS_EVERY_MS = 2000;
const secs = (x) => Math.round(x * 100) / 100;

export function createVoiceFeedback({ $, client, getTracker, onNext }) {
  const show = (id, on) => $(id).classList.toggle("hidden", !on);
  let audio = null, objectUrl = null, qid = null;
  let startedLogged = false, ended = false, replays = 0, progressTimer = null, mark = null, token = 0, reveal = {};

  const snapshot = () => getTracker()?.snapshot() ?? { hidden: 0, blur: 0 };
  const position = () => (audio ? secs(audio.currentTime) : 0);

  function stopProgress() { clearInterval(progressTimer); progressTimer = null; }

  // Stops playback and frees the file (leaving the screen, or a new start).
  function dispose() {
    token++;
    stopProgress();
    if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); audio = null; }
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
  }

  function onPlaying() {
    show("p-voiceWave", true);
    mark = snapshot();
    if (!startedLogged) {
      startedLogged = true;
      client.log("audio_started", qid, { data: { duration_s: secs(audio.duration), ...reveal } }); // the reveal: how long the loading screen held it
    }
    if (!progressTimer) {
      progressTimer = setInterval(() => {
        if (audio && !audio.paused) client.log("audio_progress", qid, { data: { position_s: position(), duration_s: secs(audio.duration), play: replays } });
      }, PROGRESS_EVERY_MS);
    }
  }

  function onEnded() {
    stopProgress();
    show("p-voiceWave", false);
    const now = snapshot();
    const away = { hidden_ms: Math.round(now.hidden - (mark?.hidden ?? 0)), blur_ms: Math.round(now.blur - (mark?.blur ?? 0)) };
    if (!ended) {
      ended = true;
      client.log("audio_ended", qid, { data: { duration_s: secs(audio.duration), position_s: secs(audio.duration), ...away } });
      $("p-voiceReplay").disabled = false;
      $("p-voiceNext").disabled = false;
    } else {
      client.log("audio_progress", qid, { data: { position_s: secs(audio.duration), duration_s: secs(audio.duration), play: replays, complete: true, ...away } });
    }
  }

  async function tryPlay() {
    try {
      await audio.play();
      show("p-voicePlay", false);
    } catch (e) {
      if (e?.name === "NotAllowedError") { // the browser wants a click first
        client.log("audio_play_blocked", qid, { data: { error: e.name } });
        show("p-voicePlay", true);
      } else {
        $("p-voiceErr").textContent = COPY.voiceLoadError;
        show("p-voiceRetry", true);
      }
    }
  }

  // question: the question id; devText: shown in the dev panel only (test sessions)
  async function start(question, { devText = null, devMode = false, reveal: revealData = {} } = {}) {
    dispose();
    const mine = token;
    qid = question; startedLogged = false; ended = false; replays = 0; mark = null; reveal = revealData;
    show("p-voiceWave", false); show("p-voicePlay", false); show("p-voiceRetry", false);
    $("p-voiceErr").textContent = "";
    $("p-voiceReplay").disabled = true;
    $("p-voiceNext").disabled = true;
    show("p-voiceDev", !!(devMode && devText));
    if (devMode && devText) $("p-voiceDevText").textContent = devText;

    let blob;
    try {
      blob = await client.feedbackAudio(question);
    } catch (e) {
      if (mine !== token) return;
      if (![401, 409, 410].includes(e.status)) { $("p-voiceErr").textContent = COPY.voiceLoadError; show("p-voiceRetry", true); }
      return;
    }
    if (mine !== token) return;
    objectUrl = URL.createObjectURL(blob);
    audio = new Audio(objectUrl); // no controls, never attached to the page
    audio.preload = "auto";
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("ended", onEnded);
    // no pausing: if something outside the page pauses it (a media key), carry on
    audio.addEventListener("pause", () => { if (audio && !audio.ended && mine === token) audio.play().catch(() => {}); });
    await tryPlay();
  }

  $("p-voicePlay").addEventListener("click", () => { if (audio) tryPlay(); });
  $("p-voiceRetry").addEventListener("click", () => start(qid, { devMode: false }));
  $("p-voiceReplay").addEventListener("click", () => {
    if (!audio || !ended) return;
    replays++;
    client.log("audio_replay", qid, { data: { count: replays } });
    audio.currentTime = 0;
    audio.play().catch(() => {});
  });
  $("p-voiceNext").addEventListener("click", () => { if (ended) onNext({ replays }); });

  return { start, dispose };
}

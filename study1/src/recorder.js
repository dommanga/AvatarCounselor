// Records one answer attempt. Nothing is shown to the participant except a volume level:
//  - speech recognition: every finalized result is saved to the server as a segment as it arrives, and
//    recognition is restarted when the browser ends it on its own (stt_restart);
//  - audio: MediaRecorder in chunkMs pieces, each uploaded as it is cut (when the server has audio on);
//  - the answer itself is confirmed by the server from the saved segments (api answer), not from here.

import { SpeechRecognitionManager } from "./speech.js";

const STT_FLUSH_TIMEOUT_MS = 5000; // the browser may never fire onend after stop()
const UPLOAD_FLUSH_TIMEOUT_MS = 10000;
const MIMES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

export function createAnswerRecorder({ client, questionId, attempt, recordAudio, chunkMs, onVolume, onError, onSttRestart }) {
  let stream = null, rec = null, ctx = null, raf = 0, stt = null;
  let segSeq = 0, audioSeq = 0, stopped = false;
  const finals = [];

  const saveSegment = (text) => {
    if (!text) return;
    finals.push(text);
    client.segment(questionId, attempt, segSeq++, text);
  };

  function startMeter() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) { const x = (v - 128) / 128; sum += x * x; }
        onVolume?.(Math.min(1, Math.sqrt(sum / buf.length) * 4));
        raf = requestAnimationFrame(tick);
      };
      tick();
    } catch { /* the meter is cosmetic */ }
  }

  // -> { ok: true } | { ok: false, reason: <DOMException name> }
  async function start() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      return { ok: false, reason: e.name };
    }
    startMeter();
    if (recordAudio) {
      const mimeType = MIMES.find((m) => MediaRecorder.isTypeSupported(m));
      rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      rec.ondataavailable = (e) => { if (e.data?.size) client.audioChunk(questionId, attempt, audioSeq++, e.data); };
      rec.start(chunkMs);
    }
    stt = new SpeechRecognitionManager();
    stt.onFinal = saveSegment;
    stt.onRestart = () => onSttRestart?.();
    stt.onError = (code) => onError?.(code);
    stt.start();
    return { ok: true };
  }

  // Stops everything, saves text the browser never finalized, and waits for the uploads.
  // -> { clientTranscript }  what this browser heard (the server's saved segments are what counts)
  async function stop() {
    if (stopped) return { clientTranscript: finals.join(" ") };
    stopped = true;
    cancelAnimationFrame(raf);
    onVolume?.(0);
    if (stt?.isListening) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, STT_FLUSH_TIMEOUT_MS);
        stt.onStop = () => { clearTimeout(timer); resolve(); };
        stt.stop();
      });
    }
    saveSegment(stt?.interimTranscript?.trim());
    if (rec && rec.state !== "inactive") {
      await new Promise((resolve) => { rec.onstop = resolve; rec.stop(); }); // the last chunk arrives before onstop
    }
    stream?.getTracks().forEach((t) => t.stop());
    ctx?.close().catch(() => {});
    await client.flushUploads(UPLOAD_FLUSH_TIMEOUT_MS);
    return { clientTranscript: finals.join(" ") };
  }

  // Abandon without saving anything further (screen changed under it).
  function abort() {
    stopped = true;
    cancelAnimationFrame(raf);
    try { stt?.stop(); } catch { /* already stopped */ }
    try { if (rec && rec.state !== "inactive") rec.stop(); } catch { /* already stopped */ }
    stream?.getTracks().forEach((t) => t.stop());
    ctx?.close().catch(() => {});
  }

  return { start, stop, abort };
}

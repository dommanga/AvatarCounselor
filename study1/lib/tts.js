// Voice feedback: normalize the feedback text for speech (minimal), synthesize it with ElevenLabs
// (retrying), measure the mp3. The text that is spoken must say what the text condition shows, so the
// rules only remove symbols that would be read literally or break the flow; every applied rule and the
// text before and after are stored with the audio (feedback_audio).

import { TTS } from "./config.js";

// ---------- text ----------
// Rules (version TTS.textRulesVersion). The Stage 2 corpus output (18 samples) triggered none of them.
const RULES = [
  { id: "strip_markdown", rx: /\*\*|__|`+|^#{1,6}\s+/gm, to: "" },
  { id: "strip_list_markers", rx: /^[ \t]*(?:[-•·*]|\d{1,2}[.)])[ \t]+/gm, to: "" },
  { id: "strip_emoji", rx: /[\u{1F300}-\u{1FAFF}☀-➿️]/gu, to: "" },
  { id: "collapse_whitespace", rx: /\s+/g, to: " " },
];

// -> { text, rules: [{ id, count }] }  (only the rules that changed something)
export function normalizeForTts(original) {
  let text = String(original);
  const rules = [];
  for (const r of RULES) {
    let count = 0;
    text = text.replace(r.rx, (m) => { if (m !== r.to) count++; return r.to; }); // a space kept as a space is no change
    if (count) rules.push({ id: r.id, count });
  }
  return { text: text.trim(), rules };
}

// ---------- mp3 ----------
// Duration from the MPEG frame headers (Layer III), so no extra dependency and no estimate from the bitrate.
export function mp3DurationSeconds(buf) {
  let i = 0;
  if (buf.length > 10 && buf.toString("latin1", 0, 3) === "ID3") {
    i = 10 + (((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f));
  }
  const BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
  const BR2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
  const SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  let samples = 0, sampleRate = 0;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) { i++; continue; }
    const ver = (buf[i + 1] >> 3) & 3;      // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const layer = (buf[i + 1] >> 1) & 3;    // 1 = Layer III
    const br = buf[i + 2] >> 4, sr = (buf[i + 2] >> 2) & 3, pad = (buf[i + 2] >> 1) & 1;
    if (ver === 1 || layer !== 1 || br === 0 || br === 15 || sr === 3) { i++; continue; }
    const bitrate = (ver === 3 ? BR1 : BR2)[br] * 1000;
    const rate = SR[ver][sr];
    samples += ver === 3 ? 1152 : 576;
    sampleRate = rate;
    i += Math.floor(((ver === 3 ? 144 : 72) * bitrate) / rate) + pad;
  }
  return sampleRate ? samples / sampleRate : 0;
}

// ---------- ElevenLabs ----------
// ElevenLabs rejects language_code for the models that do not support language enforcement.
export const LANGUAGE_CODE_MODELS = new Set(["eleven_flash_v2_5", "eleven_turbo_v2_5"]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs fn up to 1 + retries times. -> { value, attempts }   (throws the last error)
export async function withRetries(fn, { retries = TTS.retries, delays = TTS.retryDelaysMs } = {}) {
  let last, attempt = 0;
  while (attempt <= retries) {
    attempt++;
    try { return { value: await fn(attempt), attempts: attempt }; } catch (e) {
      last = e;
      if (e.noRetry || attempt > retries) break;
      await sleep(delays[Math.min(attempt - 1, delays.length - 1)]);
    }
  }
  throw Object.assign(last instanceof Error ? last : new Error(String(last)), { attempts: attempt });
}

async function requestOnce(text, { modelId, voiceSettings, voiceId, outputFormat, languageCode }) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw Object.assign(new Error("ELEVENLABS_API_KEY is not set"), { noRetry: true });
  const body = { text, model_id: modelId, voice_settings: voiceSettings };
  if (languageCode && LANGUAGE_CODE_MODELS.has(modelId)) body.language_code = languageCode;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TTS.requestTimeoutMs);
  const t0 = performance.now();
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${outputFormat}`, {
      method: "POST", signal: ctl.signal,
      headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`ElevenLabs HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const audio = Buffer.from(await r.arrayBuffer());
    if (!audio.length) throw new Error("ElevenLabs returned an empty body");
    return { audio, latency_ms: Math.round(performance.now() - t0), request_id: r.headers.get("request-id") };
  } finally {
    clearTimeout(timer);
  }
}

// -> { audio: Buffer, latency_ms (successful request), total_ms (all attempts), attempts, request_id, model_id,
//      voice_id, voice_settings, output_format }
// Options override the fixed config (voice-eval compares models); retries: 0 measures a single attempt.
export async function synthesize(text, opts = {}) {
  const cfg = {
    modelId: opts.modelId ?? TTS.modelId, voiceSettings: opts.voiceSettings ?? TTS.voiceSettings, voiceId: opts.voiceId ?? TTS.voiceId,
    outputFormat: TTS.outputFormat, languageCode: TTS.languageCode,
  };
  const t0 = performance.now();
  const { value, attempts } = await withRetries((n) => requestOnce(text, cfg), { retries: opts.retries ?? TTS.retries });
  return {
    ...value, total_ms: Math.round(performance.now() - t0), attempts,
    model_id: cfg.modelId, voice_id: cfg.voiceId, voice_settings: cfg.voiceSettings, output_format: cfg.outputFormat,
  };
}

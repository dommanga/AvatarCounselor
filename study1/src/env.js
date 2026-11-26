// Environment check before consent: desktop Chrome with speech recognition and audio recording.
// Pure: takes the window to inspect, and never talks to the server (opening a link must not change
// the token's state when the browser is unsupported).

const OTHER_BROWSERS = /(Edg|OPR|SamsungBrowser|Whale|Vivaldi|YaBrowser|CriOS|FxiOS)\//;

export function checkEnvironment(win = window) {
  const nav = win.navigator;
  const ua = nav.userAgent || "";
  const brands = (nav.userAgentData?.brands || []).map((b) => b.brand);
  const mobile = nav.userAgentData?.mobile ?? /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  // Chromium-based Edge/Opera also report "Chromium"; only Chrome itself lists "Google Chrome"
  const chrome = brands.length ? brands.includes("Google Chrome") : /Chrome\//.test(ua) && !OTHER_BROWSERS.test(ua);
  const speech = !!(win.SpeechRecognition || win.webkitSpeechRecognition);
  const recording = !!(win.MediaRecorder && nav.mediaDevices?.getUserMedia && (win.AudioContext || win.webkitAudioContext));
  return { ok: chrome && !mobile && speech && recording, chrome, mobile, speech, recording };
}

// Pilot STT — Web Speech API. Explicit start/stop, no auto-turn-passing.
// Differs from the AvatarCounselor version: no debounced auto-submit; recognition
// is kept alive across silence (Chrome ends it on pauses) but a manual stop suppresses restart.

export class SpeechRecognitionManager {
  constructor() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.supported = !!SR;
    if (!this.supported) return;

    this.recognition = new SR();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = "en-US"; // mock interview is in English
    this.recognition.maxAlternatives = 1;

    this.isListening = false;
    this.manualStop = false;
    this.finalTranscript = "";
    this.interimTranscript = "";

    // Callbacks set by the app
    this.onUpdate = null;        // (finalText, interimText) => void
    this.onStatusChange = null;  // (isListening) => void
    this.onError = null;         // (errorCode) => void

    this.recognition.onresult = (e) => {
      this.interimTranscript = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) this.finalTranscript += t + " ";
        else this.interimTranscript += t;
      }
      this.onUpdate?.(this.finalTranscript.trim(), this.interimTranscript.trim());
    };

    this.recognition.onerror = (e) => {
      if (e.error === "no-speech") return; // silence is normal, keep going
      this.onError?.(e.error);
    };

    // Chrome fires onend on silence. Keep alive unless the user pressed stop.
    this.recognition.onend = () => {
      if (this.isListening && !this.manualStop) {
        try { this.recognition.start(); } catch { /* already starting */ }
      } else {
        this.isListening = false;
        this.onStatusChange?.(false);
      }
    };

    this.recognition.onstart = () => { this.onStatusChange?.(true); };
  }

  start() {
    if (!this.supported || this.isListening) return false;
    this.manualStop = false;
    this.isListening = true;
    this.finalTranscript = "";
    this.interimTranscript = "";
    try { this.recognition.start(); return true; }
    catch { this.isListening = false; return false; }
  }

  stop() {
    if (!this.isListening) return;
    this.manualStop = true;      // suppress the onend auto-restart
    this.recognition.stop();
  }

  getTranscript() {
    return this.finalTranscript.trim();
  }
}

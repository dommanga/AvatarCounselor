/**
 * TTSManager - Text-to-Speech using Web Speech API
 * Minimal implementation for Phase 1-4
 */
export class TTSManager {
  constructor() {
    this.synth = window.speechSynthesis;
    this.currentUtterance = null;
    this.isSpeaking = false;
    this.volume = 1.0;

    // Callbacks
    this.onStart = null;
    this.onEnd = null;
    this.onError = null;

    // Load available voices
    this.voices = [];
    this.loadVoices();

    // Voice loading can be async in some browsers
    if (speechSynthesis.onvoiceschanged !== undefined) {
      speechSynthesis.onvoiceschanged = () => this.loadVoices();
    }
  }

  loadVoices() {
    this.voices = this.synth.getVoices();
    if (this.voices.length > 0) {
      console.log(`🔊 Loaded ${this.voices.length} TTS voices`);
    }
  }

  selectVoice(language) {
    if (this.voices.length === 0) {
      this.loadVoices();
    }

    // Try exact match first
    let voice = this.voices.find((v) => v.lang === language);

    // Try language prefix match
    if (!voice) {
      const langPrefix = language.split("-")[0];
      voice = this.voices.find((v) => v.lang.startsWith(langPrefix));
    }

    // Fallback to default voice
    if (!voice && this.voices.length > 0) {
      voice = this.voices.find((v) => v.default) || this.voices[0];
    }

    return voice;
  }

  speak(text, language = "ko-KR") {
    return new Promise((resolve, reject) => {
      // Stop any ongoing speech
      this.stop();

      if (!text || text.trim().length === 0) {
        resolve();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = language;
      utterance.volume = this.volume;
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      // Select appropriate voice
      const voice = this.selectVoice(language);
      if (voice) {
        utterance.voice = voice;
        console.log(`🔊 Using TTS voice: ${voice.name}`);
      }

      // Event handlers
      utterance.onstart = () => {
        this.isSpeaking = true;
        if (this.onStart) this.onStart();
      };

      utterance.onend = () => {
        this.isSpeaking = false;
        this.currentUtterance = null;
        if (this.onEnd) this.onEnd();
        resolve();
      };

      utterance.onerror = (event) => {
        this.isSpeaking = false;
        this.currentUtterance = null;
        console.error("TTS error:", event.error);
        if (this.onError) this.onError(event.error);
        reject(new Error(`TTS error: ${event.error}`));
      };

      this.currentUtterance = utterance;
      this.synth.speak(utterance);
    });
  }

  stop() {
    if (this.synth.speaking) {
      this.synth.cancel();
      this.isSpeaking = false;
      this.currentUtterance = null;
    }
  }

  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
  }
}

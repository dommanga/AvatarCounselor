/**
 * TTSManager - Text-to-Speech using OpenAI TTS API
 * Replaced Web Speech API with OpenAI for natural voice quality
 */
export class TTSManager {
  constructor(apiBase = "http://localhost:3000") {
    this.apiBase = apiBase;
    this.audio = null;
    this.isSpeaking = false;
    this.volume = 1.0;

    // Callbacks
    this.onStart = null;
    this.onEnd = null;
    this.onError = null;

    console.log("🔊 TTSManager initialized (OpenAI TTS)");
  }

  async speak(text, language = "ko-KR") {
    // Stop any ongoing speech
    this.stop();

    if (!text || text.trim().length === 0) {
      return;
    }

    try {
      console.log(`🔊 Requesting TTS: ${text.substring(0, 50)}...`);

      // Request TTS from server
      const response = await fetch(`${this.apiBase}/api/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language }),
      });
      const contentType = response.headers.get("Content-Type");
      console.log("🔊 TTS response Content-Type:", contentType);

      if (!response.ok) {
        const errorText = await response.text();
        console.error("TTS API response:", errorText);
        throw new Error(`TTS API error: ${response.status}`);
      }

      if (!contentType || !contentType.includes("audio")) {
        const text = await response.text();
        console.error("🔊 Unexpected response:", text);
        throw new Error("TTS response is not audio");
      }

      // Get audio blob
      const audioBlob = await response.blob();
      console.log("🔊 Audio blob size:", audioBlob.size, "bytes");
      if (audioBlob.size === 0) {
        throw new Error("TTS returned empty audio");
      }

      const audioUrl = URL.createObjectURL(audioBlob);

      // Create audio element
      this.audio = new Audio(audioUrl);
      this.audio.volume = this.volume;

      // Set up event handlers
      this.audio.onplay = () => {
        this.isSpeaking = true;
        if (this.onStart) this.onStart();
        console.log("🔊 TTS playback started");
      };

      this.audio.onended = () => {
        this.isSpeaking = false;
        URL.revokeObjectURL(audioUrl); // Clean up
        if (this.onEnd) this.onEnd();
        console.log("🔇 TTS playback ended");
      };

      this.audio.onerror = (event) => {
        this.isSpeaking = false;
        URL.revokeObjectURL(audioUrl);
        console.error("❌ TTS playback error:", event);
        if (this.onError) this.onError("playback-error");
      };

      // Play audio
      await this.audio.play();
    } catch (error) {
      console.error("❌ TTS error:", error);
      this.isSpeaking = false;
      if (this.onError) this.onError(error.message);
      throw error;
    }
  }

  stop() {
    if (this.audio) {
      // Check if actually playing before triggering interrupted
      const wasPlaying = this.isSpeaking;

      this.audio.pause();
      this.audio.currentTime = 0;
      this.isSpeaking = false;
      this.audio = null;

      // Only trigger interrupted if it was actually playing
      if (wasPlaying && this.onError) {
        this.onError("interrupted");
      }
    }
  }

  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.audio) {
      this.audio.volume = this.volume;
    }
  }
}

/**
 * TTSManager - Text-to-Speech using OpenAI TTS API
 * Replaced Web Speech API with OpenAI for natural voice quality
 */
export class TTSManager {
  constructor(apiBase = "http://localhost:3000") {
    this.apiBase = apiBase;
    this.audio = null;
    this.currentAudioUrl = null; // Track current blob URL for cleanup
    this.isSpeaking = false;
    this.volume = 1.0;

    // Callbacks
    this.onStart = null;
    this.onEnd = null;
    this.onError = null;

    console.log("🔊 TTSManager initialized (OpenAI TTS)");
  }

  async speak(text, language = "ko-KR") {
    // DEBUG: Check for duplicate/concurrent calls
    console.log(`🔍 [DEBUG] speak() called - isSpeaking: ${this.isSpeaking}, currentAudioUrl: ${this.currentAudioUrl}`);

    // Clean up previous audio without triggering callbacks
    if (this.audio) {
      console.log(`🔍 [DEBUG] Cleaning up previous audio element`);
      this.audio.pause();
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio = null;
    }

    // Clean up previous blob URL
    this.cleanupAudio();
    this.isSpeaking = false;

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
      console.log(`🔍 [DEBUG] Before setting currentAudioUrl: ${this.currentAudioUrl}`);
      this.currentAudioUrl = audioUrl; // Store for cleanup
      console.log(`🔍 [DEBUG] After setting currentAudioUrl: ${this.currentAudioUrl}`);

      // Create audio element
      this.audio = new Audio(audioUrl);
      this.audio.volume = this.volume;
      console.log("🔊 Audio element created successfully");

      // Set up event handlers
      this.audio.onended = () => {
        this.isSpeaking = false;
        this.cleanupAudio();
        if (this.onEnd) this.onEnd();
        console.log("🔇 TTS playback ended");
      };

      this.audio.onerror = (event) => {
        console.log(`🔍 [DEBUG] audio.onerror triggered - isSpeaking: ${this.isSpeaking}, currentAudioUrl: ${this.currentAudioUrl}`);
        this.isSpeaking = false;
        this.cleanupAudio();
        console.error("❌ TTS playback error:", event);
        if (this.onError) this.onError("playback-error");
      };

      // Start callbacks BEFORE playing (more reliable timing)
      this.isSpeaking = true;
      console.log("🔊 TTS playback starting");

      // Wait for onStart callback to complete (if it's async)
      if (this.onStart) {
        await this.onStart();
      }

      // Play audio
      await this.audio.play();
    } catch (error) {
      console.error("❌ TTS error:", error);
      this.isSpeaking = false;
      if (this.onError) this.onError(error.message);
      throw error;
    }
  }

  cleanupAudio() {
    console.log(`🔍 [DEBUG] cleanupAudio() called - currentAudioUrl: ${this.currentAudioUrl}`);
    if (this.currentAudioUrl) {
      URL.revokeObjectURL(this.currentAudioUrl);
      this.currentAudioUrl = null;
      console.log("🧹 Audio URL cleaned up");
    }
  }

  stop() {
    console.log(`🔍 [DEBUG] stop() called - isSpeaking: ${this.isSpeaking}, audio exists: ${!!this.audio}`);
    if (this.audio) {
      // Check if actually playing before triggering interrupted
      const wasPlaying = this.isSpeaking;

      this.audio.pause();
      this.audio.currentTime = 0;
      this.isSpeaking = false;
      this.audio = null;
      this.cleanupAudio();

      // Only trigger interrupted if it was actually playing
      if (wasPlaying && this.onError) {
        console.log(`🔍 [DEBUG] Triggering interrupted callback`);
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

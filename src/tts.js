/**
 * TTSManager - Text-to-Speech Playback Controller
 * Uses APIManager for TTS generation, handles audio playback
 */
export class TTSManager {
  constructor(apiManager) {
    this.apiManager = apiManager;
    this.audio = null;
    this.currentAudioUrl = null;
    this.isSpeaking = false;
    this.volume = 1.0;

    // Callbacks
    this.onStart = null;
    this.onEnd = null;
    this.onError = null;

    // console.log("🔊 TTSManager initialized");
  }

  async speak(text, verbalStyle = "directing") {
    // Clean up previous audio
    if (this.audio) {
      this.audio.pause();
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio = null;
    }

    this.cleanupAudio();
    this.isSpeaking = false;

    if (!text || text.trim().length === 0) {
      return;
    }

    try {
      // console.log(`🔊 Requesting TTS`);

      // Use APIManager instead of direct fetch
      const audioBuffer = await this.apiManager.generateTTS(text, verbalStyle);

      // Convert ArrayBuffer to Blob
      const audioBlob = new Blob([audioBuffer], { type: "audio/mpeg" });

      if (audioBlob.size === 0) {
        throw new Error("TTS returned empty audio");
      }

      const audioUrl = URL.createObjectURL(audioBlob);
      this.currentAudioUrl = audioUrl;

      // Create audio element
      this.audio = new Audio(audioUrl);
      this.audio.volume = this.volume;
      // console.log("🔊 Audio element created successfully");

      // Set up event handlers
      this.audio.onended = () => {
        this.isSpeaking = false;
        this.cleanupAudio();
        if (this.onEnd) this.onEnd();
        // console.log("🔇 TTS playback ended");
      };

      this.audio.onerror = (event) => {
        this.isSpeaking = false;
        this.cleanupAudio();
        console.error("❌ TTS playback error:", event);
        if (this.onError) this.onError("playback-error");
      };

      // Start callbacks BEFORE playing
      this.isSpeaking = true;
      // console.log("🔊 TTS playback starting");

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
    if (this.currentAudioUrl) {
      URL.revokeObjectURL(this.currentAudioUrl);
      this.currentAudioUrl = null;
      // console.log("🧹 Audio URL cleaned up");
    }
  }

  stop() {
    if (this.audio) {
      const wasPlaying = this.isSpeaking;

      this.audio.pause();
      this.audio.currentTime = 0;
      this.isSpeaking = false;
      this.audio = null;
      this.cleanupAudio();

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

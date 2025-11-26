/**
 * RealtimeAudioPlayer - Streaming PCM16 Audio Player
 * Plays audio chunks in real-time as they arrive from Realtime API
 */
export class RealtimeAudioPlayer {
  constructor() {
    this.audioContext = null;
    this.sampleRate = 24000; // Realtime API uses 24kHz
    this.isPlaying = false;
    this.audioQueue = [];
    this.currentSource = null;
    this.nextStartTime = 0;
    this.scheduledChunks = 0;

    // Callbacks
    this.onStart = null;
    this.onEnd = null;
    this.onError = null;
  }

  /**
   * Initialize AudioContext
   */
  async initialize() {
    if (this.audioContext) {
      return;
    }

    try {
      this.audioContext = new (window.AudioContext ||
        window.webkitAudioContext)({
        sampleRate: this.sampleRate,
      });

      // Resume context if suspended (browser autoplay policy)
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }

      console.log("🔊 Audio player initialized");
    } catch (error) {
      console.error("❌ Audio player initialization error:", error);
      this.onError?.(error);
      throw error;
    }
  }

  /**
   * Start playing (call this when first audio chunk arrives)
   */
  start() {
    if (this.isPlaying) {
      return;
    }

    this.isPlaying = true;
    this.nextStartTime = this.audioContext.currentTime;
    this.scheduledChunks = 0;
    console.log("🎵 Audio playback started");
    this.onStart?.();
  }

  /**
   * Add audio chunk and play immediately
   * @param {string} base64Audio - Base64 encoded PCM16 audio
   */
  async addChunk(base64Audio) {
    if (!this.audioContext) {
      await this.initialize();
    }

    if (!this.isPlaying) {
      this.start();
    }

    try {
      // Decode base64 to ArrayBuffer
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Convert to Int16Array (PCM16)
      const int16Array = new Int16Array(bytes.buffer);

      // Convert to Float32Array for Web Audio API
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0; // Normalize to -1.0 to 1.0
      }

      // Create AudioBuffer
      const audioBuffer = this.audioContext.createBuffer(
        1, // Mono
        float32Array.length,
        this.sampleRate
      );

      audioBuffer.getChannelData(0).set(float32Array);

      // Schedule playback
      this.scheduleAudioBuffer(audioBuffer);
    } catch (error) {
      console.error("❌ Error adding audio chunk:", error);
      this.onError?.(error);
    }
  }

  /**
   * Schedule audio buffer for seamless playback
   */
  scheduleAudioBuffer(audioBuffer) {
    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);

    // Calculate start time for seamless playback
    const now = this.audioContext.currentTime;
    const startTime = Math.max(now, this.nextStartTime);

    source.start(startTime);
    this.scheduledChunks++;

    // Update next start time
    this.nextStartTime = startTime + audioBuffer.duration;

    // Handle playback end
    source.onended = () => {
      this.scheduledChunks--;

      // If no more chunks scheduled, playback is done
      if (this.scheduledChunks === 0 && !this.isPlaying) {
        this.handlePlaybackEnd();
      }
    };

    this.currentSource = source;
  }

  /**
   * Stop playback immediately
   */
  stop() {
    if (!this.isPlaying) {
      return;
    }

    console.log("⏹️ Stopping audio playback");
    this.isPlaying = false;

    // Stop current source
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch (e) {
        // Already stopped
      }
      this.currentSource = null;
    }

    // Clear queue
    this.audioQueue = [];
    this.scheduledChunks = 0;
    this.nextStartTime = 0;

    this.onEnd?.();
  }

  /**
   * Mark end of stream (no more chunks coming)
   */
  endStream() {
    console.log("🏁 Audio stream ended");
    this.isPlaying = false;

    // If no chunks are scheduled, end immediately
    if (this.scheduledChunks === 0) {
      this.handlePlaybackEnd();
    }
  }

  /**
   * Handle playback end
   */
  handlePlaybackEnd() {
    console.log("✅ Audio playback completed");
    this.isPlaying = false;
    this.scheduledChunks = 0;
    this.nextStartTime = 0;
    this.onEnd?.();
  }

  /**
   * Get current playback state
   */
  get playing() {
    return this.isPlaying;
  }

  /**
   * Clean up resources
   */
  dispose() {
    this.stop();

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}

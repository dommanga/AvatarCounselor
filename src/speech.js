// Speech recognition manager using Web Speech API
export class SpeechRecognitionManager {
  constructor() {
    // Check browser compatibility
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.error("Web Speech API not supported in this browser");
      this.supported = false;
      return;
    }

    this.supported = true;
    this.recognition = new SpeechRecognition();
    this.isListening = false;
    this.transcript = "";
    this.interimTranscript = "";

    // Configuration
    this.recognition.continuous = true; // Keep listening
    this.recognition.interimResults = true; // Get partial results
    this.recognition.lang = "ko-KR"; // Korean language (change to 'en-US' if needed)
    this.recognition.maxAlternatives = 1;

    // Callbacks (to be set by user)
    this.onTranscriptUpdate = null;
    this.onFinalTranscript = null;
    this.onError = null;
    this.onStatusChange = null;

    // Final transcript debouncing
    this._finalDebounceTimer = null;
    this._pendingFinalTranscript = "";
    this._accumulatedTranscript = ""; // Accumulate multiple final transcripts

    // Debounce configuration
    this.config = {
      shortPhraseDelay: 500, // Increased to prevent premature sending
      longPhraseDelay: 1500,
      shortPhraseThreshold: 10, // short - long criteria
    };

    // Guard against duplicate start() calls
    this._isStarting = false;

    this.setupEventHandlers();
  }

  setupEventHandlers() {
    // Handle results
    this.recognition.onresult = (event) => {
      this.interimTranscript = "";
      let hasFinal = false;

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;

        if (event.results[i].isFinal) {
          hasFinal = true;
          this.transcript += transcript + " ";
          this._pendingFinalTranscript = transcript.trim();
        } else {
          this.interimTranscript += transcript;
        }
      }

      // When Final, debounce processing
      if (hasFinal) {
        // Add to accumulated transcript
        this._accumulatedTranscript = (
          this._accumulatedTranscript +
          " " +
          this._pendingFinalTranscript
        ).trim();

        if (this._finalDebounceTimer) {
          clearTimeout(this._finalDebounceTimer);
        }

        const wordCount = this._accumulatedTranscript.split(/\s+/).length;
        const delay =
          wordCount <= this.config.shortPhraseThreshold
            ? this.config.shortPhraseDelay
            : this.config.longPhraseDelay;

        console.log(`⏱️  Final debounce: ${delay}ms`);

        this._finalDebounceTimer = setTimeout(() => {
          if (this.onFinalTranscript && this._accumulatedTranscript) {
            console.log("✅ Processing accumulated transcript");
            this.onFinalTranscript(this._accumulatedTranscript);
            this._accumulatedTranscript = "";
            this._pendingFinalTranscript = "";
          }
        }, delay);
      }

      // user keep speaking - cancel timer but keep accumulated transcript
      if (this.interimTranscript && this._pendingFinalTranscript) {
        console.log(
          "⏭️  Speech continuing, canceling debounce timer (keeping accumulated)"
        );
        clearTimeout(this._finalDebounceTimer);
        this._pendingFinalTranscript = "";
        // Note: _accumulatedTranscript is kept for the next final transcript
      }

      // Update callback
      if (this.onTranscriptUpdate) {
        this.onTranscriptUpdate(this.transcript, this.interimTranscript);
      }
    };

    // Handle errors
    this.recognition.onerror = (event) => {
      // Ignore 'no-speech' - it's a normal situation (user is silent)
      // No need to log or trigger callbacks for this
      if (event.error === "no-speech") {
        return; // Silently continue, let onend handle auto-restart
      }

      // Log other actual errors
      console.error("Speech recognition error:", event.error);

      if (this.onError) {
        this.onError(event.error);
      }

      // Don't manually restart here - let onend handle it to avoid duplicate start() calls
      // (onend will automatically restart if isListening is still true)
    };

    // Handle end of recognition
    this.recognition.onend = () => {
      // Reset starting flag
      this._isStarting = false;

      // Auto-restart if still supposed to be listening
      if (this.isListening) {
        try {
          this.recognition.start();
        } catch (error) {
          // Ignore "already started" errors
          if (error.message && error.message.includes("already")) {
            console.log(
              "⏭️ Speech recognition already starting, skipping restart"
            );
          } else {
            console.error("Failed to restart recognition:", error);
          }
        }
      }
    };

    // Handle start
    this.recognition.onstart = () => {
      this._isStarting = false;
      console.log("Speech recognition started");
      if (this.onStatusChange) {
        this.onStatusChange(true);
      }
    };
  }

  start() {
    if (!this.supported) {
      console.error("Speech recognition not supported");
      return false;
    }

    if (this.isListening) {
      console.warn("Already listening");
      return false;
    }

    // Prevent duplicate start() calls
    if (this._isStarting) {
      console.log("⏭️ Speech recognition already starting, skipping");
      return false;
    }

    try {
      this._isStarting = true;
      this.isListening = true;
      this.transcript = "";
      this.interimTranscript = "";
      this.recognition.start();
      return true;
    } catch (error) {
      console.error("Failed to start recognition:", error);
      this.isListening = false;
      this._isStarting = false;
      return false;
    }
  }

  stop(processTranscript = true) {
    if (!this.isListening) {
      return;
    }

    // If exist accumulated or pending final -> immediate processing
    // But only if processTranscript is true (avoid triggering during TTS)
    if (this._finalDebounceTimer && processTranscript) {
      clearTimeout(this._finalDebounceTimer);

      // Use accumulated transcript (which already includes pending final)
      // Don't add _pendingFinalTranscript again to avoid duplication
      const finalText = this._accumulatedTranscript.trim();

      console.log(
        "⏹️  Stop triggered, processing accumulated transcript immediately"
      );
      if (this.onFinalTranscript && finalText) {
        this.onFinalTranscript(finalText);
      }
      this._accumulatedTranscript = "";
      this._pendingFinalTranscript = "";
    } else if (this._finalDebounceTimer) {
      // Just clear the timer without processing
      clearTimeout(this._finalDebounceTimer);
      this._accumulatedTranscript = "";
      this._pendingFinalTranscript = "";
      console.log(
        "⏹️  Stop triggered, clearing pending transcript (no processing)"
      );
    }

    this.isListening = false;
    this._isStarting = false;
    this.recognition.stop();

    if (this.onStatusChange) {
      this.onStatusChange(false);
    }
  }

  toggle() {
    if (this.isListening) {
      this.stop();
    } else {
      this.start();
    }
  }

  clearTranscript() {
    this.transcript = "";
    this.interimTranscript = "";

    // Initialize pending final and accumulated transcript
    if (this._finalDebounceTimer) {
      clearTimeout(this._finalDebounceTimer);
      this._finalDebounceTimer = null;
    }
    this._pendingFinalTranscript = "";
    this._accumulatedTranscript = "";
  }

  setLanguage(lang) {
    this.recognition.lang = lang;
  }

  getLanguage() {
    return this.recognition.lang;
  }

  // Debounce delay managing method
  setFinalDelay(shortDelay, longDelay, threshold) {
    this.config.shortPhraseDelay = shortDelay || this.config.shortPhraseDelay;
    this.config.longPhraseDelay = longDelay || this.config.longPhraseDelay;
    this.config.shortPhraseThreshold =
      threshold || this.config.shortPhraseThreshold;

    console.log("⏱️  Debounce config updated:", this.config);
  }
}

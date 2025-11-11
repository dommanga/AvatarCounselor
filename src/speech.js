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

    // Debounce configuration
    this.config = {
      shortPhraseDelay: 800,
      longPhraseDelay: 1800,
      shortPhraseThreshold: 5, // short - long criteria
    };

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
        if (this._finalDebounceTimer) {
          clearTimeout(this._finalDebounceTimer);
        }

        const wordCount = this._pendingFinalTranscript.split(/\s+/).length;
        const delay =
          wordCount <= this.config.shortPhraseThreshold
            ? this.config.shortPhraseDelay
            : this.config.longPhraseDelay;

        console.log(`⏱️  Final debounce: ${delay}ms (${wordCount} words)`);

        this._finalDebounceTimer = setTimeout(() => {
          if (this.onFinalTranscript && this._pendingFinalTranscript) {
            console.log(
              "✅ Processing final transcript:",
              this._pendingFinalTranscript
            );
            this.onFinalTranscript(this._pendingFinalTranscript);
            this._pendingFinalTranscript = "";
          }
        }, delay);
      }

      // user keep speaking
      if (this.interimTranscript && this._pendingFinalTranscript) {
        console.log("⏭️  Speech continuing, canceling pending final");
        clearTimeout(this._finalDebounceTimer);
        this._pendingFinalTranscript = "";
      }

      // Update callback
      if (this.onTranscriptUpdate) {
        this.onTranscriptUpdate(this.transcript, this.interimTranscript);
      }
    };

    // Handle errors
    this.recognition.onerror = (event) => {
      console.error("Speech recognition error:", event.error);

      if (this.onError) {
        this.onError(event.error);
      }

      // Auto-restart on certain errors
      if (event.error === "no-speech" || event.error === "audio-capture") {
        setTimeout(() => {
          if (this.isListening) {
            this.start();
          }
        }, 1000);
      }
    };

    // Handle end of recognition
    this.recognition.onend = () => {
      // Auto-restart if still supposed to be listening
      if (this.isListening) {
        this.recognition.start();
      }
    };

    // Handle start
    this.recognition.onstart = () => {
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

    try {
      this.isListening = true;
      this.transcript = "";
      this.interimTranscript = "";
      this.recognition.start();
      return true;
    } catch (error) {
      console.error("Failed to start recognition:", error);
      this.isListening = false;
      return false;
    }
  }

  stop() {
    if (!this.isListening) {
      return;
    }

    // If exist Pending final -> immediate processing
    if (this._pendingFinalTranscript && this._finalDebounceTimer) {
      clearTimeout(this._finalDebounceTimer);
      console.log("⏹️  Stop triggered, processing pending final immediately");
      if (this.onFinalTranscript) {
        this.onFinalTranscript(this._pendingFinalTranscript);
      }
      this._pendingFinalTranscript = "";
    }

    this.isListening = false;
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

    // Initialize pending final
    if (this._finalDebounceTimer) {
      clearTimeout(this._finalDebounceTimer);
      this._finalDebounceTimer = null;
    }
    this._pendingFinalTranscript = "";
  }

  setLanguage(lang) {
    this.recognition.lang = lang;
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

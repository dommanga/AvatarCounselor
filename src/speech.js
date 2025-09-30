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

    this.setupEventHandlers();
  }

  setupEventHandlers() {
    // Handle results
    this.recognition.onresult = (event) => {
      this.interimTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;

        if (event.results[i].isFinal) {
          this.transcript += transcript + " ";

          // Callback for final transcript
          if (this.onFinalTranscript) {
            this.onFinalTranscript(transcript.trim());
          }
        } else {
          this.interimTranscript += transcript;
        }
      }

      // Callback for real-time updates
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
  }

  setLanguage(lang) {
    this.recognition.lang = lang;
  }
}

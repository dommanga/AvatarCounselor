// UI controller for speech recognition interface
export class UIController {
  constructor() {
    this.conversationHistory = [];
    this.setupUI();
  }

  setupUI() {
    // Create speech UI container
    const speechUI = document.createElement("div");
    speechUI.id = "speech-ui";
    speechUI.innerHTML = `
            <div class="speech-control-panel">
                <button id="mic-button" class="mic-button" title="Start/Stop Recording">
                    <span class="mic-icon">🎤</span>
                    <span class="status-text">Start Recording</span>
                </button>
                <button id="clear-history-button" class="clear-button" title="Clear Conversation">
                    Clear
                </button>
                <select id="language-select" class="language-select">
                    <option value="ko-KR">한국어</option>
                    <option value="en-US">English</option>
                </select>
            </div>
            
            <div class="transcript-panel">
                <div class="panel-header">Real-time Transcription</div>
                <div id="current-transcript" class="current-transcript">
                    <span class="interim"></span>
                </div>
            </div>
            
            <div class="conversation-panel">
                <div class="panel-header">Conversation History</div>
                <div id="conversation-history" class="conversation-history"></div>
            </div>
        `;

    document.body.appendChild(speechUI);

    // Get references
    this.micButton = document.getElementById("mic-button");
    this.clearButton = document.getElementById("clear-history-button");
    this.languageSelect = document.getElementById("language-select");
    this.currentTranscript = document.getElementById("current-transcript");
    this.conversationHistoryEl = document.getElementById(
      "conversation-history"
    );

    // Add styles
    this.addStyles();
  }

  addStyles() {
    const style = document.createElement("style");
    style.textContent = `
            #speech-ui {
                position: fixed;
                right: 20px;
                top: 20px;
                width: 380px;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                z-index: 1000;
            }
            
            .speech-control-panel {
                background: rgba(255, 255, 255, 0.95);
                border-radius: 12px;
                padding: 15px;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                display: flex;
                gap: 10px;
                margin-bottom: 15px;
            }
            
            .mic-button {
                flex: 1;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                border: none;
                border-radius: 8px;
                padding: 12px 20px;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                transition: transform 0.2s, box-shadow 0.2s;
            }
            
            .mic-button:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 12px rgba(102, 126, 234, 0.4);
            }
            
            .mic-button:active {
                transform: translateY(0);
            }
            
            .mic-button.listening {
                background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
                animation: pulse 1.5s infinite;
            }
            
            @keyframes pulse {
                0%, 100% { box-shadow: 0 0 0 0 rgba(245, 87, 108, 0.7); }
                50% { box-shadow: 0 0 0 10px rgba(245, 87, 108, 0); }
            }
            
            .clear-button {
                background: #f5f5f5;
                border: 1px solid #ddd;
                border-radius: 8px;
                padding: 12px 16px;
                font-size: 14px;
                cursor: pointer;
                transition: background 0.2s;
            }
            
            .clear-button:hover {
                background: #e0e0e0;
            }
            
            .language-select {
                background: white;
                border: 1px solid #ddd;
                border-radius: 8px;
                padding: 12px;
                font-size: 14px;
                cursor: pointer;
            }
            
            .transcript-panel, .conversation-panel {
                background: rgba(255, 255, 255, 0.95);
                border-radius: 12px;
                padding: 15px;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                margin-bottom: 15px;
            }
            
            .panel-header {
                font-weight: 600;
                font-size: 14px;
                color: #333;
                margin-bottom: 10px;
                padding-bottom: 8px;
                border-bottom: 2px solid #667eea;
            }
            
            .current-transcript {
                min-height: 60px;
                max-height: 120px;
                overflow-y: auto;
                font-size: 15px;
                line-height: 1.6;
                color: #333;
            }
            
            .current-transcript .final {
                color: #000;
            }
            
            .current-transcript .interim {
                color: #999;
                font-style: italic;
            }
            
            .conversation-history {
                max-height: 300px;
                overflow-y: auto;
                font-size: 14px;
            }
            
            .conversation-entry {
                margin-bottom: 12px;
                padding: 10px;
                border-radius: 8px;
                background: #f8f9fa;
                border-left: 3px solid #667eea;
            }
            
            .conversation-entry .timestamp {
                font-size: 11px;
                color: #999;
                margin-bottom: 4px;
            }
            
            .conversation-entry .text {
                color: #333;
                line-height: 1.5;
            }
            
            .conversation-history::-webkit-scrollbar,
            .current-transcript::-webkit-scrollbar {
                width: 6px;
            }
            
            .conversation-history::-webkit-scrollbar-track,
            .current-transcript::-webkit-scrollbar-track {
                background: #f1f1f1;
                border-radius: 3px;
            }
            
            .conversation-history::-webkit-scrollbar-thumb,
            .current-transcript::-webkit-scrollbar-thumb {
                background: #888;
                border-radius: 3px;
            }
        `;
    document.head.appendChild(style);
  }

  updateTranscript(finalText, interimText) {
    const finalSpan = finalText
      ? `<span class="final">${this.escapeHtml(finalText)}</span>`
      : "";
    const interimSpan = interimText
      ? `<span class="interim">${this.escapeHtml(interimText)}</span>`
      : "";
    this.currentTranscript.innerHTML = finalSpan + interimSpan;
    this.currentTranscript.scrollTop = this.currentTranscript.scrollHeight;
  }

  addToHistory(text) {
    const timestamp = new Date().toLocaleTimeString();
    const entry = { text: text, timestamp: timestamp };
    this.conversationHistory.push(entry);

    const entryEl = document.createElement("div");
    entryEl.className = "conversation-entry";
    entryEl.innerHTML = `
            <div class="timestamp">${timestamp}</div>
            <div class="text">${this.escapeHtml(text)}</div>
        `;

    this.conversationHistoryEl.appendChild(entryEl);
    this.conversationHistoryEl.scrollTop =
      this.conversationHistoryEl.scrollHeight;
  }

  clearHistory() {
    this.conversationHistory = [];
    this.conversationHistoryEl.innerHTML = "";
    this.currentTranscript.innerHTML = '<span class="interim"></span>';
  }

  setListeningStatus(isListening) {
    if (isListening) {
      this.micButton.classList.add("listening");
      this.micButton.querySelector(".status-text").textContent = "Recording...";
    } else {
      this.micButton.classList.remove("listening");
      this.micButton.querySelector(".status-text").textContent =
        "Start Recording";
    }
  }

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
}

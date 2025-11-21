// UI controller for speech recognition interface with customization
export class UIController {
  constructor() {
    this.conversationHistory = [];
    this.lastCounselorMessageElement = null;
    this.setupUI();
  }

  setupUI() {
    // ✅ NEW: Create customization panel (LEFT side, separate container)
    const customizationUI = document.createElement("div");
    customizationUI.id = "customization-ui";
    customizationUI.innerHTML = `
                <div class="customization-panel">
                    <div class="panel-header">
                        <span>⚙️ Expression Settings</span>
                        <button id="settings-toggle" class="settings-toggle" title="Show/Hide Settings">▲</button>
                    </div>
                    <div id="settings-content" class="settings-content" style="display: block;">
                        <div class="setting-item">
                            <label for="intensity-slider">
                                <div class="setting-label">Intensity</div>
                                <div class="setting-description">Expression strength (affects both Micro & Full responses)</div>
                            </label>
                            <div class="slider-container">
                                <input type="range" id="intensity-slider" min="0" max="100" value="50" step="10" />
                                <span id="intensity-value" class="slider-value">0.50</span>
                            </div>
                        </div>
                        
                        <div class="setting-item">
                            <label for="frequency-slider">
                                <div class="setting-label">Frequency</div>
                                <div class="setting-description">Micro response rate (listening signals only)</div>
                            </label>
                            <div class="slider-container">
                                <input type="range" id="frequency-slider" min="0" max="100" value="50" step="10" />
                                <span id="frequency-value" class="slider-value">0.50</span>
                            </div>
                        </div>
                        
                        <button id="reset-settings" class="reset-button" title="Reset to defaults">
                            🔄 Reset to Defaults
                        </button>
                    </div>
                </div>
            `;

    document.body.appendChild(customizationUI);

    const speechUI = document.createElement("div");
    speechUI.id = "speech-ui";
    speechUI.innerHTML = `
                <div class="speech-control-panel">
                    <button id="mic-button" class="mic-button" title="Start/Stop Recording">
                        <span class="mic-icon">🎤</span>
                        <span class="status-text">Start Conversation</span>
                    </button>
                    <button id="new-session-button" class="new-session-button" title="Start New Session">
                        New Session
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

                <!-- Status Indicator (bottom right) -->
                <div id="status-indicator" class="status-indicator">
                    <div class="status-dot"></div>
                    <span class="status-label">Ready</span>
                </div>
            `;

    document.body.appendChild(speechUI);

    // Get references
    this.micButton = document.getElementById("mic-button");
    this.newSessionButton = document.getElementById("new-session-button");
    this.languageSelect = document.getElementById("language-select");
    this.currentTranscript = document.getElementById("current-transcript");
    this.conversationHistoryEl = document.getElementById(
      "conversation-history"
    );
    this.statusIndicator = document.getElementById("status-indicator");
    this.statusDot = this.statusIndicator.querySelector(".status-dot");
    this.statusLabel = this.statusIndicator.querySelector(".status-label");

    // Customization UI references
    this.settingsToggle = document.getElementById("settings-toggle");
    this.settingsContent = document.getElementById("settings-content");
    this.intensitySlider = document.getElementById("intensity-slider");
    this.intensityValue = document.getElementById("intensity-value");
    this.frequencySlider = document.getElementById("frequency-slider");
    this.frequencyValue = document.getElementById("frequency-value");
    this.resetButton = document.getElementById("reset-settings");

    // Setup settings toggle
    this.settingsToggle.addEventListener("click", () => {
      this.toggleSettings();
    });

    // Add styles
    this.addStyles();
  }

  toggleSettings() {
    const isHidden = this.settingsContent.style.display === "none";
    this.settingsContent.style.display = isHidden ? "block" : "none";
    this.settingsToggle.textContent = isHidden ? "▲" : "▼";
  }

  addStyles() {
    const style = document.createElement("style");
    style.textContent = `
                #customization-ui {
                    position: fixed;
                    left: 20px;
                    top: 20px;
                    width: 320px;
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    z-index: 1000;
                }

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

                .new-session-button {
                    background: #ff9800;
                    color: white;
                    border: none;
                    border-radius: 8px;
                    padding: 12px 20px;
                    font-size: 14px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: background 0.2s;
                }

                .new-session-button:hover {
                    background: #f57c00;
                }

                .language-select {
                    background: white;
                    border: 1px solid #ddd;
                    border-radius: 8px;
                    padding: 12px;
                    font-size: 14px;
                    cursor: pointer;
                }
                
                /* Customization Panel */
                .customization-panel {
                    background: rgba(255, 255, 255, 0.95);
                    border-radius: 12px;
                    padding: 15px;
                    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                    margin-bottom: 15px;
                }
                
                .customization-panel .panel-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    font-weight: 600;
                    font-size: 14px;
                    color: #333;
                    margin-bottom: 0;
                    padding-bottom: 8px;
                    border-bottom: 2px solid #667eea;
                    cursor: pointer;
                }
                
                .settings-toggle {
                    background: none;
                    border: none;
                    font-size: 14px;
                    cursor: pointer;
                    padding: 4px 8px;
                    color: #667eea;
                    transition: transform 0.2s;
                }
                
                .settings-toggle:hover {
                    transform: scale(1.1);
                }
                
                .settings-content {
                    margin-top: 15px;
                    display: none;
                }
                
                .setting-item {
                    margin-bottom: 20px;
                }
                
                .setting-item:last-of-type {
                    margin-bottom: 15px;
                }
                
                .setting-label {
                    display: block;
                    font-weight: 600;
                    font-size: 13px;
                    color: #333;
                    margin-bottom: 4px;
                }
                
                .setting-description {
                    display: block;
                    font-size: 11px;
                    color: #666;
                    margin-bottom: 8px;
                }
                
                .slider-container {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }
                
                .slider-container input[type="range"] {
                    flex: 1;
                    height: 6px;
                    border-radius: 3px;
                    background: #e0e0e0;
                    outline: none;
                    -webkit-appearance: none;
                }
                
                .slider-container input[type="range"]::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    appearance: none;
                    width: 18px;
                    height: 18px;
                    border-radius: 50%;
                    background: #667eea;
                    cursor: pointer;
                    transition: background 0.2s;
                }
                
                .slider-container input[type="range"]::-webkit-slider-thumb:hover {
                    background: #764ba2;
                }
                
                .slider-container input[type="range"]::-moz-range-thumb {
                    width: 18px;
                    height: 18px;
                    border-radius: 50%;
                    background: #667eea;
                    cursor: pointer;
                    border: none;
                    transition: background 0.2s;
                }
                
                .slider-container input[type="range"]::-moz-range-thumb:hover {
                    background: #764ba2;
                }
                
                .slider-value {
                    min-width: 40px;
                    text-align: right;
                    font-weight: 600;
                    font-size: 13px;
                    color: #667eea;
                }
                
                .reset-button {
                    width: 100%;
                    background: #f5f5f5;
                    border: 1px solid #ddd;
                    border-radius: 8px;
                    padding: 10px;
                    font-size: 13px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: background 0.2s;
                    color: #666;
                }
                
                .reset-button:hover {
                    background: #e0e0e0;
                    color: #333;
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
                
                .counselor-message {
                    margin-bottom: 12px;
                    padding: 12px;
                    border-radius: 8px;
                    background: #e3f2fd;
                    border-left: 3px solid #2196f3;
                }
    
                .counselor-message .label {
                    font-weight: 600;
                    font-size: 13px;
                    color: #1976d2;
                    display: block;
                    margin-bottom: 6px;
                }
    
                .counselor-message .text {
                    color: #333;
                    line-height: 1.6;
                    font-size: 14px;
                }
                
                .counselor-message.interrupted {
                    background: #f5f5f5;
                    border-left: 3px solid #999;
                    opacity: 0.6;
                }
                
                .counselor-message.interrupted .label {
                    color: #999;
                }
                
                .counselor-message.interrupted .label::after {
                    content: " (interrupted)";
                    font-size: 11px;
                    font-weight: normal;
                }
                
                .counselor-message.interrupted .text {
                    color: #999;
                }

                /* Status Indicator */
                .status-indicator {
                    position: fixed;
                    bottom: 30px;
                    right: 30px;
                    background: rgba(255, 255, 255, 0.95);
                    border-radius: 24px;
                    padding: 12px 20px;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    z-index: 1000;
                    transition: all 0.3s ease;
                }

                .status-dot {
                    width: 12px;
                    height: 12px;
                    border-radius: 50%;
                    background: #999;
                    transition: background 0.3s ease;
                }

                .status-indicator.listening .status-dot {
                    background: #2196f3;
                    animation: pulse-dot 1.5s infinite;
                }

                .status-indicator.thinking .status-dot {
                    background: #ff9800;
                    animation: pulse-dot 1.5s infinite;
                }

                .status-indicator.speaking .status-dot {
                    background: #4caf50;
                    animation: pulse-dot 1.5s infinite;
                }

                .status-label {
                    font-size: 14px;
                    font-weight: 600;
                    color: #333;
                    user-select: none;
                }

                .status-indicator.listening .status-label {
                    color: #2196f3;
                }

                .status-indicator.thinking .status-label {
                    color: #ff9800;
                }

                .status-indicator.speaking .status-label {
                    color: #4caf50;
                }

                @keyframes pulse-dot {
                    0%, 100% {
                        transform: scale(1);
                        opacity: 1;
                    }
                    50% {
                        transform: scale(1.2);
                        opacity: 0.7;
                    }
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
      this.micButton.querySelector(".status-text").textContent =
        "Stop Conversation";
      this.setStatus("listening", "Listening...");
    } else {
      this.micButton.classList.remove("listening");
      this.micButton.querySelector(".status-text").textContent =
        "Start Conversation";
      // Don't change status here - it might be thinking/speaking
    }
  }

  // Set mic button to "Restart Conversation" state
  setRestartState() {
    this.micButton.classList.remove("listening");
    this.micButton.querySelector(".status-text").textContent =
      "Restart Conversation";
    this.setStatus("ready", "Stopped");
  }

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  addCounselorMessage(message) {
    const timestamp = new Date().toLocaleTimeString();

    const messageDiv = document.createElement("div");
    messageDiv.className = "counselor-message";
    messageDiv.innerHTML = `
            <span class="label">🤖 Counselor (${timestamp}):</span>
            <span class="text">${this.escapeHtml(message)}</span>
        `;

    this.conversationHistoryEl.appendChild(messageDiv);
    this.conversationHistoryEl.scrollTop =
      this.conversationHistoryEl.scrollHeight;

    this.lastCounselorMessageElement = messageDiv;
  }

  markLastCounselorMessageAsInterrupted() {
    if (this.lastCounselorMessageElement) {
      this.lastCounselorMessageElement.classList.add("interrupted");
      console.log("✂️ Marked last counselor message as interrupted");
    }
  }

  setSpeakingStatus(isSpeaking) {
    if (this.ttsStatus) {
      this.ttsStatus.style.display = isSpeaking ? "flex" : "none";
    }
  }

  // Customization UI helpers
  updateIntensityValue(value) {
    this.intensityValue.textContent = value.toFixed(1);
    this.intensitySlider.value = Math.round(value * 100);
  }

  updateFrequencyValue(value) {
    this.frequencyValue.textContent = value.toFixed(1);
    this.frequencySlider.value = Math.round(value * 100);
  }

  // Start new session (clear everything)
  startNewSession() {
    this.conversationHistory = [];
    this.conversationHistoryEl.innerHTML = "";
    this.currentTranscript.innerHTML = '<span class="interim"></span>';
    this.setStatus("ready", "Ready");
    this.micButton.classList.remove("listening");
    this.micButton.querySelector(".status-text").textContent =
      "Start Conversation";
  }

  // Disable/Enable microphone button
  disableMicButton() {
    if (this.micButton) {
      this.micButton.disabled = true;
      this.micButton.style.opacity = "0.5";
      this.micButton.style.cursor = "not-allowed";
      this.micButton.style.transform = "translateY(0)"; // Keep button pressed down
      this.micButton.style.pointerEvents = "none"; // Disable all pointer events
    }
  }

  enableMicButton() {
    if (this.micButton) {
      this.micButton.disabled = false;
      this.micButton.style.opacity = "1";
      this.micButton.style.cursor = "pointer";
      this.micButton.style.transform = ""; // Remove transform, allow hover animation
      this.micButton.style.pointerEvents = "auto"; // Re-enable pointer events
    }
  }

  // Status indicator control
  setStatus(status, label) {
    // Remove all status classes
    this.statusIndicator.classList.remove("listening", "thinking", "speaking");

    // Add new status class (if not 'ready')
    if (status !== "ready") {
      this.statusIndicator.classList.add(status);
    }

    // Update label
    this.statusLabel.textContent = label;
  }

  // Convenience methods for common status changes
  setThinkingStatus() {
    this.setStatus("thinking", "Thinking...");
  }

  setSpeakingStatus(isSpeaking) {
    if (isSpeaking) {
      this.setStatus("speaking", "Speaking...");
    } else {
      this.setStatus("ready", "Ready");
    }
  }
}

export class APIManager {
  constructor(apiBase = "http://localhost:3000") {
    this.apiBase = apiBase;

    // Rate limit for sentiment analysis
    this._lastChunkAt = 0;
    this._minChunkGapMs = 400;

    this._lastRawChunk = "";
    this._pendingBuffer = "";
  }

  resetSentimentStream() {
    this._lastRawChunk = "";
    this._pendingBuffer = "";
    this._lastChunkAt = 0;
  }

  // Sentiment analysis (Micro Response)
  async analyzeSentiment(rawChunkText, { timeoutMs = 2000 } = {}) {
    const chunkText = (rawChunkText || "").trim();
    if (!chunkText) return null;

    let newPart = chunkText;
    if (this._lastRawChunk) {
      const prev = this._lastRawChunk;
      const minLen = Math.min(prev.length, chunkText.length);
      let i = 0;
      while (i < minLen && prev[i] === chunkText[i]) i++;
      newPart = chunkText.slice(i);
    }
    this._lastRawChunk = chunkText;

    if (!newPart) {
      // console.log("⏭️ Skipping empty newPart");
      return null;
    }

    this._pendingBuffer += newPart;
    const buffered = this._pendingBuffer;

    if (buffered.replace(/\s+/g, "").length < 6) {
      // console.log("⏭️ Skipping, buffered too short:", buffered);
      return null;
    }

    const now = Date.now();
    if (now - this._lastChunkAt < this._minChunkGapMs) {
      // console.log("⏭️ Skipping newPart (rate limit):", newPart);
      return null;
    }

    this._lastChunkAt = now;

    this._pendingBuffer = "";

    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);

    try {
      const res = await fetch(`${this.apiBase}/api/sentiment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chunk: rawChunkText }),
        signal: ctl.signal,
      });

      const data = await res.json();
      return data.sentiment || null;
    } catch (e) {
      console.error("❌ analyzeSentiment failed:", e);
      return null;
    } finally {
      clearTimeout(t);
    }
  }

  async generateCounselorResponse(
    message,
    conversationHistory,
    userAge = null,
    verbalStyle = "directing",
    { timeoutMs = 20000 } = {}
  ) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);

    try {
      const res = await fetch(
        `${this.apiBase}/api/generate-response-with-emotion`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message,
            conversationHistory,
            userAge,
            verbalStyle,
          }),
          signal: ctl.signal,
        }
      );

      if (!res.ok) {
        throw new Error(`API error: ${res.status}`);
      }

      return await res.json();
    } catch (e) {
      if (e.name === "AbortError") {
        console.error("⏱️ Request timed out after", timeoutMs, "ms");
      }

      console.error("❌ generateCounselorResponse failed:", e);
      const isKorean = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(message);
      return {
        response: isKorean
          ? "죄송해요, 잠시 생각을 정리하는 데 문제가 있었어요. 방금 하신 말씀을 다시 한 번 말씀해 주시겠어요?"
          : "I'm sorry, I need a moment to gather my thoughts. Could you say that again?",
        counselorEmotion: {
          dominantEmotion: "neutral",
          intensityMultiplier: 0.8,
        },
        error: true,
      };
    } finally {
      clearTimeout(t);
    }
  }

  // TTS generation
  async generateTTS(text, language, avatarGender, { timeoutMs = 50000 } = {}) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);

    try {
      const res = await fetch(`${this.apiBase}/api/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language, avatarGender }),
        signal: ctl.signal,
      });

      if (!res.ok) {
        throw new Error(`TTS API error: ${res.status}`);
      }

      // Content-Type validation
      const contentType = res.headers.get("Content-Type");
      if (!contentType || !contentType.includes("audio")) {
        const errorText = await res.text();
        console.error("🔊 Unexpected response:", errorText);
        throw new Error("TTS response is not audio");
      }

      const audioBuffer = await res.arrayBuffer();

      // empty audio check
      if (audioBuffer.byteLength === 0) {
        throw new Error("TTS returned empty audio");
      }

      // console.log(`✅ TTS audio received: ${audioBuffer.byteLength} bytes`);
      return audioBuffer;
    } catch (e) {
      console.error("❌ generateTTS failed:", e);
      throw e;
    } finally {
      clearTimeout(t);
    }
  }

  // Session logging methods
  async startSession(sessionData) {
    try {
      const res = await fetch(`${this.apiBase}/api/session/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sessionData),
      });
      const data = await res.json();
      return data;
    } catch (e) {
      console.error("❌ startSession failed:", e);
    }
  }

  async logTurn(turnData) {
    try {
      const res = await fetch(`${this.apiBase}/api/session/log-turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(turnData),
      });
      return await res.json();
    } catch (e) {
      console.error("❌ logTurn failed:", e);
    }
  }

  async logSettingsChange(settings) {
    try {
      const res = await fetch(`${this.apiBase}/api/session/log-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      return await res.json();
    } catch (e) {
      console.error("❌ logSettingsChange failed:", e);
    }
  }

  async endSession() {
    try {
      const res = await fetch(`${this.apiBase}/api/session/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      return await res.json();
    } catch (e) {
      console.error("❌ endSession failed:", e);
    }
  }

  // Participant management methods
  async checkParticipant(participantId) {
    try {
      const res = await fetch(`${this.apiBase}/api/participants/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId }),
      });
      return await res.json();
    } catch (e) {
      console.error("❌ checkParticipant failed:", e);
      return { exists: false };
    }
  }

  async createParticipant(participantId, age, gender, selectedAvatar) {
    try {
      const res = await fetch(`${this.apiBase}/api/participants/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId, age, gender, selectedAvatar }),
      });
      return await res.json();
    } catch (e) {
      console.error("❌ createParticipant failed:", e);
      throw e;
    }
  }
}

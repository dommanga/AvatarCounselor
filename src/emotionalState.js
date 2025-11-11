export class EmotionalStateTracker {
  constructor(apiBase = "http://localhost:3000") {
    this.apiBase = apiBase;

    this.currentEmotion = { type: "neutral", intensity: 0.5, multiplier: 1.0 };

    this.emotionHistory = []; // [{ emotion, intensity, timestamp }]

    this.conversationHistory = []; // [{ speaker: 'user'|'counselor', text, timestamp }]

    // Internal rate-limit/debounce assistant value
    this._lastChunkAt = 0;
    this._minChunkGapMs = 400;
  }

  // ─────────────────────────────────────────────────────────────
  // History, State management
  // ─────────────────────────────────────────────────────────────

  addToConversation(speaker, text) {
    if (!text || !text.trim()) return;
    this.conversationHistory.push({ speaker, text, timestamp: Date.now() });
    if (this.conversationHistory.length > 10) this.conversationHistory.shift();
  }

  updateHistory(emotion, intensity) {
    this.emotionHistory.push({ emotion, intensity, timestamp: Date.now() });
    if (this.emotionHistory.length > 5) this.emotionHistory.shift();
  }

  getState() {
    return {
      current: this.currentEmotion,
      history: this.emotionHistory.slice(),
      conversationHistory: this.conversationHistory.slice(),
    };
  }

  // ─────────────────────────────────────────────────────────────
  // API Call
  // ─────────────────────────────────────────────────────────────

  /**
   * Interim transcript → sentiment (positive/negative/neutral)
   * Micro Response(Head nod, smile) to trigger
   */
  async analyzeChunkSentiment(chunkText, { timeoutMs = 2000 } = {}) {
    // protection
    const now = Date.now();
    if (now - this._lastChunkAt < this._minChunkGapMs) {
      console.log("⏭️  Skipping chunk (rate limit)");
      return null;
    }

    this._lastChunkAt = now;

    if (!chunkText || chunkText.trim().length < 10) {
      return "neutral";
    }

    if (!chunkText || chunkText.trim().length < 3) {
      return "neutral";
    }

    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);

    try {
      const res = await fetch(`${this.apiBase}/api/sentiment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chunk: chunkText }),
        signal: ctl.signal,
      });
      const data = await res.json();
      return data.sentiment || "neutral";
    } catch (e) {
      // Fallback
      return "neutral";
    } finally {
      clearTimeout(t);
    }
  }

  /**
   * Final transcript → Overall emotion
   * Server: /api/analyze-full (OpenAI GPT-4o)
   */
  async analyzeFinalEmotion(finalText, { timeoutMs = 5000 } = {}) {
    if (!finalText || finalText.trim().length < 2) {
      return {
        emotions: {
          joy: 0,
          sadness: 0,
          anger: 0,
          fear: 0,
          surprise: 0,
          disgust: 0,
        },
        intensityMultiplier: 0.8,
        dominantEmotion: "neutral",
        error: true,
      };
    }

    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);

    try {
      const res = await fetch(`${this.apiBase}/api/analyze-full`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: finalText,
          history: this.conversationHistory,
        }),
        signal: ctl.signal,
      });

      const data = await res.json();

      const dom = data.dominantEmotion || "neutral";
      const emoIntensity =
        data.emotions?.[dom] != null ? Number(data.emotions[dom]) : 0.5;
      const mult = Number(data.intensityMultiplier ?? 1.0);

      this.currentEmotion = {
        type: dom,
        intensity: emoIntensity,
        multiplier: mult,
      };
      this.updateHistory(dom, emoIntensity);

      return data;
    } catch (e) {
      return {
        emotions: {
          joy: 0,
          sadness: 0,
          anger: 0,
          fear: 0,
          surprise: 0,
          disgust: 0,
        },
        intensityMultiplier: 0.8,
        dominantEmotion: "neutral",
        error: true,
      };
    } finally {
      clearTimeout(t);
    }
  }
}

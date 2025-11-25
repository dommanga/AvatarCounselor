export class APIManager {
  constructor(apiBase = "http://localhost:3000") {
    this.apiBase = apiBase;

    // Rate limit for sentiment analysis
    this._lastChunkAt = 0;
    this._minChunkGapMs = 400;
    this._lastChunkText = "";
  }

  // Sentiment analysis (Micro Response)
  async analyzeSentiment(chunkText, { timeoutMs = 2000 } = {}) {
    // Rate limit protection
    if (chunkText.trim() === this._lastChunkText.trim()) {
      console.log("⏭️ Skipping duplicate chunk");
      return null;
    }

    const now = Date.now();
    if (now - this._lastChunkAt < this._minChunkGapMs) {
      console.log("⏭️ Skipping chunk (rate limit)");
      return null;
    }

    this._lastChunkAt = now;
    this._lastChunkText = chunkText;

    if (!chunkText || chunkText.trim().length < 10) {
      return null;
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
    { timeoutMs = 5000 } = {}
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
          }),
          signal: ctl.signal,
        }
      );

      if (!res.ok) {
        throw new Error(`API error: ${res.status}`);
      }

      return await res.json();
    } catch (e) {
      console.error("❌ generateCounselorResponse failed:", e);
      return {
        response: "",
        counselorEmotion: {
          dominantEmotion: "neutral",
          intensityMultiplier: 1.0,
        },
        error: true,
      };
    } finally {
      clearTimeout(t);
    }
  }

  // TTS generation
  async generateTTS(text, language, { timeoutMs = 10000 } = {}) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);

    try {
      const res = await fetch(`${this.apiBase}/api/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language }),
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
}

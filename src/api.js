export class EmotionAnalyzer {
  constructor(apiEndpoint = "http://localhost:3000") {
    this.apiEndpoint = apiEndpoint;
    this.isAnalyzing = false;
  }

  async analyzeEmotion(transcript) {
    if (this.isAnalyzing) {
      console.warn("⏳ Analysis already in progress");
      return null;
    }

    if (!transcript || transcript.trim().length < 3) {
      console.warn("⚠️ Transcript too short");
      return null;
    }

    this.isAnalyzing = true;
    const startTime = performance.now();

    try {
      const response = await fetch(`${this.apiEndpoint}/api/analyze-emotion`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ transcript }),
        signal: AbortSignal.timeout(5000), // 5s timeout
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const result = await response.json();

      const elapsedTime = performance.now() - startTime;
      console.log(
        `✅ Emotion analyzed in ${elapsedTime.toFixed(0)}ms:`,
        result
      );

      return result;
    } catch (error) {
      console.error("❌ Emotion analysis failed:", error);

      // Fallback response
      return {
        emotion: "neutral",
        intensity: 0.5,
        response: "네, 계속 말씀해 주세요.",
        error: true,
      };
    } finally {
      this.isAnalyzing = false;
    }
  }
}

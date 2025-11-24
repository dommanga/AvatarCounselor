import express from "express";
import OpenAI from "openai";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// ═════════════════════════════════════════════════════════════════════
// Initialize LLM (OpenAI GPT-4)
// ═════════════════════════════════════════════════════════════════════
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Model configuration
const SENTIMENT_MODEL = "gpt-4o-mini";
const EMOTION_MODEL = "gpt-4o";
const COUNSELOR_MODEL = "gpt-4o";

app.use(cors());
app.use(express.json());

// ═════════════════════════════════════════════════════════════════════
// ENDPOINT 1: Sentiment Analysis (Micro Response)
// ═════════════════════════════════════════════════════════════════════
app.post("/api/sentiment", async (req, res) => {
  try {
    const { chunk } = req.body;

    if (!chunk || chunk.trim().length < 3) {
      return res.json({ sentiment: "neutral" });
    }

    console.log("🔍 Sentiment analysis for chunk:", chunk.substring(0, 50));

    const prompt = `Analyze the sentiment of this text chunk briefly.
Return only ONE word: positive, negative, or neutral.

Text: "${chunk}"

Sentiment:`;

    const completion = await openai.chat.completions.create({
      model: SENTIMENT_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 50,
    });

    const sentiment = completion.choices[0].message.content
      .trim()
      .toLowerCase()
      .replace(/[^a-z]/g, ""); // Remove any non-letter characters

    // Validate
    const validSentiments = ["positive", "negative", "neutral"];
    const finalSentiment = validSentiments.includes(sentiment)
      ? sentiment
      : "neutral";

    console.log(`✅ Sentiment: ${finalSentiment}`);

    res.json({ sentiment: finalSentiment });
  } catch (error) {
    console.error("❌ Sentiment analysis error:", error.message);
    res.json({ sentiment: "neutral" }); // Fail gracefully
  }
});

// ═════════════════════════════════════════════════════════════════════
// ENDPOINT 2: Generate Counselor Response with Emotion (Full Response)
// ═════════════════════════════════════════════════════════════════════
app.post("/api/generate-response-with-emotion", async (req, res) => {
  try {
    const { message, conversationHistory } = req.body;

    if (!message || message.trim().length < 2) {
      return res.status(400).json({
        error: "Message is required",
      });
    }

    console.log(
      "💬 Generating counselor response with emotion for:",
      message.substring(0, 50)
    );

    // Build conversation context
    let conversationContext = "";
    if (conversationHistory && conversationHistory.length > 0) {
      conversationContext = conversationHistory
        .slice(-10)
        .map((h) => `${h.speaker}: ${h.text}`)
        .join("\n");
    }

    const prompt = `You are an empathetic AI counselor.

${conversationContext ? `Conversation history:\n${conversationContext}\n` : ""}

User just said: "${message}"

Generate:
1. An empathetic and supportive response (2-3 sentences)
2. The emotion YOU (the counselor) should EXPRESS while delivering this response
   - This is YOUR emotion showing empathy, NOT simply mirroring the user
   - joy: warm smile when user shares good news or progress
   - sadness: empathic concern when user expresses CLEAR pain or difficulty
   - anger: supportive validation when user expresses frustration
   - fear: calm reassurance when user expresses worry
   - surprise: genuine interest when user shares unexpected news
   - disgust: acknowledging difficult or unfair situations
   - neutral: calm presence for greetings, casual conversation, or opening statements

   IMPORTANT Guidelines:
   - Default to neutral for greetings, introductions, or opening statements
   - Willingness to talk/share ≠ emotional distress (use neutral, not sadness)
   - Only use strong emotions when user explicitly describes difficult feelings or situations
   - If uncertain between neutral and emotional, choose emotional with lower multiplier (0.85-0.90)

3. Intensity Multiplier (0.85 to 1.15)
   - 0.85-0.90: Light conversation, attenuate slightly
   - 0.95-1.00: Normal emotional expression
   - 1.05-1.10: Significant emotional moment
   - 1.15: Strong emotional peak

Guidelines for response:
- Response should validate feelings and show understanding
- Keep responses natural and conversational (2-3 sentences)
- Match the language of input (Korean/English)

CRITICAL: Return ONLY valid JSON (no markdown):
{
  "response": "your empathetic response here",
  "counselorEmotion": {
    "dominantEmotion": "sadness",
    "intensityMultiplier": 0.95
  }
}`;

    const completion = await openai.chat.completions.create({
      model: COUNSELOR_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 400,
    });

    let responseText = completion.choices[0].message.content.trim();

    // Remove markdown code blocks if present
    responseText = responseText
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    const data = JSON.parse(responseText);

    // Validate structure
    if (!data.response || !data.counselorEmotion) {
      throw new Error("Invalid response structure from LLM");
    }

    // Validate emotion
    const validEmotions = [
      "joy",
      "sadness",
      "anger",
      "fear",
      "surprise",
      "disgust",
      "neutral",
    ];
    if (!validEmotions.includes(data.counselorEmotion.dominantEmotion)) {
      data.counselorEmotion.dominantEmotion = "neutral";
    }

    // Clamp multiplier
    data.counselorEmotion.intensityMultiplier = Math.max(
      0.5,
      Math.min(1.5, data.counselorEmotion.intensityMultiplier || 1.0)
    );

    console.log(
      `✅ Response: "${data.response.substring(0, 30)}..." | Emotion: ${
        data.counselorEmotion.dominantEmotion
      }, Multiplier: ${data.counselorEmotion.intensityMultiplier}`
    );

    res.json(data);
  } catch (error) {
    console.error("❌ Generate response with emotion error:", error.message);

    // Fallback response
    const isKorean = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(req.body.message);
    res.status(500).json({
      response: isKorean
        ? "죄송합니다. 잠시 후 다시 말씀해 주세요."
        : "I'm sorry, please try again in a moment.",
      counselorEmotion: {
        dominantEmotion: "neutral",
        intensityMultiplier: 0.8,
      },
      error: true,
    });
  }
});

// ═════════════════════════════════════════════════════════════════════
// ENDPOINT 3: OpenAI TTS (Text-to-Speech)
// ═════════════════════════════════════════════════════════════════════
app.post("/api/tts", async (req, res) => {
  try {
    const { text, language } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: "Text is required" });
    }

    console.log(`🔊 TTS request: ${text.substring(0, 50)}... (${language})`);

    // Select voice based on language
    const voice = language === "ko-KR" ? "shimmer" : "nova";

    // Generate speech using OpenAI TTS
    const mp3 = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: voice,
      input: text,
      response_format: "mp3",
      speed: 1.0,
    });

    // Convert response to buffer
    const buffer = Buffer.from(await mp3.arrayBuffer());

    console.log(`✅ TTS generated: ${buffer.length} bytes`);

    // Send audio as response
    res.set({
      "Content-Type": "audio/mpeg",
      "Content-Length": buffer.length,
    });
    res.send(buffer);
  } catch (error) {
    console.error("❌ TTS generation error:", error.message);
    res.status(500).json({
      error: "TTS generation failed",
      message: error.message,
    });
  }
});

// ═════════════════════════════════════════════════════════════════════
// Health Check
// ═════════════════════════════════════════════════════════════════════
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Server is running",
    model: "GPT-4",
    endpoints: {
      sentiment: "POST /api/sentiment",
      generateResponseWithEmotion: "POST /api/generate-response-with-emotion",
      tts: "POST /api/tts",
    },
  });
});

// ═════════════════════════════════════════════════════════════════════
// Start Server
// ═════════════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 AI Avatar Counselor API - Phase 2 (OpenAI GPT-4)`);
  console.log(`📡 Server running on http://localhost:${PORT}`);
  console.log(
    `✅ OpenAI API Key: ${
      process.env.OPENAI_API_KEY ? "Configured" : "⚠️  Missing!"
    }`
  );
  console.log(`\n📋 Available endpoints:`);
  console.log(`   POST /api/sentiment           - Micro Response (chunk)`);
  console.log(
    `   POST /api/generate-response-with-emotion - Counselor Response with emotion`
  );
  console.log(`   POST /api/tts                 - Text-to-Speech`);
  console.log(`   GET  /health                  - Health Check\n`);
});

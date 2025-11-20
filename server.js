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
// ENDPOINT 1: Sentiment Analysis (Micro Response용)
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
// ENDPOINT 2(For user study analysis): Full Emotion Analysis
// ═════════════════════════════════════════════════════════════════════
app.post("/api/analyze-full", async (req, res) => {
  try {
    const { message, history } = req.body;

    if (!message || message.trim().length < 2) {
      return res.status(400).json({
        error: "Message is too short or empty",
      });
    }

    console.log("🧠 Full emotion analysis for:", message.substring(0, 50));

    // Build context from history
    let historyContext = "";
    if (history && history.length > 0) {
      historyContext = history
        .slice(-5) // Last 5 messages
        .map((h) => `${h.speaker}: ${h.text}`)
        .join("\n");
    }

    const prompt = `You are analyzing user emotions in a counseling context.

${historyContext ? `Recent conversation history:\n${historyContext}\n` : ""}
Current user message: "${message}"

Analyze:
1. Emotion distribution (6 basic emotions: joy, sadness, anger, fear, surprise, disgust)
   - Values must sum to 1.0
   - Use 0.0 if emotion is absent
   - Identify the dominant emotion

2. Intensity Multiplier (0.5 to 1.5)
   - 0.5-0.7: Casual conversation (attenuate counselor response)
   - 0.8-1.0: Normal emotional expression
   - 1.1-1.3: Significant emotional moment
   - 1.4-1.5: Crisis or breakthrough moment

CRITICAL: Return ONLY valid JSON (no markdown, no code blocks):
{
  "emotions": {
    "joy": 0.0,
    "sadness": 0.8,
    "anger": 0.1,
    "fear": 0.1,
    "surprise": 0.0,
    "disgust": 0.0
  },
  "intensityMultiplier": 1.3,
  "dominantEmotion": "sadness"
}`;

    const completion = await openai.chat.completions.create({
      model: EMOTION_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
      max_tokens: 300,
    });

    let responseText = completion.choices[0].message.content.trim();

    // Remove markdown code blocks if present
    responseText = responseText
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    const data = JSON.parse(responseText);

    // Validate structure
    if (!data.emotions || !data.intensityMultiplier || !data.dominantEmotion) {
      throw new Error("Invalid response structure from LLM");
    }

    // Validate emotions sum to ~1.0 (allow small floating point errors)
    const emotionSum = Object.values(data.emotions).reduce(
      (sum, val) => sum + val,
      0
    );
    if (Math.abs(emotionSum - 1.0) > 0.15) {
      console.warn(`⚠️  Emotion sum is ${emotionSum}, normalizing...`);
      // Normalize
      for (const emotion in data.emotions) {
        data.emotions[emotion] = data.emotions[emotion] / emotionSum;
      }
    }

    // Clamp multiplier
    data.intensityMultiplier = Math.max(
      0.5,
      Math.min(1.5, data.intensityMultiplier)
    );

    console.log(
      `✅ Dominant: ${data.dominantEmotion} (${(
        data.emotions[data.dominantEmotion] * 100
      ).toFixed(0)}%), Multiplier: ${data.intensityMultiplier}`
    );

    res.json(data);
  } catch (error) {
    console.error("❌ Full emotion analysis error:", error.message);

    // Fallback response
    res.status(500).json({
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
    });
  }
});

// ═════════════════════════════════════════════════════════════════════
// ENDPOINT 3(Legacy): Generate Counselor Response
// ═════════════════════════════════════════════════════════════════════
app.post("/api/generate-response", async (req, res) => {
  try {
    const { message, conversationHistory, emotionHistory } = req.body;

    if (!message || message.trim().length < 2) {
      return res.status(400).json({
        error: "Message is required",
      });
    }

    console.log(
      "💬 Generating counselor response for:",
      message.substring(0, 50)
    );

    // Build conversation context
    let conversationContext = "";
    if (conversationHistory && conversationHistory.length > 0) {
      conversationContext = conversationHistory
        .slice(-10) // Last 10 messages
        .map((h) => `${h.speaker}: ${h.text}`)
        .join("\n");
    }

    // Build emotion context
    let emotionContext = "";
    if (emotionHistory && emotionHistory.length > 0) {
      const recentEmotions = emotionHistory
        .slice(-3)
        .map((e) => `${e.emotion} (${e.intensity.toFixed(2)})`)
        .join(", ");
      emotionContext = `\nRecent emotions: ${recentEmotions}`;
    }

    const prompt = `You are an empathetic AI counselor. Respond to the user's message with genuine care and understanding.

${conversationContext ? `Conversation history:\n${conversationContext}\n` : ""}
${emotionContext}

User just said: "${message}"

Guidelines:
- Be empathetic and supportive
- Use short, natural responses (2-3 sentences)
- Avoid being overly positive or dismissive
- Reflect the user's emotions
- Ask follow-up questions when appropriate
- Match the language of input (Korean/English)

Response:`;

    const completion = await openai.chat.completions.create({
      model: COUNSELOR_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 200,
    });

    const response = completion.choices[0].message.content.trim();

    console.log(`✅ Response generated: ${response.substring(0, 50)}...`);

    res.json({ response });
  } catch (error) {
    console.error("❌ Response generation error:", error.message);

    // Fallback response
    const isKorean = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(req.body.message);
    res.status(500).json({
      response: isKorean
        ? "죄송합니다. 잠시 후 다시 말씀해 주세요."
        : "I'm sorry, please try again in a moment.",
      error: true,
    });
  }
});

// ═════════════════════════════════════════════════════════════════════
// ENDPOINT 4: Generate Counselor Response with Emotion (Integrated)
// ═════════════════════════════════════════════════════════════════════
app.post("/api/generate-response-with-emotion", async (req, res) => {
  try {
    const { message, conversationHistory, emotionHistory } = req.body;

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

    // Build emotion context
    let emotionContext = "";
    if (emotionHistory && emotionHistory.length > 0) {
      const recentEmotions = emotionHistory
        .slice(-3)
        .map((e) => `${e.emotion} (${e.intensity.toFixed(2)})`)
        .join(", ");
      emotionContext = `\nUser's recent emotions: ${recentEmotions}`;
    }

    const prompt = `You are an empathetic AI counselor.

${conversationContext ? `Conversation history:\n${conversationContext}\n` : ""}
${emotionContext}

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
   - If uncertain between neutral and emotional, choose neutral with lower multiplier (0.5-0.7)

3. Intensity Multiplier (0.5 to 1.5)
   - 0.5-0.7: Light conversation
   - 0.8-1.0: Normal emotional exchange
   - 1.1-1.3: Significant emotional moment
   - 1.4-1.5: Crisis or breakthrough

Guidelines for response:
- Response should validate feelings and show understanding
- Keep responses natural and conversational (2-3 sentences)
- Match the language of input (Korean/English)

CRITICAL: Return ONLY valid JSON (no markdown):
{
  "response": "your empathetic response here",
  "counselorEmotion": {
    "dominantEmotion": "sadness",
    "intensityMultiplier": 1.2
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
// ENDPOINT 5: OpenAI TTS (Text-to-Speech)
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
      analyzeFull: "POST /api/analyze-full",
      generateResponse: "POST /api/generate-response",
      generateResponseWithEmotion: "POST /api/generate-response-with-emotion",
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
  console.log(`   POST /api/analyze-full        - Full Emotion Analysis`);
  console.log(`   POST /api/generate-response   - Counselor Response(Legacy)`);
  console.log(
    `   POST /api/generate-response-with-emotion   - Counselor Response with emotion`
  );
  console.log(`   GET  /health                  - Health Check\n`);
});

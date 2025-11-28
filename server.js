import express from "express";
import OpenAI from "openai";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
const COUNSELOR_MODEL = "gpt-4o-mini";

app.use(cors());
app.use(express.json());

// ═════════════════════════════════════════════════════════════════════
// Session Logger
// ═════════════════════════════════════════════════════════════════════
class SessionLogger {
  constructor() {
    this.logsDir = path.join(__dirname, "logs");
    this.currentSession = null;
    this.enabled = process.env.LOGGING_ENABLED === "true";

    console.log("🔍 SessionLogger initialized:");
    console.log("   - LOGGING_ENABLED:", process.env.LOGGING_ENABLED);

    if (this.enabled && !fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true, mode: 0o777 });
    }
  }

  startSession(metadata) {
    if (!this.enabled) return;

    const timestamp = this._getKSTTimestamp();
    const sessionId = `condition${metadata.conditionNumber}_${metadata.condition}_${timestamp}`;

    const participantDir = path.join(this.logsDir, metadata.participantId);
    const sessionsDir = path.join(participantDir, "sessions");
    const sessionDir = path.join(sessionsDir, sessionId);
    ``;
    if (!fs.existsSync(participantDir)) {
      fs.mkdirSync(participantDir, { recursive: true });
    }
    if (!fs.existsSync(sessionsDir)) {
      fs.mkdirSync(sessionsDir, { recursive: true });
    }
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    this.currentSession = {
      sessionId,
      sessionDir,
      metadata: {
        ...metadata,
        sessionId,
        startTime: this._getKSTTimestamp(),
        settingsChanges: [],
      },
      turns: [],
    };

    this._saveMetadata();
    console.log(`📝 Session started: ${sessionId}`);
  }

  logTurn(turnData) {
    if (!this.enabled || !this.currentSession) {
      return;
    }

    const turn = {
      turnNumber: this.currentSession.turns.length + 1,
      timestamp: this._getKSTTimestamp(),
      ...turnData,
    };

    this.currentSession.turns.push(turn);
    this._saveConversation();
  }

  logSettingsChange(settings) {
    if (!this.enabled || !this.currentSession) return;

    const change = {
      timestamp: this._getKSTTimestamp(),
      ...settings,
    };

    this.currentSession.metadata.settingsChanges.push(change);
    this._saveMetadata();
  }

  endSession() {
    if (!this.enabled || !this.currentSession) return;

    this.currentSession.metadata.endTime = this._getKSTTimestamp();
    const start = new Date(this.currentSession.metadata.startTime);
    const end = new Date(this.currentSession.metadata.endTime);
    this.currentSession.metadata.duration = end - start;

    this._saveMetadata();
    console.log(`✅ Session ended: ${this.currentSession.sessionId}`);
    this.currentSession = null;
  }

  _saveMetadata() {
    const filePath = path.join(this.currentSession.sessionDir, "metadata.json");
    fs.writeFileSync(
      filePath,
      JSON.stringify(this.currentSession.metadata, null, 2)
    );
  }

  _saveConversation() {
    const filePath = path.join(
      this.currentSession.sessionDir,
      "conversation.json"
    );
    fs.writeFileSync(
      filePath,
      JSON.stringify({ turns: this.currentSession.turns }, null, 2)
    );
  }

  _getKSTTimestamp() {
    return new Date(Date.now() + 9 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 19)
      .replace(/:/g, "-");
  }
}

const sessionLogger = new SessionLogger();

// ═════════════════════════════════════════════════════════════════════
// ENDPOINT 1: Sentiment Analysis (Micro Response)
// ═════════════════════════════════════════════════════════════════════
app.post("/api/sentiment", async (req, res) => {
  try {
    const { chunk } = req.body;

    if (!chunk || chunk.trim().length < 3) {
      return res.json({ sentiment: "neutral" });
    }

    console.log("🔍 Sentiment analysis for chunk");

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

    console.log(`✅ Final Sentiment analysis completed`);

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
    const { message, conversationHistory, userAge } = req.body;

    if (!message || message.trim().length < 2) {
      return res.status(400).json({
        error: "Message is required",
      });
    }

    console.log("💬 Generating counselor response with emotion");

    // Build conversation context
    let conversationContext = "";
    if (conversationHistory && conversationHistory.length > 0) {
      conversationContext = conversationHistory
        .slice(-10)
        .map((h) => `${h.speaker}: ${h.text}`)
        .join("\n");
    }

    const age = userAge || 23;

    const prompt = `You are a peer counselor AI avatar - a trained friend who has learned counseling skills like active listening, empathy, and reflection.

As a peer counselor, you:
- Listen with genuine care and show understanding through both words and facial expressions
- Use basic counseling skills: validate feelings, reflect what you hear, ask gentle follow-up questions when appropriate
- Offer emotional support and companionship, not professional diagnosis or advice
- Communicate like a caring peer of similar age who has been trained to help
- Balance warmth and professionalism - friendly but not casual, supportive but not prescriptive

${conversationContext ? `Conversation history:\n${conversationContext}\n` : ""}

User (age ${age} years old) just said: "${message}"

Generate:
1. A supportive and empathetic response (1-3 sentences)
   - Use peer counseling skills: validate emotions, reflect key feelings/thoughts, show you're truly listening
   - When helpful, gently invite them to explore their feelings further (but don't interrogate)
   - Balance being relatable and being helpful - you're a trained peer, not just a friend
   - Match the language of input:
     * Korean: Use polite form (존댓말: -요, -세요 endings) with warm, friendly tone
     * English: Use conversational, supportive language
   - Use age-appropriate language (user is ${age} years old)
   - Avoid overly clinical or formal phrasing
   - Your facial expression should match and enhance your words

2. The facial expression YOU should show while delivering this response
   - Your avatar will display this emotion through realistic facial expressions
   - Choose the emotion that best conveys peer support and understanding
  
   Available expressions:
   - joy: warm smile when they share good news or positive moments
   - sadness: empathic concern when they express clear pain or difficulty
   - anger: supportive validation when they express frustration or unfairness
   - fear: gentle reassurance when they express worry or anxiety
   - surprise: genuine interest when they share unexpected news
   - disgust: acknowledging difficult or unjust situations with them
   - neutral: calm, attentive presence for greetings, casual talk, or when just listening

   IMPORTANT Guidelines for peer counseling context:
   - Default to neutral for greetings, introductions, or casual conversation
   - Just because someone is willing to talk ≠ they're in distress (use neutral, not sadness)
   - Only use stronger emotions when they explicitly describe difficult feelings or situations
   - Your expression should feel like a trained peer counselor's natural reaction - caring but composed
   - Your expression should feel like a friend's natural reaction, not clinical assessment
   - Match your expression to your supportive words
   - When uncertain between neutral and emotional, choose the emotional one with lower multiplier (0.85-0.90)

3. Intensity Multiplier (0.85 to 1.15)
   - This controls how strongly the facial expression is displayed
   - Think: how would a caring peer friend naturally react?
   
   - 0.85-0.90: Light conversation, just checking in, subtle expression
   - 0.95-1.00: Normal emotional moment, natural peer reaction
   - 1.05-1.10: Significant moment they're sharing, clear supportive expression
   - 1.15: Really important/intense moment, pronounced caring expression

CRITICAL: Return ONLY valid JSON (no markdown):
{
  "response": "your peer counselor response here",
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

    console.log(`✅ Response completed`);

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
    const { text, language, avatarGender } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: "Text is required" });
    }

    console.log(`🔊 TTS request (avatar: ${avatarGender || "default"})`);

    // Voice configuration based on avatar gender and language
    const VOICE_CONFIG = {
      female: {
        "ko-KR": "shimmer",
        "en-US": "nova",
      },
      male: {
        "ko-KR": "onyx",
        "en-US": "echo",
      },
    };

    // Select voice based on avatar gender and language
    let voice;
    if (avatarGender && VOICE_CONFIG[avatarGender]) {
      voice = VOICE_CONFIG[avatarGender][language] || "shimmer";
    } else {
      // Fallback to default (female voices)
      voice = language === "ko-KR" ? "shimmer" : "nova";
    }

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

    console.log(`✅ TTS generated (voice: ${voice})`);

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
// Participant Management Endpoints
// ═════════════════════════════════════════════════════════════════════
const PARTICIPANTS_DIR = path.join(__dirname, "logs");

// Ensure participants directory exists
if (!fs.existsSync(PARTICIPANTS_DIR)) {
  fs.mkdirSync(PARTICIPANTS_DIR, { recursive: true });
  console.log("📁 Created logging directory");
}

// Check if participant exists and return their avatar selection
app.post("/api/participants/check", (req, res) => {
  try {
    const { participantId } = req.body;

    if (!participantId) {
      return res.status(400).json({ error: "participantId is required" });
    }

    const participantDir = path.join(PARTICIPANTS_DIR, participantId);
    const infoFile = path.join(participantDir, "participant-info.json");

    if (fs.existsSync(infoFile)) {
      const info = JSON.parse(fs.readFileSync(infoFile, "utf8"));
      console.log(`✅ Existing participant found: ${participantId}`);
      res.json({
        exists: true,
        age: info.age,
        gender: info.gender,
        selectedAvatar: info.selectedAvatar,
      });
    } else {
      console.log(`📝 New participant: ${participantId}`);
      res.json({ exists: false });
    }
  } catch (error) {
    console.error("❌ Check participant error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Create new participant with avatar selection
app.post("/api/participants/create", (req, res) => {
  try {
    const { participantId, age, gender, selectedAvatar } = req.body;

    if (!participantId || !selectedAvatar) {
      return res
        .status(400)
        .json({ error: "participantId and selectedAvatar are required" });
    }

    // Validate avatar selection
    if (!["female", "male"].includes(selectedAvatar)) {
      return res
        .status(400)
        .json({ error: "selectedAvatar must be 'female' or 'male'" });
    }

    const participantDir = path.join(PARTICIPANTS_DIR, participantId);
    const sessionsDir = path.join(participantDir, "sessions");

    // Create directories
    if (!fs.existsSync(participantDir)) {
      fs.mkdirSync(participantDir, { recursive: true });
    }
    if (!fs.existsSync(sessionsDir)) {
      fs.mkdirSync(sessionsDir, { recursive: true });
    }

    const participantInfo = {
      participantId,
      age: age || null,
      gender: gender || "",
      selectedAvatar,
    };

    const infoFile = path.join(participantDir, "participant-info.json");
    fs.writeFileSync(infoFile, JSON.stringify(participantInfo, null, 2));

    console.log(
      `✅ Participant created: ${participantId} (avatar: ${selectedAvatar})`
    );

    res.json({ success: true, participantInfo });
  } catch (error) {
    console.error("❌ Create participant error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ═════════════════════════════════════════════════════════════════════
// Session Logging Endpoints
// ═════════════════════════════════════════════════════════════════════
app.post("/api/session/start", (req, res) => {
  try {
    const {
      participantId,
      age,
      gender,
      group,
      conditionNumber,
      condition,
      customizationSettings,
      language,
    } = req.body;

    sessionLogger.startSession({
      participantId,
      age,
      gender,
      group,
      conditionNumber,
      condition,
      language,
      initialSettings: customizationSettings,
    });

    res.json({ success: true });
  } catch (error) {
    console.error("❌ Session start error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/session/log-turn", (req, res) => {
  try {
    const { userTranscript, counselorResponse, counselorEmotion } = req.body;

    sessionLogger.logTurn({
      userTranscript,
      counselorResponse,
      counselorEmotion,
    });

    res.json({ success: true });
  } catch (error) {
    console.error("❌ Turn logging error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/session/log-settings", (req, res) => {
  try {
    const { baseIntensity, baseFrequency } = req.body;

    sessionLogger.logSettingsChange({
      baseIntensity,
      baseFrequency,
    });

    res.json({ success: true });
  } catch (error) {
    console.error("❌ Settings logging error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/session/end", (req, res) => {
  try {
    sessionLogger.endSession();
    res.json({ success: true });
  } catch (error) {
    console.error("❌ Session end error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ═════════════════════════════════════════════════════════════════════
// Config Endpoint
// ═════════════════════════════════════════════════════════════════════
app.get("/api/config", (req, res) => {
  res.json({
    loggingEnabled: process.env.LOGGING_ENABLED === "true",
  });
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
      participantCheck: "POST /api/participants/check",
      participantCreate: "POST /api/participants/create",
    },
  });
});

// ═════════════════════════════════════════════════════════════════════
// Start Server
// ═════════════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 AI Avatar Counselor API`);
  console.log(`📡 Server running on http://localhost:${PORT}`);
  console.log(
    `✅ OpenAI API Key: ${
      process.env.OPENAI_API_KEY ? "Configured" : "⚠️  Missing!"
    }`
  );
  console.log(
    `📝 Session Logging: ${
      process.env.LOGGING_ENABLED === "true" ? "Enabled ✅" : "Disabled"
    }`
  );
  console.log(`\n📋 Available endpoints:`);
  console.log(`   POST /api/sentiment           - Micro Response (chunk)`);
  console.log(
    `   POST /api/generate-response-with-emotion - Counselor Response with emotion`
  );
  console.log(
    `   POST /api/tts                 - Text-to-Speech (with avatar voice)`
  );
  console.log(`   POST /api/participants/check  - Check participant exists`);
  console.log(`   POST /api/participants/create - Create new participant`);
  console.log(`   POST /api/session/start       - Start session logging`);
  console.log(`   POST /api/session/log-turn    - Log conversation turn`);
  console.log(`   POST /api/session/log-settings - Log settings change`);
  console.log(`   POST /api/session/end         - End session logging`);
  console.log(`   GET  /health                  - Health Check\n`);
});

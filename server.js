import express from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash",
  generationConfig: {
    temperature: 0.7,
    maxOutputTokens: 200,
    thinkingConfig: {
      thinkingBudget: 0, // Disables thinking
    },
  },
});

app.use(cors());
app.use(express.json());

// Emotion analysis endpoint
app.post("/api/analyze-emotion", async (req, res) => {
  try {
    const { transcript } = req.body;

    if (!transcript || transcript.trim().length < 2) {
      return res.status(400).json({
        error: "Transcript is too short or empty",
      });
    }

    console.log("📝 Received transcript:", transcript);

    const prompt = `You are an empathetic AI counselor analyzing client emotions.

TASK: Analyze the emotional state from the client's speech and generate an appropriate empathetic response.

CLIENT SAID: "${transcript}"

OUTPUT FORMAT (JSON only, no markdown):
{
  "emotion": "joy|sadness|anger|fear|surprise|disgust|neutral",
  "intensity": 0.0-1.0,
  "response": "empathetic counselor response in the same language as input"
}

GUIDELINES:
- Detect primary emotion from speech content and tone indicators
- Intensity: 0.3=subtle, 0.6=moderate, 0.9=strong
- Response should validate feelings and show understanding
- Keep responses natural and conversational (2-3 sentences)
- Match the language of input (Korean/English)

Return ONLY the JSON object, no other text.`;

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    // Remove markdown code blocks if present
    const cleanText = text
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    const parsed = JSON.parse(cleanText);

    // Validate response structure
    if (!parsed.emotion || !parsed.response) {
      throw new Error("Invalid response structure");
    }

    // Log for research data collection
    console.log(
      `✅ [${new Date().toISOString()}] Emotion: ${
        parsed.emotion
      }, Intensity: ${parsed.intensity}`
    );

    res.json(parsed);
  } catch (error) {
    console.error("❌ Gemini API Error:", error.message);

    // Fallback response
    res.status(500).json({
      emotion: "neutral",
      intensity: 0.5,
      response: "죄송합니다. 잠시 후 다시 말씀해 주세요.",
      error: true,
    });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Server is running" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Counselor API running on http://localhost:${PORT}`);
  console.log(
    `✅ Gemini API Key: ${
      process.env.GEMINI_API_KEY ? "Configured" : "⚠️  Missing!"
    }`
  );
});

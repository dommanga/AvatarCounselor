import express from "express";
import OpenAI from "openai";
import cors from "cors";
import "dotenv/config";

const app = express();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.use(cors());
app.use(express.json());

// Emotion analysis endpoint
app.post("/api/analyze-emotion", async (req, res) => {
  try {
    const { transcript } = req.body;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an empathetic AI counselor analyzing client emotions.

TASK: Analyze the emotional state from the client's speech and generate an appropriate empathetic response.

OUTPUT FORMAT (JSON only):
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
- Match the language of input (Korean/English)`,
        },
        {
          role: "user",
          content: transcript,
        },
      ],
      temperature: 0.7,
      max_tokens: 200,
      response_format: { type: "json_object" },
    });

    const result = JSON.parse(completion.choices[0].message.content);

    // Log for research data collection
    console.log(
      `[${new Date().toISOString()}] Emotion: ${result.emotion}, Intensity: ${
        result.intensity
      }`
    );

    res.json(result);
  } catch (error) {
    console.error("GPT API Error:", error);
    res.status(500).json({
      emotion: "neutral",
      intensity: 0.5,
      response: "죄송합니다. 잠시 후 다시 말씀해 주세요.",
      error: true,
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Counselor API running on http://localhost:${PORT}`);
});

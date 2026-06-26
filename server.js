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

    const convertToISO = (timestamp) => {
      return (
        timestamp.substring(0, 10) +
        "T" +
        timestamp.substring(11).replace(/-/g, ":")
      );
    };

    const start = new Date(
      convertToISO(this.currentSession.metadata.startTime)
    );
    const end = new Date(convertToISO(this.currentSession.metadata.endTime));
    this.currentSession.metadata.duration = this._formatDuration(end - start);

    this._saveMetadata();
    console.log(`✅ Session ended: ${this.currentSession.sessionId}`);
    this.currentSession = null;
  }

  _formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
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
    const { message, conversationHistory, userAge, verbalStyle } = req.body;

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
        .slice(-40)
        .map((h) => `${h.speaker}: ${h.text}`)
        .join("\n");
    }

    const age = userAge || 23;

    const prompt_legacy = `You are a peer counselor AI avatar - a trained friend who has learned counseling skills like active listening, empathy, and reflection.

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
   - Language: English
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
   - Use neutral for simple greetings or casual small talk
   - Just because someone is willing to talk ≠ they're in distress (use neutral, not sadness)
   - Only use stronger emotions when they explicitly describe difficult feelings or situations
   - Your expression should feel like a trained peer counselor's natural reaction - caring but composed
   - Your expression should feel like a friend's natural reaction, not clinical assessment
   - Match your expression to your supportive words
   - When uncertain, use a gentle emotional expression with lower multiplier (0.85-0.90) rather than staying completely neutral


- When uncertain, use a gentle emotional expression with lower multiplier (0.85-0.90) rather than staying completely neutral

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

    const FOLLOWING_BLOCK = `You are a coach helping the user prepare for an upcoming mock interview that
      will take place in a few minutes. The user will present in front of an
      evaluation panel.

      Your goal is to use this short pre-task coaching session (about 10 minutes)
      to get the user into a prepared, ready state before they begin. Move naturally
      through rapport-building, focusing, exploration, and wrap-up, but do not narrate
      these stages to the user.

      COACHING STYLE: Following
      You let the user lead the direction of the conversation. You draw out the
      user's own thoughts, resources, and decisions rather than supplying them,
      following where the user wants to go.

      Specific principles:
      - Follow the user's focus: Let the user decide what would be most helpful to
        work on, and go there with them.
        (e.g., "What part of this would feel most useful to focus on right now?")
      - Question form: Use mostly open questions that invite the user to explore and
        elaborate. (e.g., "What goes through your mind when you imagine that moment?")
      - Response style: Respond to what the user says with reflection — restate or
        add meaning to their words before moving on. Sit with what they share rather
        than rushing to the next step.
      - Information and advice: Hold back. Offer information or suggestions only when
        the user asks, or after asking permission.
      - Affirmation: Point out strengths that are already present in the user's own
        words. (e.g., "It sounds like, even then, you found a way to slow yourself
        down — that came from you.")
      - Wrap-up: Let the user articulate their own plan; you reflect it back and
        summarize what they came to.

      Keep your responses concise, and let the user do most of the talking.
      Do not explain coaching, psychology, MI, or your "Following style" to the user —
      just act as a coach. Do not diagnose the user.`;
      
    const DIRECTING_BLOCK = `You are a coach helping the user prepare for an upcoming mock interview that
      will take place in a few minutes. The user will present in front of an
      evaluation panel.

      Your goal is to use this short pre-task coaching session (about 10 minutes)
      to get the user into a prepared, ready state before they begin. Move naturally
      through rapport-building, focusing, exploration, and wrap-up, but do not narrate
      these stages to the user.

      COACHING STYLE: Directing
      You lead the direction of the conversation. You actively provide structure and
      information, and you decide what to cover, guiding the user along.

      Specific principles:
      - Set the agenda: You decide what to cover and state it explicitly.
        (e.g., "Let's cover two things today: first, how you structure your answers,
        and second, your mindset in the opening moment.")
      - Question form: Use mostly specific, closed questions that narrow the user's
        response. (e.g., "On a scale of 1 to 10, how nervous are you right now?")
      - Response style: Acknowledge the user briefly, then move directly to the next
        step. Do not give long emotional reflections.
      - Information and advice: Offer these proactively, even when the user has not
        asked. Provide useful frameworks (e.g., the STAR structure: Situation, Task,
        Action, Result) or concrete strategies.
      - Affirmation: You assess and point out the user's strengths directly.
        (e.g., "Diligence and attention to detail translate directly into
        credibility in an interview.")
      - Wrap-up: At the end, you summarize into actionable instructions and hand off.

      Keep your responses concise but informative. Focus on one thing at a time.
      Do not explain coaching, psychology, MI, or your "Directing style" to the user —
      just act as a coach. Do not diagnose the user.`

    const verbalBlock = verbalStyle === "following" ? FOLLOWING_BLOCK : DIRECTING_BLOCK;

    // const prompt = `${DIRECTING_BLOCK}
    const prompt = `${verbalBlock}

    ${conversationContext ? `Conversation history:\n${conversationContext}\n` : ""}

    User (age ${age} years old) just said: "${message}"

    Generate:
    1. A response consistent with your coaching style described above (1-3 sentences)
      - Language: English

    2. The facial expression YOU should show while delivering this response
      - Your avatar will display this emotion through realistic facial expressions
      - Choose the emotion that best conveys coaching support and understanding
      
      Available expressions:
      - joy: warm smile when they share good news or positive moments
      - sadness: empathic concern when they express clear pain or difficulty
      - anger: supportive validation when they express frustration or unfairness
      - fear: gentle reassurance when they express worry or anxiety
      - surprise: genuine interest when they share unexpected news
      - disgust: acknowledging difficult or unjust situations with them
      - neutral: calm, attentive presence for greetings, casual talk, or when just listening

      IMPORTANT Guidelines for coaching context:
      - Use neutral for simple greetings or casual small talk
      - Only use stronger emotions when they explicitly describe difficult feelings or situations
      - Your expression should feel like a trained coach's natural reaction
      - Match your expression to your words
      - When uncertain, use a gentle emotional expression with lower multiplier (0.85-0.90) rather than staying completely neutral

    3. Intensity Multiplier (0.85 to 1.15)
      - This controls how strongly the facial expression is displayed
      - Think: how would a caring coach naturally react?
      
      - 0.85-0.90: Light conversation, just checking in, subtle expression
      - 0.95-1.00: Normal emotional moment, natural peer reaction
      - 1.05-1.10: Significant moment they're sharing, clear supportive expression
      - 1.15: Really important/intense moment, pronounced caring expression

    CRITICAL: Return ONLY valid JSON (no markdown):
    {
      "response": "your coach response here",
      "counselorEmotion": {
        "dominantEmotion": "sadness",
        "intensityMultiplier": 0.95
      }
    }
    `;

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
    console.log(
    `\n────────── TURN [V:${verbalStyle}] ──────────\n` +
    `USER: ${message}\n` +
    `AGENT: ${data.response}\n` +
    `   (emotion: ${data.counselorEmotion.dominantEmotion} ×${data.counselorEmotion.intensityMultiplier})\n` +
    `──────────────────────────────────────────\n`
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
// ENDPOINT 3: Hume TTS (Text-to-Speech)
// ═════════════════════════════════════════════════════════════════════

// Hume voice IDs per verbal style
const HUME_VOICE_IDS = {
  directing: "590afc65-0669-42d4-ace7-16d008c013fb",
  following: "85442b15-9e01-4c93-bfc1-d3da4954daf2",
};

// IPA phoneme → Rocketbox viseme morph (Oculus OVR viseme standard)
const IPA_TO_VISEME = {
  // 무음
  "sil": "AA_VI_00_Sil", "sp": "AA_VI_00_Sil", "": "AA_VI_00_Sil",
  // 양순 (PP)
  "p": "AA_VI_01_PP", "b": "AA_VI_01_PP", "m": "AA_VI_01_PP",
  // 순치 (FF)
  "f": "AA_VI_02_FF", "v": "AA_VI_02_FF",
  // 치간 (TH)
  "θ": "AA_VI_03_TH", "ð": "AA_VI_03_TH",
  // 치경 폐쇄 (DD)
  "t": "AA_VI_04_DD", "d": "AA_VI_04_DD", "ɾ": "AA_VI_04_DD",
  // 연구개 (KK)
  "k": "AA_VI_05_KK", "ɡ": "AA_VI_05_KK", "g": "AA_VI_05_KK", "ŋ": "AA_VI_05_KK",
  // 후치경 마찰/파찰 (CH)
  "tʃ": "AA_VI_06_CH", "dʒ": "AA_VI_06_CH", "ʃ": "AA_VI_06_CH", "ʒ": "AA_VI_06_CH",
  // 치찰 (SS)
  "s": "AA_VI_07_SS", "z": "AA_VI_07_SS", "ts": "AA_VI_07_SS",
  // 비음/설측 (nn)
  "n": "AA_VI_08_nn", "l": "AA_VI_08_nn",
  // 권설/접근 (RR)
  "ɹ": "AA_VI_09_RR", "r": "AA_VI_09_RR", "ɝ": "AA_VI_09_RR", "ɚ": "AA_VI_09_RR", "ɻ": "AA_VI_09_RR",
  // 열린 모음 (aa)
  "ɑ": "AA_VI_10_aa", "ɐ": "AA_VI_10_aa", "a": "AA_VI_10_aa", "ʌ": "AA_VI_10_aa", "ɒ": "AA_VI_10_aa", "ɑː": "AA_VI_10_aa",
  "ə": "AA_VI_10_aa", "ɜ": "AA_VI_10_aa", "ɜː": "AA_VI_10_aa", "aɪ": "AA_VI_10_aa", "h": "AA_VI_10_aa",
  // 전설 중 (E)
  "e": "AA_VI_11_E", "ɛ": "AA_VI_11_E", "eɪ": "AA_VI_11_E", "æ": "AA_VI_11_E",
  // 전설 고 (I)
  "i": "AA_VI_12_I", "ɪ": "AA_VI_12_I", "iː": "AA_VI_12_I", "j": "AA_VI_12_I",
  // 후설 원순 (O)
  "o": "AA_VI_13_O", "ɔ": "AA_VI_13_O", "oː": "AA_VI_13_O", "oʊ": "AA_VI_13_O", "ɔː": "AA_VI_13_O", "aʊ": "AA_VI_13_O", "ɔɪ": "AA_VI_13_O",
  // 후설 고 (U)
  "u": "AA_VI_14_U", "ʊ": "AA_VI_14_U", "uː": "AA_VI_14_U", "w": "AA_VI_14_U",
};

function ipaToViseme(ipa) {
  return IPA_TO_VISEME[ipa] || "AA_VI_10_aa";
}

app.post("/api/tts", async (req, res) => {
  try {
    const { text, verbalStyle } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: "Text is required" });
    }

    const style = verbalStyle === "following" ? "following" : "directing";
    const voiceId = HUME_VOICE_IDS[style];

    console.log(`🔊 Hume TTS request (style: ${style})`);

    const humeRes = await fetch("https://api.hume.ai/v0/tts", {
      method: "POST",
      headers: {
        "X-Hume-Api-Key": process.env.HUME_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        utterances: [{ text: text, voice: { id: voiceId } }],
        format: { type: "mp3" },
        version: "2",
        include_timestamp_types: ["phoneme"],
      }),
    });

    if (!humeRes.ok) {
      const errText = await humeRes.text();
      console.error("❌ Hume API error:", humeRes.status, errText);
      throw new Error(`Hume API error: ${humeRes.status}`);
    }

    const data = await humeRes.json();
    const gen = data?.generations?.[0];
    const audioBase64 = gen?.audio;

    if (!audioBase64) {
      throw new Error("Hume returned no audio");
    }

    // snippets 전체를 돌며 phoneme timestamp 수집 → viseme로 변환
    const visemes = [];
    const unmapped = new Set();
    const snippets = gen?.snippets || [];

    for (const snip of snippets) {
      const arr = Array.isArray(snip) ? snip : [snip];
      for (const s of arr) {
        const timestamps = s?.timestamps || [];
        for (const ts of timestamps) {
          if (ts.type !== "phoneme") continue;
          const ipa = ts.text;
          if (!(ipa in IPA_TO_VISEME)) unmapped.add(ipa);
          visemes.push({
            viseme: ipaToViseme(ipa),
            begin: ts.time.begin, // ms
            end: ts.time.end,     // ms
          });
        }
      }
    }

    if (unmapped.size > 0) {
      console.log(`⚠️ Unmapped IPA (fallback to aa):`, [...unmapped].join(" "));
    }

    console.log(`✅ Hume TTS (style: ${style}, ${visemes.length} visemes, ${gen.duration}s)`);

    res.json({
      audio: audioBase64,
      visemes: visemes,
      duration: gen.duration,
    });
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

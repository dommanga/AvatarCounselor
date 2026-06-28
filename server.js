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
const COUNSELOR_MODEL = "gpt-4o";
const TRANSITION_MODEL = "gpt-4o";

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
// Phase State Machine — server-side stateful (keyed by sessionId)
// ═════════════════════════════════════════════════════════════════════
const PHASE_ORDER = ["engaging", "focusing", "evoking", "planning"];
const PHASE_CAPS = { engaging: 3, focusing: 4, evoking: 6, planning: 4 }; // placeholder, 추후 조정

// Server holds phase state so the transition check can run AFTER the response
// is sent (zero added latency for the user). Keyed by sessionId.
class PhaseStateStore {
  constructor() {
    this.sessions = new Map(); // sessionId -> { phase, turnCount, pending, done }
  }
  get(sessionId) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        phase: "engaging",
        turnCount: 0,
        pending: null,
        done: false,
      });
    }
    return this.sessions.get(sessionId);
  }
  reset(sessionId) {
    this.sessions.set(sessionId, {
      phase: "engaging",
      turnCount: 0,
      pending: null,
      done: false,
    });
    console.log(`🔄 Phase state reset: ${sessionId}`);
  }
  clear(sessionId) {
    this.sessions.delete(sessionId);
  }
}
const phaseStore = new PhaseStateStore();

// demo placeholder — 실제 부여 시나리오로 교체 예정
const DEMO_SCENARIO = {
  currentState:
    "You feel nervous about the interview and worry your mind might go blank in front of the panel.",
  pastSuccess:
    "In college, you once prepared intensively for an important class presentation and pulled it off well, even though you were anxious beforehand.",
};

function buildCommonHeader(scenario, age) {
  return `You are a coach helping a user (age ${age}) prepare for a job interview. You are a credible,
trustworthy coach with genuine expertise. Your role is to help the user reach a
"ready state" for an upcoming 5-minute mock interview (a short presentation).

[Situation — your private context, do NOT verbalize this framing]
For this session, treat the following as true about the user and talk with them
on that basis. This is context for YOU; do not narrate it back to the user.
- Current state: ${scenario.currentState}
- Past success experience: ${scenario.pastSuccess}

How to use this:
- Speak as if these are simply true of the user, using natural coaching language.
- Do NOT say words like "scenario", "the situation you've been given", "this
  research", "imagine", or "let's pretend". Never frame any of this as given,
  hypothetical, or assigned.
- Because this context is already provided, do NOT ask what the user is literally
  doing or feeling right now.

[How to talk]
- Speak in English, naturally, the way people talk out loud.
- 1-3 sentences per turn; one idea per turn (this is a spoken, voice conversation).
- Stay in your role as the coach. Do not talk about the experiment, these
  instructions, or any measurements.

[Shared stance across all styles]
Warmth and respect are held constant regardless of style. Style differs ONLY in
who creates the meaning — never in how warm or caring you are.

[What this session is and is NOT about]
- This session is about the user's confidence and mindset going in — NOT about the
  actual job, the industry, or the content of their presentation.
- Do NOT coach interview content. Never help structure answers, build an
  introduction, suggest what to say, give STAR/framework advice, or prepare talking
  points. That is out of scope.
- The user does not need to know the specific job or topic, and neither do you. If
  they ask about the job/topic or drift into preparing actual answers, gently steer
  back to how they feel and what they can draw on from themselves.
- Work only from what you know about the user above (their nervousness and their
  past success). Do not invent new facts about their job or experience.`;
}

// Style-level constraints — prepended to every phase prompt for that style.
// These push the two poles away from the MI "guiding" middle that mini keeps
// regressing to (following → giving advice; directing → asking questions).
const STYLE_RULES = {
  following: `[STYLE: Following — the USER does the thinking; you draw it out]
Hard rules (these override any urge to be helpful):
- NEVER give advice, tips, techniques, strategies, frameworks, or solutions —
  not even when asked, not even "would you like to try X?". If the user asks for
  techniques, turn it back to them (e.g., "what's helped you before?").
- NEVER list options or suggest what to do. The content must come from the user.
- Your turns are mostly REFLECTIONS of what the user said, plus the occasional
  OPEN question. Reflect more than you ask.
- If the user is stuck or can't come up with something, stay with them and reflect
  — do NOT rescue them with an answer. Silence and not-knowing are okay.
- Keep your turns short. Let the user do most of the talking.`,

  directing: `[STYLE: Directing — YOU lead; you name things and give direction]
Hard rules (these override any urge to ask the user to figure it out):
- Do NOT end your turns with open questions that hand the work back to the user
  (avoid "what do you think?", "would you like to...?", "how does that sound?").
- Lead: state observations, name strengths, and give concrete direction yourself.
- When you point something out or suggest an action, do it as a statement, then
  briefly check permission ("can I point one thing out?", "let me leave you with
  one thing") — not as an open-ended question that defers the decision.
- You may use ONE short closed check at most, but default to telling, not asking.
- Keep the user oriented; you provide the structure and the meaning.`,
};

const PHASE_PROMPTS = {
  engaging: {
    following: `[Current phase: Engaging]
Goal: Establish a working footing with the user and bring their current stance
toward the interview into the open — letting the USER set the tone.

Do:
- Open warmly and invite the user to talk about how they're approaching the
  interview, working from the situation they've been given.
- Reflect what they share (simple/complex reflections); let them lead.
- Affirm their willingness to prepare.
- Use reflections more than questions; follow the user's lead rather than steering.

Don't:
- Don't set an agenda or tell them what the session will cover yet.
- Don't give advice or information about the interview.
- Don't ask what they are literally doing or feeling at this moment.`,
    directing: `[Current phase: Engaging]
Goal: Establish a working footing by naming the situation and framing the session
yourself, and bringing the user on board — YOU set the tone.

Do:
- Open warmly, name the situation they've been given, and acknowledge the stance
  that naturally comes with it (e.g., some nerves are normal).
- Briefly frame what the two of you will do together this session.
- Lead: take initiative in setting a confident, supportive footing.

Don't:
- No coercion or judgment.
- Don't become cold or businesslike while leading — keep warmth constant.
- Don't ask what they are literally doing or feeling at this moment.`,
  },
  focusing: {
    following: `[Current phase: Focusing]
Goal: Arrive at a focus for the session — what to work on before the interview —
chosen BY the user.

Do:
- Invite the user to name what they'd most want to work on (open question).
- Reflect and confirm their choice; check you've understood the focus.
- Let the user's choice set the direction.

Don't:
- Don't propose the focus yourself or steer them to a topic.
- Don't give information or advice about what they "should" focus on.`,
    directing: `[Current phase: Focusing]
Goal: Set a clear focus for the session yourself, drawn from the user's given
situation, and bring the user to adopt it.

Do:
- Propose a specific focus drawn from the user's given current concern.
- Briefly explain why this focus matters most right now.
- Ask permission before locking it in (e.g., "shall we focus there?").

Don't:
- No coercion; offer the focus, don't impose it if the user clearly objects.
- Don't become cold while leading.`,
  },
  evoking: {
    following: `[Current phase: Evoking]
Goal: Help the user connect their given past success to the upcoming interview as
a usable resource — and let the USER be the one who makes that connection.

Do:
- First, invite the user to re-tell the given success experience in their own words.
- Use complex reflections to mirror back the user's OWN effort and ability — what
  they did, not luck or outside help.
- Let the USER voice the connection; use questions to lead them to bridge it
  themselves. Don't hand them the meaning.
- Affirm the strengths and connections the user states themselves.
- Use reflections more than questions.

Don't:
- Don't assert what the experience means or how it connects. That bridge comes
  from the user.
- Don't give interview advice or information first.
- Don't push to move on before the user voices a connection; but if they never
  reach it, do not force it.`,
    directing: `[Current phase: Evoking]
Goal: As the coach, name the user's given past success and connect it to the
upcoming interview as a usable resource, and bring the user to take it on board.

Do:
- Raise the success experience yourself.
- Clearly name the ability and effort the user showed; make explicit it was their
  own doing, not luck.
- Assert that this resource carries directly into the interview.
- Do this respectfully: briefly ask permission before pointing things out
  (e.g., "can I point one thing out?").
- Provide structure; you provide the connection.

Don't:
- No coercion, no flat verdicts, no judgment. Avoid "of course you should..." or
  "that's wrong."
- Don't withhold the connection waiting for the user to arrive at it.
- Don't become cold or businesslike.`,
  },
  planning: {
    following: `[Current phase: Planning]
Goal: Arrive at ONE concrete thing the user will carry into the interview —
formulated BY the user.

Do:
- Invite the user to decide one concrete thing to take into the interview.
- Reflect and affirm what they land on.
- Emphasize their autonomy — the choice is theirs.

Don't:
- Don't prescribe the plan or tell them what to do.
- Don't give a list of tips.
- If the user stays vague, you may reflect that back once, but do not formulate
  the plan for them.`,
    directing: `[Current phase: Planning]
Goal: Give the user ONE concrete thing to do right before the interview, and bring
them to take it on board.

Do:
- Offer one specific, concrete action or focus for the moments before the interview.
- Keep it to ONE clear thing, not a list.
- Ask permission before prescribing (e.g., "can I leave you with one thing?").

Don't:
- No coercion or judgment.
- Don't pile on multiple instructions — one concrete takeaway only.
- Don't become cold while leading.`,
  },
};

const TRANSITION_PROMPTS = {
  engaging: `Read the conversation so far and decide whether the "Engaging" phase goal is met.
Goal: Is there a working footing, AND has the user's stance toward the interview surfaced?

Base your decision on the USER's most recent message, not on what the coach said or offered.
Answer "yes" ONLY if ONE is clearly true:
- The user has engaged and shared, in their own words, how they feel about or are approaching the interview.
- The coach named the situation/framed the session AND the user explicitly went along with it.

Answer "no" if ANY of these:
- The user's latest message is only a greeting, a question, or a one-word reply with no stance shared yet.
- The user has not really said anything about the interview yet.

Reply with exactly one word: "yes" or "no".`,

  focusing: `Read the conversation so far and decide whether the "Focusing" phase goal is met.
Goal: Is there a clear focus/target for the rest of the session that BOTH sides are working on?

Base your decision on the USER's most recent message, not on what the coach proposed.
Answer "yes" ONLY if ONE is clearly true:
- The user, in their own words, named what they want to focus on.
- The coach proposed a focus AND the user then explicitly agreed to it (e.g., "yeah, let's do that").

Answer "no" if ANY of these:
- The user's latest message is a question, expresses confusion, doubt, or "I don't know".
- The coach only proposed or suggested a focus and the user has not yet agreed.
- No specific focus has been settled yet.

Reply with exactly one word: "yes" or "no".`,

  evoking: `Read the conversation so far and decide whether the "Evoking" phase goal is met.
Goal: Has the user's past success been connected to the upcoming interview as a usable resource?

Base your decision on the USER's most recent message, not on what the coach offered.
Answer "yes" ONLY if ONE is clearly true:
- The user, in their own words, linked their past success to the interview
  (e.g., "so I guess preparing like that could work here too").
- The coach stated the connection AND the user then explicitly agreed or took it up
  (e.g., "yeah, that makes sense", "you're right").

Answer "no" if ANY of these:
- The user's latest message is a question, expresses confusion, doubt, or "I don't know".
- The coach only offered, asked permission, or proposed the connection and the user has not yet responded with agreement.
- The success was only mentioned but not yet tied to the interview by the user.

Reply with exactly one word: "yes" or "no".`,

  planning: `Read the conversation so far and decide whether the "Planning" phase goal is met.
Goal: Is there ONE concrete, specific takeaway for the interview that the user is on board with?

Base your decision on the USER's most recent message, not on what the coach proposed.
Answer "yes" ONLY if ONE is clearly true:
- The user, in their own words, stated a specific thing they will do or carry into the interview.
- The coach offered a specific single takeaway AND the user then explicitly accepted it.

Answer "no" if ANY of these:
- The user's latest message is a question, expresses confusion, doubt, or "I don't know".
- The coach only suggested a takeaway and the user has not yet accepted it.
- The takeaway is still vague or general, or none has been settled.

Reply with exactly one word: "yes" or "no".`,
};

const EMOTION_TAIL = `Produce the coach's next reply to the user's latest message.

Return:
1. A response consistent with the coaching style and the current-phase instructions above (1-3 sentences). Language: English.

2. The facial expression YOU should show while delivering this response.
   Available expressions: joy, sadness, anger, fear, surprise, disgust, neutral
   Guidelines (coaching context):
   - Your expression should feel like a trained coach's natural reaction; match it to your words.
   - When uncertain, use a gentle emotion with a lower multiplier (0.85-0.90).

3. Intensity Multiplier (0.85 to 1.15)
   - 0.85-0.90 subtle / 0.95-1.00 normal / 1.05-1.10 clear / 1.15 pronounced

CRITICAL: Return ONLY valid JSON (no markdown):
{
  "response": "your coach response here",
  "counselorEmotion": { "dominantEmotion": "neutral", "intensityMultiplier": 0.95 }
}`;

// Transition check — runs AFTER the response is sent (no user-facing latency)
async function checkPhaseTransition(phase, contextString) {
  try {
    const prompt = `${TRANSITION_PROMPTS[phase]}

Conversation so far:
${contextString}`;
    const completion = await openai.chat.completions.create({
      model: TRANSITION_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 5,
    });
    return completion.choices[0].message.content
      .trim()
      .toLowerCase()
      .startsWith("y");
  } catch (e) {
    console.error("❌ transition check failed:", e.message);
    return false; // fail-safe: stay in phase
  }
}

// ═════════════════════════════════════════════════════════════════════
// ENDPOINT 1: Sentiment Analysis (Micro Response)
// ═════════════════════════════════════════════════════════════════════
app.post("/api/sentiment", async (req, res) => {
  try {
    const { chunk } = req.body;

    if (!chunk || chunk.trim().length < 3) {
      return res.json({ sentiment: "neutral" });
    }

    // console.log("🔍 Sentiment analysis for chunk");

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

    // console.log(`✅ Final Sentiment analysis completed`);

    res.json({ sentiment: finalSentiment });
  } catch (error) {
    console.error("❌ Sentiment analysis error:", error.message);
    res.json({ sentiment: "neutral" }); // Fail gracefully
  }
});

// ═════════════════════════════════════════════════════════════════════
// ENDPOINT 2: Generate Counselor Response with Emotion (Full Response)
//   B + stateful: generate in stored phase → respond → async transition update
// ═════════════════════════════════════════════════════════════════════
app.post("/api/generate-response-with-emotion", async (req, res) => {
  try {
    const {
      message,
      conversationHistory,
      userAge,
      verbalStyle,
      sessionId, // wired in L3; defaults to "default" for single-session dev
      scenario, // optional; falls back to DEMO_SCENARIO
    } = req.body;

    if (!message || message.trim().length < 2) {
      return res.status(400).json({ error: "Message is required" });
    }

    const style = verbalStyle === "following" ? "following" : "directing";
    const age = userAge || 23;
    const scen = {
      currentState: scenario?.currentState || DEMO_SCENARIO.currentState,
      pastSuccess: scenario?.pastSuccess || DEMO_SCENARIO.pastSuccess,
    };
    const key = sessionId || "default";

    // Full history — history = state, do NOT truncate
    const conversationContext =
      conversationHistory && conversationHistory.length > 0
        ? conversationHistory.map((h) => `${h.speaker}: ${h.text}`).join("\n")
        : "";

    const st = phaseStore.get(key);

    // Ensure the previous turn's async transition has settled before reading
    // phase. This is ≈0 cost in practice: the TTS playback gap from the prior
    // turn is far longer than a mini call, so it has already resolved.
    if (st.pending) {
      try {
        await st.pending;
      } catch (_) {}
    }

    // Fresh-conversation safety: the first turn (only the current user message
    // present) always starts at Engaging, regardless of any stale state.
    if (!conversationHistory || conversationHistory.length <= 1) {
      st.phase = "engaging";
      st.turnCount = 0;
      st.done = false;
    }

    const phase = st.phase;
    const turnsInPhase = st.turnCount;

    console.log(`💬 Generating response [V:${style}] [phase:${phase}]`);

    // ── Generate in the CURRENT (stored) phase — no transition call in this path ──
    const prompt = `${buildCommonHeader(scen, age)}

${STYLE_RULES[style]}

${PHASE_PROMPTS[phase][style]}

${conversationContext ? `Conversation so far (most recent last):\n${conversationContext}\n\n` : ""}${EMOTION_TAIL}`;

    const completion = await openai.chat.completions.create({
      model: COUNSELOR_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 400,
    });

    let responseText = completion.choices[0].message.content
      .trim()
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    const data = JSON.parse(responseText);

    if (!data.response || !data.counselorEmotion) {
      throw new Error("Invalid response structure from LLM");
    }

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
    data.counselorEmotion.intensityMultiplier = Math.max(
      0.5,
      Math.min(1.5, data.counselorEmotion.intensityMultiplier || 1.0)
    );

    // expose phase used (for client-side logging / later MITI coding)
    data.phase = phase;

    console.log(
      `\n────── TURN [V:${style}] [phase:${phase}] ──────\n` +
        `USER: ${message}\n` +
        `AGENT: ${data.response}\n` +
        `   (emotion: ${data.counselorEmotion.dominantEmotion} ×${data.counselorEmotion.intensityMultiplier})\n` +
        `──────────────────────────────────────────\n`
    );

    // ── Respond immediately — TTS flow proceeds with zero added latency ──
    res.json(data);

    // ── AFTER responding: async transition check decides NEXT turn's phase ──
    st.pending = (async () => {
      try {
        const fullContext =
          (conversationContext ? conversationContext + "\n" : "") +
          `coach: ${data.response}`;
        const goalMet = await checkPhaseTransition(phase, fullContext);

        const idx = PHASE_ORDER.indexOf(phase);
        const isLast = idx === PHASE_ORDER.length - 1;
        const turnsDone = turnsInPhase + 1;
        const capHit = turnsDone >= PHASE_CAPS[phase];

        if ((goalMet || capHit) && !isLast) {
          st.phase = PHASE_ORDER[idx + 1];
          st.turnCount = 0;
        } else if (isLast && (goalMet || capHit)) {
          st.done = true;
          st.turnCount = turnsDone;
        } else {
          st.turnCount = turnsDone;
        }

        const flag = capHit && !goalMet ? " ⚠️capHit(unmet)" : "";
        console.log(
          `   ↪ transition[${phase}] goalMet=${goalMet} turns=${turnsDone}/${PHASE_CAPS[phase]}${flag} → next:${st.phase}${st.done ? " 🏁done" : ""}`
        );
      } catch (e) {
        console.error("❌ async transition update failed:", e.message);
      } finally {
        st.pending = null;
      }
    })();
  } catch (error) {
    console.error("❌ Generate response with emotion error:", error.message);

    const isKorean = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(req.body.message);
    res.status(500).json({
      response: isKorean
        ? "죄송합니다. 잠시 후 다시 말씀해 주세요."
        : "I'm sorry, please try again in a moment.",
      counselorEmotion: {
        dominantEmotion: "neutral",
        intensityMultiplier: 0.8,
      },
      phase: "engaging",
      error: true,
    });
  }
});

// ═════════════════════════════════════════════════════════════════════
// ENDPOINT 3: Hume TTS (Text-to-Speech)
// ═════════════════════════════════════════════════════════════════════

// Hume voice IDs per verbal style
const HUME_VOICE_IDS = {
  directing: "eba3647e-736a-410b-8097-f1236229f4f6",
  following: "3938e3a7-b175-4944-a1da-c6280bdfbf6d",
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
  "θ": "AA_VI_03_TH", "ð": "AA_VI_03_TH", "eː": "AA_VI_11_E",
  // 치경 폐쇄 (DD)
  "t": "AA_VI_04_DD", "d": "AA_VI_04_DD", "ɾ": "AA_VI_04_DD",
  // 연구개 (KK)
  "k": "AA_VI_05_KK", "ɡ": "AA_VI_05_KK", "g": "AA_VI_05_KK", "ŋ": "AA_VI_05_KK",
  // 후치경 마찰/파찰 (CH)
  "tʃ": "AA_VI_06_CH", "dʒ": "AA_VI_06_CH", "ʃ": "AA_VI_06_CH", "ʒ": "AA_VI_06_CH",
  // 치찰 (SS)
  "s": "AA_VI_07_SS", "z": "AA_VI_07_SS", "ts": "AA_VI_07_SS",
  // 비음/설측 (nn)
  "n": "AA_VI_08_nn", "l": "AA_VI_08_nn", "əl": "AA_VI_08_nn",
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
  "o": "AA_VI_13_O", "ɔ": "AA_VI_13_O", "oː": "AA_VI_13_O", "oʊ": "AA_VI_13_O", "ɔː": "AA_VI_13_O", "aʊ": "AA_VI_13_O", "ɔɪ": "AA_VI_13_O", "oɪ": "AA_VI_13_O",
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
      sessionId, // phase-state key; defaults to "default"
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

    // reset phase state machine for this session
    phaseStore.reset(sessionId || "default");

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
    const { sessionId } = req.body;
    sessionLogger.endSession();

    // clear phase state for this session
    phaseStore.clear(sessionId || "default");

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
    `   POST /api/generate-response-with-emotion - Counselor Response with emotion (phase state machine)`
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
# AI Avatar Counselor 🤖

**Research Project**: Effects of Non-verbal Empathy Expressions by AI Avatar Counselors on Client Responses

POSTECH CSE Undergraduate Research Project (2025 Fall)

## 🎯 Overview

This project implements an **AI Avatar Counselor** system that generates real-time non-verbal empathy expressions based on users' speech. The research aims to verify the effects of automated AI avatars' non-verbal empathy expressions on client responses and explore effective empathy strategies.

### Research Objectives

1. **Automated Non-verbal Empathy**: Generate avatar facial expressions automatically from user speech
2. **Dual Expression System**: Implement both Micro Response (listening signals) and Full Response (empathic expressions)
3. **Personalized Customization**: Provide user-adjustable intensity and frequency parameters
4. **Experimental Validation**: Verify effectiveness through user studies

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     User Speech Input                        │
│                    (Web Speech API)                          │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ├─── Interim Transcript (Chunks)
                 │         │
                 │         ├─→ Sentiment Analysis (LLM)
                 │         │        │
                 │         │        └─→ Micro Response
                 │         │             • Head nod
                 │         │             • Eyebrow raise
                 │         │             • Slight emotional expression
                 │         │             (0.5-0.8s duration)
                 │
                 └─── Final Transcript (Complete Turn)
                          │
                          ├─→ Emotion Analysis (GPT-4)
                          │    • 6 Basic Emotions (FACS)
                          │    • Intensity Multiplier
                          │
                          ├─→ Counselor State Calculation
                          │    • Base (user settings)
                          │    • Context Multiplier (LLM)
                          │    • finalIntensity = base × multiplier
                          │
                          ├─→ Full Response
                          │    • FACS-based facial expression
                          │    • 3-5s duration
                          │
                          └─→ Counselor Response (GPT-4)
                               └─→ TTS + Lip Sync
```

## ✨ Key Features

### 1. Dual Expression System

#### Micro Response (Listening Signal)

- **Purpose**: Convey "I'm listening" during user speech
- **Duration**: 0.5-0.8 seconds
- **Triggers**: Chunk-based sentiment analysis (positive/negative/neutral)
- **Expressions**:
  - Head nodding
  - Eyebrow movements
  - Slight smile or concern
- **Parameters**: Uses `baseIntensity` and `baseFrequency` directly

#### Full Response (Empathic Expression)

- **Purpose**: Clear empathetic expression during counselor turns
- **Duration**: During counselor turns
- **Triggers**: Turn completion + FACS-based emotion analysis
- **Expressions**: 6 basic emotions (joy, sadness, anger, fear, surprise, disgust) + neutral
- **Modulation**: `finalIntensity = baseIntensity × intensityMultiplier`

### 2. Counselor State Calculation

#### Base Values (User Settings)

- `baseIntensity` (0.3-1.2): Expression strength (5 discrete levels)

  - 0.3: Very Subtle
  - 0.5: Subtle
  - 0.75: Moderate (default)
  - 1.0: Expressive
  - 1.2: Very Expressive

- `baseFrequency` (0.2-1.0): Micro Response frequency (5 discrete levels)

  - 0.2: Minimal
  - 0.4: Occasional
  - 0.6: Moderate (default)
  - 0.8: Frequent
  - 1.0: Very Frequent

#### Context Multiplier (Dynamic)

- `intensityMultiplier` (0.85-1.15): LLM evaluates emotional significance
  - 0.85-0.90: Light conversation (attenuate slightly)
  - 0.95-1.00: Normal emotional expression
  - 1.05-1.10: Significant emotional moment
  - 1.15: Strong emotional peak

#### Final Calculation

- **Micro Response**: Uses base values directly
- **Full Response**: `finalIntensity = baseIntensity × intensityMultiplier`
  - Range: 0.255 (0.3 × 0.85) ~ 1.38 (1.2 × 1.15)
  - Lower bound clamped at 0

### 3. FACS-based Emotion Mapping

Based on Ekman & Friesen (1978) Facial Action Coding System:

| Emotion  | Action Units   | ARKit Blendshapes             |
| -------- | -------------- | ----------------------------- |
| Joy      | AU6, AU12      | cheekSquint, mouthSmile       |
| Sadness  | AU1, AU4, AU15 | browInnerUp, mouthFrown       |
| Anger    | AU4, AU5, AU7  | browDown, eyesSquint          |
| Fear     | AU1, AU2, AU5  | browInnerUp, eyeWide          |
| Surprise | AU1, AU2, AU5  | browInnerUp, eyeWide, jawOpen |
| Disgust  | AU9, AU15      | noseSneer, mouthFrown         |

+) Add additional blenshape activation for natural facial expression

### 4. Customization System

Users can adjust avatar behavior through a **5-level button interface**:

1. **Expression Intensity** (0.3-1.2)

   - Controls strength of both Micro and Full responses
   - Visual feedback with numbered indicators (1-5)
   - Default: Level 3 (Moderate, 0.75)

2. **Response Frequency** (0.2-1.0)
   - Controls how often Micro Responses trigger
   - Full Responses always triggered (not affected)
   - Default: Level 3 (Moderate, 0.6)

**Implementation Details**:

- Settings stored in `localStorage` for persistence
- Real-time updates without page reload
- Reset to defaults available
- Button-based UI (replaced sliders for clearer UX)

---

## 🛠️ Tech Stack

### Frontend

- **3D Rendering**: Three.js (r160)
- **Avatar**: Ready Player Me (72 ARKit blendshapes)
- **Speech Recognition**: Web Speech API
- **TTS**: OpenAI TTS API
- **Module System**: ES6 Modules

### Backend

- **Server**: Express.js 5.x
- **LLM**:
  - Development: Google Gemini 2.5 Flash
  - Production: OpenAI GPT-4
- **Runtime**: Node.js 20.x

## 🗓️ Development Roadmap

### ✅ Phase 1: Basic Prototype (Completed)

**Achievements**:

- [x] 3D Avatar System (Three.js + Ready Player Me)
- [x] Speech Recognition (Web Speech API, Korean/English)
- [x] LLM Integration (Gemini 2.5 Flash)
- [x] Basic TTS & Lip Sync
- [x] Simple emotion-to-blendshape mapping (demo purpose)
- [x] Web-based interface

**Deliverables**: Working prototype with basic facial expressions

### ✅ Phase 2: Core System Implementation (Completed)

**Objectives**: Implement full system design from interim report

#### Phase 2-1: FACS-based Emotion Mapping

- [x] Research FACS Action Units for 6 basic emotions
- [x] Map Action Units to ARKit blendshapes
- [x] Implement `EMOTION_CONFIGS` with base/scale parameters
- [x] Refactored to direct value multiplication (simplified)
- [x] Test and calibrate expressions at multiple intensities
- [x] Validate naturalness across 0.3-1.2 range

#### Phase 2-2: Emotional State Tracking System

- [x] Implement `APIManager` class (refactored from EmotionalStateTracker)
  - [x] Sentiment analysis for interim transcripts
  - [x] Full emotion analysis for final transcripts
  - [x] Counselor response generation with emotion
  - [x] TTS generation integration
- [x] Conversation history management (10 messages)
- [x] Rate limiting and debouncing (400ms minimum gap)

#### Phase 2-3: Dual Expression System

**Micro Response:**

- [x] Implement `MicroResponseController` class
- [x] Sentiment-based expression triggers (positive/negative/neutral)
- [x] Head nodding with probabilistic triggering (90% chance)
- [x] Asymmetric nod pattern (-2° to 8°, smoothstep interpolation)
- [x] Variable nod speed based on sentiment
- [x] Smooth fade-out when interrupted
- [x] Apply user-customized intensity and frequency

**Full Response:**

- [x] Update `AvatarController.setEmotion()` for simplified calculation
- [x] Context Multiplier (0.85-1.15) integration
- [x] FACS-based expression with natural variation (sine wave ±10%)
- [x] Fade-in animation (1 second) for smooth onset
- [x] Expression fluctuation during TTS playback
- [x] Graceful fade-to-neutral on completion

**Idle Animations:**

- [x] `IdleAnimationController` for natural behaviors
- [x] Realistic eye blink (3-5s intervals, 150ms duration)
- [x] Eye look-around movements (8 directions, weighted center)
- [x] Subtle head sway (0.5° amplitude, 3s period)
- [x] Pause during active expressions

#### Phase 2-4: Customization System

- [x] 5-level button interface (replaced sliders)
- [x] Visual indicators with numbered circles
- [x] Real-time parameter updates
- [x] LocalStorage persistence
- [x] Reset to defaults functionality
- [x] Collapsible settings panel

#### Phase 2-5: Backend API Development

- [x] `POST /api/sentiment` (Chunk sentiment analysis)
- [x] `POST /api/generate-response-with-emotion` (Unified endpoint)
- [x] `POST /api/tts` (OpenAI TTS with language detection)
- [x] Conversation context management
- [x] Error handling with fallback responses

#### Phase 2-6: Integration & Testing

- [x] Full system integration in `main.js`
- [x] End-to-end conversation flow
- [x] TTS interruption handling
- [x] Expression conflict resolution (Micro → Full transition)
- [x] Status indicator UI (Listening/Thinking/Speaking)
- [x] Conversation history with interrupted message marking
- [x] Enhanced lip sync (syllable-based, with pauses)
- [x] Multi-language support (Korean/English)

**Key Improvements**:

- Simplified intensity calculation (removed base+scale, direct multiplication)
- User-centric range design (0.3-1.2 for intensity, 0.2-1.0 for frequency)
- Natural expression timing (fade-in, fluctuation, fade-out)
- Robust error handling and state management

**Deliverables**:

- Fully functional system with Dual Expression
- FACS-based facial expressions with proven naturalness
- User-customizable parameters (5 levels each)
- Production-ready codebase

### 🎯 Phase 3: User Study & Evaluation (Current)

**Objectives**: Experimental validation of system effectiveness

#### Phase 3-1: Experiment Design

- [ ] Define experimental conditions
- [ ] Prepare counseling scenarios
- [ ] Design questionnaires (empathy perception, satisfaction, trust)

#### Phase 3-2: User Recruitment & Study

- [ ] Recruit 10 participants
- [ ] Conduct counseling sessions
- [ ] Collect quantitative & qualitative data
- [ ] Post-session interviews

#### Phase 3-3: Data Analysis

#### Phase 3-4: Final Report

**Deliverables**:

- Research paper
- User study results
- Final thesis

---

## 📦 Installation

### Prerequisites

```bash
Python 3.x
node >= 18.0.0
npm >= 9.0.0
```

### Setup

1. **Clone Repository**

```bash
git clone https://github.com/dommanga/AvatarCounselor.git
cd AvatarCounselor
```

2. **Install Dependencies**

```bash
npm install
```

3. **Environment Configuration**

Create `.env` file:
echo "PORT=3000" >> .env

```env
# Current (Development)
GEMINI_API_KEY=your_gemini_api_key_here

# Phase 2 (Production)
OPENAI_API_KEY=your_openai_api_key_here
```

4. **Start backend server (Terminal 1)**

```bash
npm run dev
```

5. **Start frontend server (Terminal 2)**

```bash
python -m http.server 8000
```

6. **Open Browser**

```
http://localhost:8000
```

## 📁 Project Structure

```
AvatarCounselor/
├── index.html                 # Main entry point
├── src/
│   ├── main.js               # Core integration & orchestration
│   ├── avatar.js             # AvatarController (72 blendshapes, FACS-based)
│   ├── speech.js             # SpeechRecognitionManager (Web Speech API)
│   ├── emotions.js           # FACS emotion configs (Ekman & Friesen)
│   ├── APIManager.js         # Backend API communication (Phase 2)
│   ├── microResponse.js      # MicroResponseController with head nodding
│   ├── IdleAnimation.js      # Natural idle behaviors (blink, sway, look)
│   ├── customization.js      # Settings manager (0.3-1.2 range)
│   ├── ui.js                 # UI with 5-level button interface
│   ├── tts.js                # OpenAI TTS integration
│   └── lipSync.js            # Enhanced syllable-based lip sync
├── assets/
│   └── avatar_torso.glb      # Ready Player Me avatar (ARKit blendshapes)
├── server.js                 # Express API (GPT-4, OpenAI TTS)
├── package.json
├── .env                      # API keys (OPENAI_API_KEY)
├── .gitignore
└── README.md
```

## 🐛 Common Issues

**"Module not found" error**
→ Hard refresh: `Ctrl + Shift + R`

**"API key not valid"**
→ Check `.env` file, restart backend server

**No microphone input**
→ Use Chrome, check browser permissions

**Avatar doesn't load**
→ Verify Python server running on port 8000

---

**Last Updated**: Nov 24, 2025

# AI Avatar Counselor

> **Effects of Non-verbal Empathy Expressions by AI Avatar Counselors on Client Responses**
>
> POSTECH CSE Undergraduate Research Project (2025 Fall)

---

## 📋 Table of Contents

- [Overview](#overview)
- [Research Background](#research-background)
- [System Architecture](#system-architecture)
- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [Development Roadmap](#development-roadmap)
- [Installation](#installation)
- [Usage](#usage)
- [Project Structure](#project-structure)
- [References](#references)

---

## 🎯 Overview

This project implements an **AI Avatar Counselor** system that generates real-time non-verbal empathy expressions based on users' speech. The research aims to verify the effects of automated AI avatars' non-verbal empathy expressions on client responses and explore effective empathy strategies.

### Research Objectives

1. **Automated Non-verbal Empathy**: Generate avatar facial expressions automatically from user speech
2. **Dual Expression System**: Implement both Micro Response (listening signals) and Full Response (empathic expressions)
3. **Personalized Customization**: Provide user-adjustable intensity and frequency parameters
4. **Experimental Validation**: Verify effectiveness through user studies

---

## 🔬 Research Background

### Key Findings from Literature

- **Empathy in Counseling**: Therapist empathy positively impacts client outcomes (Elliott et al., 2018)
- **Non-verbal Communication**: Virtual healthcare professionals' gaze, facial expressions, and body lean significantly enhance empathy perception (Marcoux et al., 2023)
- **Research Gap**: While Choi et al. (2024) demonstrated effectiveness of non-verbal empathy in AI counselors using Wizard-of-Oz methodology, **automated real-time systems remain unvalidated**

### Needfinding Study Results

**Participants:** 3 university students (20s)

**Key Insights:**

1. **Non-verbal Expression Importance**: Text-based AI counseling limited by lack of facial expressions
2. **Individual Differences**: Strong preferences for timing and intensity of reactions
3. **Listening Signals**: Need for continuous listening cues without interrupting conversation flow

---

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
                 │         │             • Slight smile
                 │         │             (0.5-0.8s duration)
                 │
                 └─── Final Transcript (Complete Turn)
                          │
                          ├─→ Emotion Analysis (LLM)
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

---

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
- **Duration**: 3-5 seconds
- **Triggers**: Turn completion + FACS-based emotion analysis
- **Expressions**: 6 basic emotions (joy, sadness, anger, fear, surprise, disgust)
- **Modulation**: `finalIntensity = baseIntensity × intensityMultiplier`

### 2. Emotional State Tracking

- **Real-time Monitoring**: Tracks user emotional states throughout conversation
- **History Management**: Maintains recent 3-5 emotional states
- **Trend Analysis**: Identifies dominant emotional trends

### 3. Counselor State Calculation

#### Base Values (User Settings)

- `baseIntensity` (0.0-1.0): Strength of facial expressions and gestures
- `baseFrequency` (0.0-1.0): Frequency of Micro Response

#### Context Multiplier (Dynamic)

- `intensityMultiplier` (0.5-1.5): LLM evaluates emotional significance
  - 0.5-0.7: Casual conversation (attenuate)
  - 0.8-1.0: Normal emotional expression
  - 1.1-1.5: Crisis moment (amplify)

#### Final Calculation

- **Micro Response**: Base values used directly
- **Full Response**: `finalIntensity = baseIntensity × intensityMultiplier`

### 4. FACS-based Emotion Mapping

Based on Ekman & Friesen (1978) Facial Action Coding System:

| Emotion  | Action Units   | ARKit Blendshapes             |
| -------- | -------------- | ----------------------------- |
| Joy      | AU6, AU12      | cheekSquint, mouthSmile       |
| Sadness  | AU1, AU4, AU15 | browInnerUp, mouthFrown       |
| Anger    | AU4, AU5, AU7  | browDown, eyesSquint          |
| Fear     | AU1, AU2, AU5  | browInnerUp, eyeWide          |
| Surprise | AU1, AU2, AU5  | browInnerUp, eyeWide, jawOpen |
| Disgust  | AU9, AU15      | noseSneer, mouthFrown         |

### 5. Customization System

Users can adjust two parameters via sliders:

1. **Base Intensity**: Expression strength (applies to both Micro and Full)
2. **Base Frequency**: Micro Response frequency (Full Response always triggered)

Settings saved in `localStorage` for persistence across sessions.

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
- **Runtime**: Node.js 18.x

### Development

- **Version Control**: Git/GitHub
- **Package Manager**: npm
- **Environment**: `.env` for API keys

---

## 🗓️ Development Roadmap

### ✅ Phase 1: Basic Prototype (Completed)

**Timeline**: ~2024.12

**Achievements**:

- [x] 3D Avatar System (Three.js + Ready Player Me)
- [x] Speech Recognition (Web Speech API, Korean/English)
- [x] LLM Integration (Gemini 2.5 Flash)
- [x] Basic TTS & Lip Sync
- [x] Simple emotion-to-blendshape mapping (demo purpose)
- [x] Web-based interface

**Deliverables**: Working prototype with basic facial expressions

---

### 🔄 Phase 2: Core System Implementation (Current)

**Timeline**: ~2025.01

**Objectives**: Implement full system design from interim report

#### Phase 2-1: FACS-based Emotion Mapping

- [ ] Research FACS Action Units for 6 basic emotions
- [ ] Map Action Units to ARKit blendshapes
- [ ] Implement `EMOTION_CONFIGS` in `emotions.js`
- [ ] Test and calibrate with Ready Player Me avatar
- [ ] Validate naturalness of expressions

#### Phase 2-2: Emotional State Tracking System

- [ ] Implement `EmotionalStateTracker` class
  - [ ] Real-time sentiment analysis (interim)
  - [ ] Full emotion analysis (final)
  - [ ] Emotion history management (3-5 states)
  - [ ] Dominant trend calculation
- [ ] Integrate with LLM APIs
- [ ] Add debouncing for interim analysis

#### Phase 2-3: Dual Expression System

**Micro Response:**

- [ ] Implement `MicroResponseController` class
- [ ] Sentiment-based expression triggers
- [ ] Head nod, eyebrow, smile animations
- [ ] 0.5-0.8s duration control
- [ ] Apply `baseIntensity` and `baseFrequency`

**Full Response:**

- [ ] Update `AvatarController.setEmotion()` method
- [ ] Implement Context Multiplier application
- [ ] FACS-based expression generation
- [ ] 3-5s duration with smooth transitions
- [ ] Integrate with TTS timing

#### Phase 2-4: Customization System

- [ ] Implement user settings management
- [ ] Create UI sliders (Base Intensity/Frequency)
- [ ] LocalStorage integration
- [ ] Real-time parameter updates
- [ ] Default value configuration

#### Phase 2-5: Backend API Development

- [ ] `POST /api/sentiment` (Chunk analysis)
- [ ] `POST /api/analyze-full` (Full emotion + multiplier)
- [ ] `POST /api/generate-response` (Counselor response)
- [ ] Implement conversation history management
- [ ] Error handling & rate limiting

#### Phase 2-6: Integration & Testing

- [ ] Integrate all modules in `main.js`
- [ ] End-to-end flow testing
- [ ] Latency optimization (<1s for Micro)
- [ ] Expression naturalness validation
- [ ] Conversation quality testing

**Deliverables**:

- Fully functional system with Dual Expression
- FACS-based facial expressions
- Customizable user parameters
- Production-ready codebase

---

### 🎯 Phase 3: User Study & Evaluation (Planned)

**Timeline**: ~2025.02

**Objectives**: Experimental validation of system effectiveness

#### Phase 3-1: Experiment Design

- [ ] Define experimental conditions
- [ ] Prepare counseling scenarios
- [ ] Design questionnaires (empathy perception, satisfaction, trust)
- [ ] IRB approval

#### Phase 3-2: User Recruitment & Study

- [ ] Recruit 20-30 participants
- [ ] Conduct counseling sessions
- [ ] Collect quantitative & qualitative data
- [ ] Post-session interviews

#### Phase 3-3: Data Analysis

- [ ] Statistical analysis (ANOVA, regression)
- [ ] Qualitative coding (thematic analysis)
- [ ] Compare across experimental conditions

#### Phase 3-4: Final Report

- [ ] Results interpretation
- [ ] Discussion & implications
- [ ] Limitations & future work
- [ ] Final thesis submission

**Deliverables**:

- Research paper
- User study results
- Final thesis

---

## 📦 Installation

### Prerequisites

```bash
node >= 20.0.0
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

```env
# Current (Development)
GEMINI_API_KEY=your_gemini_api_key_here

# Phase 2 (Production)
OPENAI_API_KEY=your_openai_api_key_here
```

4. **Start Development Server**

```bash
npm run dev
```

5. **Open Browser**

```
http://localhost:3000
```

---

## 🎮 Usage

### Basic Interaction

1. **Start Conversation**

   - Click "Start Listening" button
   - Speak naturally in Korean or English

2. **Observe Avatar**

   - **During Speech**: Subtle listening signals (Micro Response)
   - **After Speech**: Clear empathetic expression (Full Response)
   - **Counselor Turn**: Vocal response with lip sync

3. **Adjust Settings** (Phase 2)
   - Open Customization panel
   - Adjust "Base Intensity" slider (expression strength)
   - Adjust "Base Frequency" slider (listening signal frequency)

### Example Conversation Flow

```
User: "I've been feeling really stressed lately..."
      └→ Micro Response: Concerned eyebrow raise + head nod

User: [Finishes speaking]
      └→ Full Response: Sadness expression (AU1+AU4+AU15)
      └→ TTS: "I understand how difficult that must be..."
```

---

## 📁 Project Structure

```
AvatarCounselor/
├── index.html                 # Main entry point
├── src/
│   ├── main.js               # Core integration & orchestration
│   ├── avatar.js             # AvatarController (72 blendshapes)
│   ├── speech.js             # SpeechRecognitionManager (Web Speech API)
│   ├── emotions.js           # FACS-based emotion configs
│   ├── emotionalState.js     # EmotionalStateTracker (NEW - Phase 2)
│   ├── microResponse.js      # MicroResponseController (NEW - Phase 2)
│   ├── customization.js      # CustomizationManager (NEW - Phase 2)
│   ├── ui.js                 # UI management
│   ├── api.js                # Backend API communication
│   ├── tts.js                # TTS manager (OpenAI TTS)
│   └── lipSync.js            # Amplitude-based lip sync
├── assets/
│   └── avatar_torso.glb      # Ready Player Me avatar
├── server.js                 # Express API server
├── package.json
├── .env                      # API keys (not in repo)
├── .gitignore
└── README.md
```

### Key Modules (Phase 2)

#### `emotionalState.js`

```javascript
export class EmotionalStateTracker {
    updateFromInterim(chunk)       // Sentiment for Micro
    updateFromFinal(text, llmData) // Full emotion analysis
    getState()                      // Current + history + trend
}
```

#### `microResponse.js`

```javascript
export class MicroResponseController {
    trigger(sentiment)              // Generate listening signal
    showConcern()                   // Eyebrow raise
    showInterest()                  // Slight smile
    headNod()                       // Subtle nod
}
```

#### `customization.js`

```javascript
export class CustomizationManager {
    getSettings()                   // { baseIntensity, baseFrequency }
    updateSettings(settings)        // Save to localStorage
    applyDefaults()                 // Load defaults
}
```

#### `emotions.js` (FACS-based)

```javascript
export const EMOTION_CONFIGS = {
  joy: {
    actionUnits: [6, 12],
    blendshapes: {
      /* AU → ARKit mapping */
    },
    duration: 3.5,
    reference: "Ekman & Friesen (1978)",
  },
  // ... sadness, anger, fear, surprise, disgust
};
```

---

## 🔬 References

### Academic Papers

- **Elliott, R., Bohart, A. C., Watson, J. C., & Murphy, D. (2018).** Therapist empathy and client outcome: An updated meta-analysis. _Psychotherapy, 55_(4), 399–410. https://doi.org/10.1037/pst0000175

- **Marcoux, A., Tessier, M.-H., & Jackson, P. L. (2023).** Nonverbal markers of empathy in virtual healthcare professionals. In _Proceedings of the 23rd ACM International Conference on Intelligent Virtual Agents (IVA '23)_, Article 43, 1–4. https://doi.org/10.1145/3570945.3607291

- **Choi, D. S., Park, J., Loeser, M., & Seo, K. (2024).** Improving counseling effectiveness with virtual counselors through nonverbal compassion involving eye contact, facial mimicry, and head-nodding. _Scientific Reports, 14_, 506. https://doi.org/10.1038/s41598-023-51115-y

- **Ekman, P., & Friesen, W. V. (1978).** _Facial Action Coding System: A technique for the measurement of facial movement._ Consulting Psychologists Press.

- **Rogers, C. R. (1951).** _Client-centered therapy: Its current practice, implications, and theory._ Houghton Mifflin.

### Technical Documentation

- [Three.js Documentation](https://threejs.org/docs/)
- [Ready Player Me Developer Docs](https://docs.readyplayer.me/)
- [ARKit Blendshapes Reference](https://developer.apple.com/documentation/arkit/arfaceanchor/blendshapelocation)
- [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)
- [OpenAI API Documentation](https://platform.openai.com/docs)

---

## 👤 Author

**Jimin Lee**

- Student ID: 20210212
- Institution: POSTECH Computer Science and Engineering
- Advisor: Prof. Eunkyoung Cho
- Email: [Your Email]
- GitHub: [@dommanga](https://github.com/dommanga)

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- **POSTECH HCI Lab** for research support and guidance
- **Ready Player Me** for avatar technology
- **OpenAI** for GPT-4 and TTS API
- **Google** for Gemini API (development phase)

---

## 📊 Project Status

**Current Phase**: Phase 2 - Core System Implementation  
**Progress**: FACS Mapping & Dual Expression System in progress  
**Target Completion**: January 2025  
**Next Milestone**: User Study (Phase 3)

---

**Last Updated**: December 2024

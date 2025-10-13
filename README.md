# AI Avatar Counselor 🤖

**Research Project**: Effects of Non-verbal Empathy Expressions by AI Avatar Counselors on Client Responses

POSTECH CSE Undergraduate Thesis Project

## 📋 Project Overview

AI avatar counselor system that combines speech recognition, LLM-based emotion analysis, and real-time 3D facial expressions to create an interactive empathetic counseling experience.

## 🚀 Quick Start

### Prerequisites

- Python 3.x
- Node.js 18+
- Chrome browser
- Google Gemini API Key

### Installation

```bash
# 1. Install backend dependencies
npm install

# 2. Create .env file
echo "GEMINI_API_KEY=your-api-key-here" > .env
echo "PORT=3000" >> .env

# 3. Start backend server (Terminal 1)
npm run dev

# 4. Start frontend server (Terminal 2)
python -m http.server 8000

# 5. Open browser
# http://localhost:8000
```

## 📁 File Structure

```
AvatarCounselor/
├── index.html              # Main entry point
├── src/
│   ├── main.js            # Core integration
│   ├── avatar.js          # Facial expression control
│   ├── speech.js          # Web Speech API (ASR)
│   ├── ui.js              # UI management
│   ├── api.js             # Backend API communication
│   └── emotions.js        # Emotion → Blendshape mappings
├── assets/
│   └── avatar_torso.glb   # 3D avatar model
├── server.js              # Express API server
├── package.json
├── .env
└── .gitignore
```

## 📊 Technology Stack

### Frontend

- **3D Graphics**: Three.js (r160)
- **Speech Recognition**: Web Speech API
- **Module System**: ES6 Modules

### Backend

- **Server**: Express.js 5.x
- **LLM**: Google Gemini 2.5 Flash
- **Runtime**: Node.js 20.x

### 3D Assets

- **Model**: Ready Player Me (GLB)
- **Morph Targets**: 72 ARKit blendshapes

## 🔑 API Configuration

### Gemini API

- **Model**: `gemini-2.5-flash-latest`
- **Free Tier**: 1,500 requests/day, 15 requests/minute
- **Response Format**: `{emotion, intensity, response}`

### Environment Variables

```env
GEMINI_API_KEY=your-gemini-api-key
PORT=3000
```

## 🎯 Development Roadmap

### Phase 1: Core System

**Phase 1-1: 3D Avatar System**

- [x] Three.js scene setup with avatar rendering
- [x] 72 ARKit blendshape control system
- [x] Smooth emotion transitions with interpolation

**Phase 1-2: Speech Recognition**

- [x] Web Speech API integration (Korean/English)
- [x] Real-time transcript display
- [x] Conversation history logging

**Phase 1-3: LLM Integration**

- [x] Google Gemini 2.5 Flash API setup
- [x] Backend Express server with `/api/analyze-emotion` endpoint
- [x] Real-time emotion classification (joy, sadness, anger, fear, surprise, disgust, neutral)
- [x] Empathetic response generation
- [x] Avatar expression update based on emotion analysis

**Phase 1-4: Text-to-Speech (TTS)**

- [ ] Option A: Web Speech API `speechSynthesis` (quick prototype)
- [ ] Option B: Google Cloud TTS API (better quality + viseme data)
- [ ] Audio playback integration
- [ ] Speaking state indicator

### Phase 2: Enhancement

**Phase 2-1: Refined Emotion Mappings**

- [ ] Review and improve current `EMOTION_MAPPINGS` in `emotions.js`
- [ ] Add granular blendshape control (eyebrow positions, mouth shapes)
- [ ] Implement intensity scaling (0.0 - 1.0) for each blendshape
- [ ] Test mapping accuracy with sample expressions

**Phase 2-2: Basic Lip Sync**

- [ ] Audio amplitude → jawOpen blendshape mapping
- [ ] Real-time mouth movement during TTS
- [ ] Future: Viseme-based phoneme sync (if using Azure/Google TTS)

### Phase 3: Research Features (Not fixed - In the wild vs. In lab)

**Data Collection**

- [ ] Conversation logging system (timestamp, emotion, intensity, response)
- [ ] Export data to CSV/JSON for analysis
- [ ] Session ID tracking

**Metrics & Analysis**

- [ ] Response time measurement (speech → emotion → avatar update)
- [ ] Emotion classification accuracy validation
- [ ] User engagement metrics

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

**Last Updated**: October 14, 2025  
**Current Phase**: Phase 1-3 Complete → Moving to Phase 1-4 (TTS)

```

```

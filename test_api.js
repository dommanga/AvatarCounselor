#!/usr/bin/env node

/**
 * API Test Script for Phase 2 Backend
 * Tests all three endpoints with sample data
 */

const BASE_URL = "http://localhost:3000";

// ANSI color codes
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
};

function log(color, message) {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testEndpoint(name, endpoint, body) {
  log("cyan", `\n${"=".repeat(60)}`);
  log("blue", `Testing: ${name}`);
  log("cyan", "=".repeat(60));

  try {
    const startTime = Date.now();

    const response = await fetch(`${BASE_URL}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const endTime = Date.now();
    const data = await response.json();

    if (response.ok) {
      log("green", `✅ Success (${endTime - startTime}ms)`);
      console.log(JSON.stringify(data, null, 2));
    } else {
      log("red", `❌ Error: ${response.status}`);
      console.log(JSON.stringify(data, null, 2));
    }
  } catch (error) {
    log("red", `❌ Request failed: ${error.message}`);
  }
}

async function runTests() {
  log("yellow", "\n🧪 AI Avatar Counselor API - Phase 2 Tests\n");

  // Test 1: Health Check
  try {
    log("blue", "Testing: Health Check");
    const response = await fetch(`${BASE_URL}/health`);
    const data = await response.json();
    log("green", "✅ Server is running");
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    log("red", "❌ Server is not running!");
    log("yellow", "Please start the server with: npm run dev");
    process.exit(1);
  }

  // Test 2: Sentiment Analysis (Micro Response)
  await testEndpoint("Sentiment Analysis (Positive)", "/api/sentiment", {
    chunk: "I'm so happy to see you today!",
  });

  await testEndpoint("Sentiment Analysis (Negative)", "/api/sentiment", {
    chunk: "I'm feeling really sad and overwhelmed...",
  });

  await testEndpoint("Sentiment Analysis (Neutral)", "/api/sentiment", {
    chunk: "The meeting is scheduled for tomorrow.",
  });

  // Test 3: Full Emotion Analysis
  await testEndpoint("Full Emotion Analysis (Happy)", "/api/analyze-full", {
    message: "I just got accepted to my dream university! I can't believe it!",
    history: [],
  });

  await testEndpoint("Full Emotion Analysis (Sad)", "/api/analyze-full", {
    message: "I lost my job today and I don't know what to do...",
    history: [
      { speaker: "user", text: "I've been feeling anxious lately." },
      { speaker: "counselor", text: "Can you tell me more about that?" },
    ],
  });

  await testEndpoint("Full Emotion Analysis (Angry)", "/api/analyze-full", {
    message: "I'm so frustrated! Nothing is going right!",
    history: [],
  });

  await testEndpoint("Full Emotion Analysis (Fear)", "/api/analyze-full", {
    message: "I'm really scared about the surgery tomorrow...",
    history: [],
  });

  // Test 4: Generate Counselor Response
  await testEndpoint("Counselor Response (English)", "/api/generate-response", {
    message: "I'm feeling really overwhelmed with work.",
    conversationHistory: [],
    emotionHistory: [{ emotion: "sadness", intensity: 0.7 }],
  });

  await testEndpoint("Counselor Response (Korean)", "/api/generate-response", {
    message: "요즘 너무 힘들어요. 아무것도 하기 싫어요.",
    conversationHistory: [
      { speaker: "user", text: "안녕하세요." },
      { speaker: "counselor", text: "안녕하세요. 무슨 일이 있으신가요?" },
    ],
    emotionHistory: [
      { emotion: "sadness", intensity: 0.8 },
      { emotion: "fear", intensity: 0.3 },
    ],
  });

  // Test 5: Legacy Endpoint (Phase 1 compatibility)
  await testEndpoint("Legacy Endpoint", "/api/analyze-emotion", {
    transcript: "I'm having a great day!",
  });

  log("yellow", "\n" + "=".repeat(60));
  log("green", "✅ All tests completed!");
  log("yellow", "=".repeat(60) + "\n");
}

// Run tests
runTests().catch((error) => {
  log("red", `\n❌ Test suite failed: ${error.message}\n`);
  process.exit(1);
});

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { AvatarController } from "./avatar.js";
import { SpeechRecognitionManager } from "./speech.js";
import { UIController } from "./ui.js";
import { TTSManager } from "./tts.js";
import { LipSyncController } from "./lipSync.js";
import { EmotionalStateTracker } from "./emotionalState.js";
import { MicroResponseController } from "./microResponse.js";
import { IdleAnimationController } from "./IdleAnimation.js";
import { CustomizationManager } from "./customization.js";

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf0f0f0);

// Camera
const camera = new THREE.PerspectiveCamera(
  30,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(0, 0.65, 1);

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.getElementById("canvas-container").appendChild(renderer.domElement);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.6, 0);
controls.update();

// Disable user control with scene
controls.enableRotate = false;
controls.enableZoom = false;
controls.enablePan = false;

// Lights
const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
directionalLight.position.set(5, 10, 5);
directionalLight.castShadow = true;
scene.add(directionalLight);

// Ground
const groundGeometry = new THREE.PlaneGeometry(10, 10);
const groundMaterial = new THREE.MeshStandardMaterial({ color: 0xcccccc });
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Initialize customization manager
const customizationManager = new CustomizationManager();

// Initialize emotion analyzer
const stateTracker = new EmotionalStateTracker();

// Avatar and Speech Recognition managers
const avatarController = new AvatarController();
let speechManager = null;
let uiController = null;

// TTS and Lip Sync managers
let ttsManager = null;
let lipSyncController = null;

// Micro Response controller
let microResponseController = null;

// Expression fluctuation interval
let expressionInterval = null;
let currentCounselorEmotion = null;
let currentFinalIntensity = 0;

// Idle Animation controller
let idleAnimationController = null;

// Load avatar
const loader = new GLTFLoader();

loader.load(
  "./assets/avatar_torso.glb", // GLB File
  (gltf) => {
    const avatar = gltf.scene;
    scene.add(avatar);
    avatarController.init(avatar);
    console.log("✅ Avatar loaded successfully!");

    // Initialize Eye Movement
    idleAnimationController = new IdleAnimationController(avatarController);
    idleAnimationController.start();
    console.log("✅ Eye movements started!");

    // Initialize speech recognition after avatar loads
    initializeSpeechRecognition();
  },
  (progress) => {
    console.log(
      "Loading:",
      ((progress.loaded / progress.total) * 100).toFixed(0) + "%"
    );
  },
  (error) => {
    console.error("❌ Error loading avatar:", error);
  }
);

// Initialize speech recognition system
function initializeSpeechRecognition() {
  console.log("🎤 Initializing speech recognition...");

  // Create UI
  uiController = new UIController();

  // Create speech manager
  speechManager = new SpeechRecognitionManager();

  if (!speechManager.supported) {
    alert(
      "Speech recognition is not supported in this browser. Please use Chrome."
    );
    return;
  }

  // Initialize TTS and Lip Sync
  initializeTTS();

  // Initialize Micro Response controller with current settings
  const currentSettings = customizationManager.getSettings();
  microResponseController = new MicroResponseController(avatarController, {
    baseIntensity: currentSettings.baseIntensity, // 0.0-2.0
    baseFrequency: currentSettings.baseFrequency, // 0.0-1.0
  });
  console.log("✅ Micro response controller initialized!");

  // ===== CUSTOMIZATION UI SETUP =====

  // Initialize UI with current settings
  uiController.updateIntensityValue(currentSettings.baseIntensity);
  uiController.updateFrequencyValue(currentSettings.baseFrequency);

  // Connect intensity slider
  uiController.intensitySlider.addEventListener("input", (e) => {
    const value = parseInt(e.target.value) / 100;
    customizationManager.setBaseIntensity(value);
    uiController.updateIntensityValue(value);
  });

  // Connect frequency slider
  uiController.frequencySlider.addEventListener("input", (e) => {
    const value = parseInt(e.target.value) / 100;
    customizationManager.setBaseFrequency(value);
    uiController.updateFrequencyValue(value);
  });

  // Connect reset button
  uiController.resetButton.addEventListener("click", () => {
    customizationManager.resetToDefaults();
    const settings = customizationManager.getSettings();
    uiController.updateIntensityValue(settings.baseIntensity);
    uiController.updateFrequencyValue(settings.baseFrequency);
  });

  // Listen to customization changes and update micro response controller
  customizationManager.addListener((settingName, newValue) => {
    if (microResponseController) {
      const updatedSettings = customizationManager.getActualSettings();
      microResponseController.updateCustomization(updatedSettings);
      console.log(
        `🔄 Updated MicroResponse: ${settingName} = ${updatedSettings.baseIntensity.toFixed(
          2
        )}`
      );
    }
  });

  // Set up callbacks
  speechManager.onTranscriptUpdate = async (finalText, interimText) => {
    uiController.updateTranscript(finalText, interimText);

    // CRITICAL: If detect Interim -> immediately stop TTS
    if (interimText && interimText.trim().length > 0) {
      if (ttsManager && ttsManager.isSpeaking) {
        console.log(
          "🎤 User started speaking (interim detected), stopping TTS"
        );
        ttsManager.stop();

        // Mark last counselor message as interrupted
        if (uiController) {
          uiController.markLastCounselorMessageAsInterrupted();
        }
      }

      if (idleAnimationController) {
        idleAnimationController.pauseHeadSway();
      }
    }

    // Micro Response
    if (interimText && interimText.length > 10) {
      const sentiment = await stateTracker.analyzeChunkSentiment(interimText);
      if (sentiment !== null) {
        console.log(`💡 Micro response trigger: ${sentiment}`);
        microResponseController.trigger(sentiment);
      }
    }
  };

  speechManager.onFinalTranscript = async (text) => {
    if (!text || text.trim().length === 0) {
      console.log("⏭️  Skipping empty transcript");
      return;
    }

    console.log("📝 Final transcript:", text);

    uiController.addToHistory(text);
    stateTracker.addToConversation("user", text);

    const responseData = await fetch(
      "http://localhost:3000/api/generate-response-with-emotion",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          conversationHistory: stateTracker.conversationHistory,
          emotionHistory: stateTracker.emotionHistory,
        }),
      }
    )
      .then((r) => r.json())
      .catch((e) => {
        console.error("❌ generate-response-with-emotion failed:", e);
        return {
          response: "",
          counselorEmotion: {
            dominantEmotion: "neutral",
            intensityMultiplier: 1.0,
          },
        };
      });

    const counselorText = responseData.response || "";
    const counselorEmotion = responseData.counselorEmotion || {
      dominantEmotion: "neutral",
      intensityMultiplier: 1.0,
    };

    if (!counselorText) {
      console.log("⏭️ Empty counselor text, skipping.");
      return;
    }

    // Store for conversation history
    stateTracker.addToConversation("counselor", counselorText);

    // Show UI immediately (better UX - don't wait for TTS)
    uiController.addCounselorMessage(counselorText);

    // ===== APPLY COUNSELOR EMOTION with CUSTOMIZATION =====
    const currentSettings = customizationManager.getActualSettings();
    currentCounselorEmotion = counselorEmotion.dominantEmotion;
    currentFinalIntensity =
      currentSettings.baseIntensity * counselorEmotion.intensityMultiplier;
    // const dom = analysis.dominantEmotion || "neutral";
    // const emoIntensity =
    //   analysis.emotions?.[dom] != null ? Number(analysis.emotions[dom]) : 0.5;

    // const finalIntensity =
    //   currentSettings.baseIntensity *
    //   Number(analysis.intensityMultiplier ?? 1.0);

    console.log(
      `🎭 Full Response: emotion=${currentCounselorEmotion}, baseIntensity=${currentSettings.baseIntensity.toFixed(
        2
      )}, multiplier=${
        counselorEmotion.intensityMultiplier
      }, finalIntensity=${currentFinalIntensity.toFixed(2)}`
    );

    // TTS start
    void speakResponse(counselorText).catch((err) =>
      console.warn("TTS play error:", err)
    );
  };

  speechManager.onError = (error) => {
    console.error("❌ Speech error:", error);
    if (error === "not-allowed") {
      alert("Microphone permission denied. Please allow microphone access.");
    }
  };

  speechManager.onStatusChange = (isListening) => {
    uiController.setListeningStatus(isListening);
  };

  // Connect UI buttons
  uiController.micButton.addEventListener("click", () => {
    speechManager.toggle();
  });

  uiController.clearButton.addEventListener("click", () => {
    uiController.clearHistory();
    speechManager.clearTranscript();
  });

  uiController.languageSelect.addEventListener("change", (e) => {
    speechManager.setLanguage(e.target.value);
  });

  console.log("✅ Speech recognition initialized!");
}

// Initialize TTS system
function initializeTTS() {
  console.log("🔊 Initializing TTS...");

  // Create TTS manager
  ttsManager = new TTSManager();

  // Create Lip Sync controller
  lipSyncController = new LipSyncController(avatarController);

  // Setup TTS callbacks
  ttsManager.onStart = async () => {
    console.log("🔊 TTS started");

    uiController.setSpeakingStatus(true);
    lipSyncController.start();

    if (idleAnimationController) {
      idleAnimationController.pauseHeadSway();
    }

    // Stop micro response immediately (no fade to prevent neutral flash)
    if (
      microResponseController?.isActive() ||
      microResponseController?.isNodding()
    ) {
      microResponseController.stopImmediate(); // Instant stop without fade
    }
    console.log("✅ Micro stopped, starting Full Response");

    if (currentCounselorEmotion && currentFinalIntensity > 0) {
      // Clear any existing interval
      if (expressionInterval) {
        clearInterval(expressionInterval);
      }

      // Sine wave based natural fluctuation with fade-in
      let time = 0;
      let fadeInProgress = 0; // 0 → 1 over fade-in duration
      const fadeInDuration = 1.0; // 1 second fade-in
      const fadeInSteps = (fadeInDuration * 1000) / 100; // number of steps

      expressionInterval = setInterval(() => {
        time += 0.1; // Smooth progression

        // Fade-in: gradually increase from 0 to 1
        if (fadeInProgress < 1) {
          fadeInProgress += 1 / fadeInSteps;
          fadeInProgress = Math.min(1, fadeInProgress);
        }

        // Sine wave: oscillates between -1 and 1
        const sineValue = Math.sin(time);

        // Map to subtle variation range (e.g., 0.9 ~ 1.1)
        const variation = 1.0 + sineValue * 0.1; // ±10% variation

        // Apply variation with fade-in multiplier
        avatarController.setEmotion(
          currentCounselorEmotion,
          currentFinalIntensity * variation * fadeInProgress
        );
      }, 100); // 10fps for smooth animation

      console.log(
        `🔄 Natural expression fluctuation started (sine wave with fade-in)`
      );
    }
  };

  ttsManager.onEnd = () => {
    console.log("🔇 TTS ended");
    uiController.setSpeakingStatus(false);
    lipSyncController.stop();

    // Expression fluctuation stop
    if (expressionInterval) {
      clearInterval(expressionInterval);
      expressionInterval = null;
      console.log("🔄 Expression fluctuation stopped");
    }

    if (idleAnimationController) {
      idleAnimationController.resumeHeadSway();
    }

    avatarController.fadeToNeutral(1.0);

    // Reset emotion state
    currentCounselorEmotion = null;
    currentFinalIntensity = 0;
  };

  ttsManager.onError = (error) => {
    console.error("❌ TTS error:", error);
    uiController.setSpeakingStatus(false);
    lipSyncController.stop();

    // Expression fluctuation stop
    if (expressionInterval) {
      clearInterval(expressionInterval);
      expressionInterval = null;
    }

    // Head sway
    if (idleAnimationController) {
      idleAnimationController.resumeHeadSway();
    }

    // interrupted -> fade
    avatarController.fadeToNeutral(0.3);

    if (error !== "interrupted") {
      currentCounselorEmotion = null;
      currentFinalIntensity = 0;
    } else {
      console.log("ℹ️ TTS was interrupted by user (this is normal)");
    }
  };

  // Connect stop TTS button
  if (uiController.stopTTSButton) {
    uiController.stopTTSButton.addEventListener("click", () => {
      ttsManager.stop();
    });
  }

  console.log("✅ TTS initialized!");
}

// Speak counselor response with TTS
async function speakResponse(text) {
  if (!ttsManager || !text || text.trim().length === 0) {
    return;
  }

  try {
    // Detect language (simple heuristic)
    const hasKorean = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(text);
    const language = hasKorean ? "ko-KR" : "en-US";

    console.log(`🔊 Speaking in ${language}:`, text.substring(0, 50) + "...");

    // Speak with TTS (callbacks handle UI and lip sync)
    await ttsManager.speak(text, language);
  } catch (error) {
    // Interrupt error: normal
    if (error.message && error.message.includes("interrupted")) {
      console.log("ℹ️  TTS interrupted by user input");
    } else {
      console.error("❌ Error in TTS:", error);
    }
    // Continue even if TTS fails
  }
}

// Animation loop
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  avatarController.update();
  renderer.render(scene, camera);
}
animate();

// Handle window resize
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

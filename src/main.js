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
import { EyeMovementController } from "./eyeMovement.js";

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

// Eye Movement controller
let eyeMovementController = null;

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
    eyeMovementController = new EyeMovementController(avatarController);
    eyeMovementController.start();
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

  // Initialize Micro Response controller
  microResponseController = new MicroResponseController(avatarController, {
    baseIntensity: 0.5,
    baseFrequency: 0.5,
  });
  console.log("✅ Micro response controller initialized!");

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
    }

    // Micro Response (Step 4 - sentiment 기반 미세 표정)
    if (interimText && interimText.length > 10) {
      const sentiment = await stateTracker.analyzeChunkSentiment(interimText);
      if (sentiment && sentiment !== "neutral") {
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

    // Micro → Full transition
    if (microResponseController?.isActive()) {
      console.log("🔄 Switching from Micro to Full response");
      microResponseController.stop();
    }

    uiController.addToHistory(text);
    stateTracker.addToConversation("user", text);

    // ---- Parallel execution start ----
    uiController.setAnalyzing(true);

    const analysisPromise = stateTracker
      .analyzeFinalEmotion(text)
      .catch((e) => {
        console.warn("⚠️ analyzeFinalEmotion failed:", e);
        return {
          emotions: {
            joy: 0,
            sadness: 0,
            anger: 0,
            fear: 0,
            surprise: 0,
            disgust: 0,
          },
          intensityMultiplier: 1.0,
          dominantEmotion: "neutral",
        };
      });

    const responsePromise = fetch(
      "http://localhost:3000/api/generate-response",
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
        console.error("❌ generate-response failed:", e);
        return { response: "" };
      });

    // Promise
    const [analysis, resp] = await Promise.all([
      analysisPromise,
      responsePromise,
    ]);

    uiController.setAnalyzing(false);
    const counselorText = (resp && resp.response) || "";
    if (!counselorText) {
      console.log("⏭️  Empty counselor text, skipping.");
      return;
    }

    // UI update
    uiController.addCounselorMessage(counselorText);
    stateTracker.addToConversation("counselor", counselorText);

    // Set Avatar emotion
    const dom = analysis.dominantEmotion || "neutral";
    const emoIntensity =
      analysis.emotions?.[dom] != null ? Number(analysis.emotions[dom]) : 0.5;
    const finalIntensity = 0.7 * Number(analysis.intensityMultiplier ?? 1.0);
    avatarController.setEmotion(dom, emoIntensity, finalIntensity);

    // TTS start - no await
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
  ttsManager.onStart = () => {
    console.log("🔊 TTS started");
    uiController.setSpeakingStatus(true);
    lipSyncController.start();
  };

  ttsManager.onEnd = () => {
    console.log("🔇 TTS ended");
    uiController.setSpeakingStatus(false);
    lipSyncController.stop();
  };

  ttsManager.onError = (error) => {
    console.error("❌ TTS error:", error);
    uiController.setSpeakingStatus(false);
    lipSyncController.stop();

    if (error === "interrupted") {
      console.log("ℹ️  TTS was interrupted by user (this is normal)");
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

// UI Controls
document.getElementById("btn-smile").addEventListener("click", () => {
  avatarController.setEmotion("joy");
});

document.getElementById("btn-sad").addEventListener("click", () => {
  avatarController.setEmotion("sadness");
});

document.getElementById("btn-neutral").addEventListener("click", () => {
  avatarController.setEmotion("neutral");
});

document.getElementById("smile-slider").addEventListener("input", (e) => {
  const value = parseFloat(e.target.value);
  document.getElementById("smile-value").textContent = value.toFixed(1);
  avatarController.setMorphTarget("mouthSmile", value);
});

document.getElementById("brow-slider").addEventListener("input", (e) => {
  const value = parseFloat(e.target.value);
  document.getElementById("brow-value").textContent = value.toFixed(1);
  avatarController.setMorphTarget("browInnerUp", value);
});

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

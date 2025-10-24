import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { AvatarController } from "./avatar.js";
import { SpeechRecognitionManager } from "./speech.js";
import { UIController } from "./ui.js";
import { EmotionAnalyzer } from "./api.js";
import { TTSManager } from "./tts.js";
import { LipSyncController } from "./lipSync.js";

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf0f0f0);

// Camera
const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(0, 0.5, 1);

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.getElementById("canvas-container").appendChild(renderer.domElement);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.5, 0);
controls.update();

// Lights
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
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
const emotionAnalyzer = new EmotionAnalyzer();

// Avatar and Speech Recognition managers
const avatarController = new AvatarController();
let speechManager = null;
let uiController = null;

// NEW: TTS and Lip Sync managers
let ttsManager = null;
let lipSyncController = null;

// Load avatar
const loader = new GLTFLoader();

loader.load(
  "./assets/avatar_torso.glb", // GLB File
  (gltf) => {
    const avatar = gltf.scene;
    scene.add(avatar);
    avatarController.init(avatar);
    console.log("✅ Avatar loaded successfully!");

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

  // Set up callbacks
  speechManager.onTranscriptUpdate = (finalText, interimText) => {
    uiController.updateTranscript(finalText, interimText);
  };

  speechManager.onFinalTranscript = (text) => {
    console.log("📝 Final transcript:", text);
    uiController.addToHistory(text);

    // Send to LLM(Gemini) for emotion analysis
    analyzeEmotionWithGPT(text);
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
    // Don't start mic if TTS is speaking
    if (ttsManager && ttsManager.isSpeaking) {
      console.log("⚠️ Cannot start recording while avatar is speaking");
      return;
    }
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

    // Stop speech recognition while speaking to avoid feedback
    if (speechManager && speechManager.isListening) {
      speechManager.stop();
    }
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
  };

  // Connect stop TTS button
  if (uiController.stopTTSButton) {
    uiController.stopTTSButton.addEventListener("click", () => {
      ttsManager.stop();
    });
  }

  console.log("✅ TTS initialized!");
}

async function analyzeEmotionWithGPT(text) {
  console.log("🧠 Analyzing emotion with Gemini:", text);

  // Show loading state
  uiController.setAnalyzing(true);

  const result = await emotionAnalyzer.analyzeEmotion(text);

  if (result) {
    // Update avatar expression
    avatarController.setEmotion(result.emotion, result.intensity);

    // Display counselor response
    uiController.addCounselorMessage(result.response);

    // NEW: Speak the response with TTS
    await speakResponse(result.response);
  }

  uiController.setAnalyzing(false);
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
    console.error("❌ Error in TTS:", error);
    // Continue even if TTS fails - don't break the flow
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

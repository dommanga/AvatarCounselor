import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { AvatarController } from "./avatar.js";
import { SpeechRecognitionManager } from "./speech.js";
import { UIController } from "./ui.js";
import { TTSManager } from "./tts.js";
import { LipSyncController } from "./lipSync.js";
import { APIManager } from "./APIManager.js";
import { MicroResponseController } from "./microResponse.js";
import { IdleAnimationController } from "./IdleAnimation.js";
import { CustomizationManager } from "./customization.js";

const DEV_TEXT_MODE = true;
const ENV_COMPARISON = false;

const DEV_DEFAULT_AVATAR = "female";
const USE_ROCKETBOX = true;

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

const cameraR = new THREE.PerspectiveCamera(30, 1, 0.1, 1000);
cameraR.position.set(0, 0.65, 1);
cameraR.lookAt(0, 0.6, 0);

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
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
let lightGroup = null;

function setupLights(useRocketbox) {
  if (lightGroup) {
    scene.remove(lightGroup);
    lightGroup.traverse((o) => o.dispose && o.dispose());
  }
  lightGroup = new THREE.Group();

  if (useRocketbox) {
    const ambient = new THREE.AmbientLight(0xffffff, 3);
    const key = new THREE.DirectionalLight(0xffffff, 5);   key.position.set(0, 4, 3);
    const key1 = new THREE.DirectionalLight(0xffffff, 3);  key1.position.set(0, -4, 3);
    const fill = new THREE.DirectionalLight(0xc8d4e0, 3);  fill.position.set(-3, 2, 2);
    const rim = new THREE.DirectionalLight(0xffffff, 0.5); rim.position.set(0, 2, -3);
    lightGroup.add(ambient, key, key1, fill, rim);
  } else {
    const ambient = new THREE.AmbientLight(0xffffff, 1.5);
    const dir = new THREE.DirectionalLight(0xffffff, 3.0); dir.position.set(5, 10, 5);
    dir.castShadow = true;
    lightGroup.add(ambient, dir);
  }
  
  lightGroup.traverse((o) => { o.layers.enable(1); o.layers.enable(2); });
  scene.add(lightGroup);
}

// Ground
const groundGeometry = new THREE.PlaneGeometry(10, 10);
const groundMaterial = new THREE.MeshStandardMaterial({ color: 0xcccccc });
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Initialize customization manager
const customizationManager = new CustomizationManager();

// Initialize api manager
const apiManager = new APIManager();
window.apiManager = apiManager;

let conversationHistory = []; // [{ speaker: 'user'|'counselor', text, timestamp }]

// Avatar and Speech Recognition managers
const avatarController = new AvatarController();
const avatarControllerL = new AvatarController();   // RPM (L)
const avatarControllerR = new AvatarController();   // Rocketbox (R)
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

// Nonverbal mode: "responsive" (default) | "steady"
let nonverbalMode = "responsive";

// Verbal style: "directing" (default) | "following"
let verbalStyle = "directing";

// Processing flag to prevent duplicate requests
let isProcessingResponse = false;

// Current counselor text (to show in UI when TTS starts)
let currentCounselorText = null;

let currentSessionActive = false;

let currentUserAge = null;

let currentAvatar = null;

let customizationListener = null;

let microL = null;
let microR = null;

// Load avatar
const loader = new GLTFLoader();

(async function init() {
  if (ENV_COMPARISON) {
    loadComparisonAvatars();
    
    let cmpEmotion_current = "neutral";
    let cmpIntensity_current = 1.00;
    
    window.cmpEmotion = function (emotion) {
      cmpEmotion_current = emotion;
      broadcastEmotion(emotion, cmpIntensity_current);
    };
    
    window.cmpIntensity = function (v) {
      cmpIntensity_current = parseFloat(v) / 100;
      document.getElementById("cmp-int-val").textContent = cmpIntensity_current.toFixed(2);
      broadcastEmotion(cmpEmotion_current, cmpIntensity_current);
    };

    window.cmpNod = function () {
      broadcastNod();
    };
    
    document.getElementById("comparison-controls").style.display = "block";
    
    return;
  } 
  uiController = new UIController();

  uiController.onSessionStart = async (sessionInfo) => {
    if (customizationListener) {
      customizationManager.removeListener(customizationListener);
      // console.log("🗑️ Removed previous customization listener");
    }

    customizationManager.resetToDefaults();

    uiController.setIntensityLevel(0.75);
    uiController.setFrequencyLevel(0.6);

    if (sessionInfo.condition === "Default") {
      uiController.lockCustomizationSettings();
    } else {
      uiController.unlockCustomizationSettings();
    }

    loadAvatar();
  };

  try {
    const configRes = await fetch("http://localhost:3000/api/config");
    const config = await configRes.json();

    if (config.loggingEnabled) {
      uiController.showSessionModal();
    } else {
      loadAvatar();
    }
  } catch (e) {
    console.warn("⚠️ Could not fetch config");
    loadAvatar();
  }
})();

function loadAvatar() {
  if (currentAvatar) {
    scene.remove(currentAvatar);
    currentAvatar.traverse((node) => {
      if (node.geometry) node.geometry.dispose();
      if (node.material) {
        if (Array.isArray(node.material)) {
          node.material.forEach((m) => m.dispose());
        } else {
          node.material.dispose();
        }
      }
    });
    // console.log("🗑️ Previous avatar removed and disposed");
  }

  if (idleAnimationController) {
    idleAnimationController.stop();
  }

  const selectedAvatar =
    sessionStorage.getItem("selectedAvatar") || DEV_DEFAULT_AVATAR;
  const avatarPath = USE_ROCKETBOX
    ? "./assets/coach_rocketbox.glb"
    : (selectedAvatar === "male" ? "./assets/avatar_boy.glb" : "./assets/avatar_girl.glb");

  setupLights(USE_ROCKETBOX);

  loader.load(
    avatarPath,
    (gltf) => {
      const avatar = gltf.scene;
      if (USE_ROCKETBOX) {
        avatar.position.y = -0.98;
      }

      avatar.traverse((node) => {
        if (node.isMesh && node.material) {
          const mats = Array.isArray(node.material) ? node.material : [node.material];
          mats.forEach((m) => {
            if (m.transparent) {
              m.alphaTest = 0.2;       
              m.depthWrite = true; 
              m.needsUpdate = true;
            }
          });
        }
      });
      
      currentAvatar = avatar;
      scene.add(avatar);
      avatarController.init(avatar);

      avatar.traverse((n) => {
        if (!n.isBone) return;
        if (n.name === "Bip01_L_UpperArm") n.rotation.y += THREE.MathUtils.degToRad(30);
        if (n.name === "Bip01_R_UpperArm") n.rotation.y -= THREE.MathUtils.degToRad(30);
        if (n.name === "Bip01_L_Clavicle") n.rotation.y -= THREE.MathUtils.degToRad(8);
        if (n.name === "Bip01_R_Clavicle") n.rotation.y += THREE.MathUtils.degToRad(8);
      });

      const loadingScreen = document.getElementById("loadingScreen");
      if (loadingScreen) loadingScreen.classList.add("hidden");

      idleAnimationController = new IdleAnimationController(avatarController);
      idleAnimationController.start();

      initializeSpeechRecognition();
    },
    undefined,
    (error) => {
      console.error("❌ Error loading avatar:", error);
    }
  );
}

function loadComparisonAvatars() {
  camera.layers.set(1);
  cameraR.layers.set(2);
  let idleL = null;
  let idleR = null;

  // ── L (RPM) — layer 1 ──
  const lightsL = new THREE.Group();
  const ambL = new THREE.AmbientLight(0xffffff, 1.5);
  const dirL = new THREE.DirectionalLight(0xffffff, 3.0); dirL.position.set(5, 10, 5);
  lightsL.add(ambL, dirL);
  lightsL.traverse(o => o.layers.set(1));
  scene.add(lightsL);

  // ── R (Rocketbox) — layer 2 ──
  const lightsR = new THREE.Group();
  const ambR = new THREE.AmbientLight(0xffffff, 3);
  const keyR  = new THREE.DirectionalLight(0xffffff, 5);   keyR.position.set(0, 4, 3);
  const key1R = new THREE.DirectionalLight(0xffffff, 3);   key1R.position.set(0, -4, 3);
  const fillR = new THREE.DirectionalLight(0xc8d4e0, 3);   fillR.position.set(-3, 2, 2);
  const rimR  = new THREE.DirectionalLight(0xffffff, 0.5); rimR.position.set(0, 2, -3);
  lightsR.add(ambR, keyR, key1R, fillR, rimR);
  lightsR.traverse(o => o.layers.set(2));
  scene.add(lightsR);

  const loader = new GLTFLoader();

  // RPM
  loader.load("./assets/avatar_girl.glb", (gltf) => {
    const a = gltf.scene;
    a.traverse(o => o.layers.set(1));
    scene.add(a);
    avatarControllerL.init(a);
    idleL = new IdleAnimationController(avatarControllerL);
    idleL.start();
    microL = new MicroResponseController(avatarControllerL, { baseIntensity: 0.75, baseFrequency: 0.5 });
    avatarControllerL.microResponseController = microL;
    console.log("✅ L(RPM):", avatarControllerL.headMesh?.name);
  });

  // Rocketbox
  loader.load("./assets/coach_rocketbox.glb", (gltf) => {
    const a = gltf.scene;
    a.position.y = -0.98;
    a.traverse((node) => {
    node.layers.set(2);
    if (node.isMesh && node.material) {
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      mats.forEach((m) => {
        if (m.transparent) { m.alphaTest = 0.2; m.depthWrite = true; m.needsUpdate = true; }
      });
    }
  });
    scene.add(a);
    avatarControllerR.init(a);
    avatarControllerR.setExpressionMode(true);
    idleR = new IdleAnimationController(avatarControllerR);
    idleR.start();
    microR = new MicroResponseController(avatarControllerR, { baseIntensity: 0.75, baseFrequency: 0.5 });
    avatarControllerR.microResponseController = microR;
    console.log("✅ R(Rocketbox):", avatarControllerR.headMesh?.name);
  });
}

function broadcastEmotion(emotion, intensity) {
  // RPM - ARkit
  avatarControllerL.setExpressionMode(false);
  avatarControllerL.setEmotion(emotion, intensity);

  // Rocketbox - AU
  avatarControllerR.setExpressionMode(true);
  avatarControllerR.setEmotion(emotion, intensity);
}

function broadcastNod() {
  const nodConfig = { count: 2, speed: 0.5 };
  microL?._startHeadNodding(nodConfig);
  microR?._startHeadNodding(nodConfig);
}

// Initialize speech recognition system
async function initializeSpeechRecognition() {
  // console.log("🎤 Initializing speech recognition...");

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
    baseIntensity: currentSettings.baseIntensity, // 0.3-1.2
    baseFrequency: currentSettings.baseFrequency, // 0.2-1.0
  });
  // console.log("✅ Micro response controller initialized!");

  // ===== DEV =====
  if (DEV_TEXT_MODE) {
    const devInput = document.getElementById("dev-input");
    devInput.style.display = "block";

    let devTypingMicro = null;
    let devTyping = false;

    // typing start → periodic micro response start (listening acting)
    const startDevListening = () => {
      if (devTyping) return;
      devTyping = true;
      if (idleAnimationController) idleAnimationController.pauseHeadSway();

      devTypingMicro = setInterval(() => {
        if (nonverbalMode !== "responsive") return;  // steady면 micro 안 함 (실제 동작과 일치)
        const moods = ["positive", "negative", "neutral"];
        const mood = moods[Math.floor(Math.random() * moods.length)];
        microResponseController?.trigger(mood);
      }, 2000);
    };

    // sending -> micro stop
    const stopDevListening = () => {
      devTyping = false;
      clearInterval(devTypingMicro);
      devTypingMicro = null;
    };

    // whenever typing - micro response maintained
    devInput.addEventListener("input", () => {
      if (devInput.value.trim().length > 0) {
        startDevListening();
      } else {
        stopDevListening();
      }
    });

    // Enter → final processing
    devInput.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const text = devInput.value.trim();
      if (!text) return;

      stopDevListening();
      devInput.value = "";

      speechManager.onFinalTranscript(text);
    });
  }
  // ===== DEV =====

  // ===== CUSTOMIZATION UI SETUP =====

  // Initialize UI with current settings
  uiController.setIntensityLevel(currentSettings.baseIntensity);
  uiController.setFrequencyLevel(currentSettings.baseFrequency);

  uiController.onIntensityChange = (value) => {
    customizationManager.setBaseIntensity(value);
  };

  uiController.onFrequencyChange = (value) => {
    customizationManager.setBaseFrequency(value);
  };

  uiController.resetButton.addEventListener("click", () => {
    customizationManager.resetToDefaults();
    const settings = customizationManager.getSettings();
    uiController.setIntensityLevel(settings.baseIntensity);
    uiController.setFrequencyLevel(settings.baseFrequency);
  });

  // Listen to customization changes and update micro response controller
  customizationListener = async (settingName, newValue) => {
    if (microResponseController) {
      const updatedSettings = customizationManager.getSettings();
      microResponseController.updateCustomization(updatedSettings);
    }

    // Log settings change (only if session is active and not a reset)
    if (
      currentSessionActive &&
      uiController.getSessionInfo() &&
      settingName !== "reset"
    ) {
      const settings = customizationManager.getSettings();
      await apiManager.logSettingsChange(settings);
    }
  };

  customizationManager.addListener(customizationListener);

  // Set up callbacks
  speechManager.onTranscriptUpdate = async (finalText, interimText) => {
    uiController.updateTranscript(finalText, interimText);

    if (interimText && interimText.trim().length > 0) {
      if (idleAnimationController) {
        idleAnimationController.pauseHeadSway();
      }
    }

    // Micro Response — Responsive only
    if (nonverbalMode === "responsive" && interimText && interimText.length > 10) {
      const sentiment = await apiManager.analyzeSentiment(interimText);
      if (sentiment !== null) {
        microResponseController.trigger(sentiment);
      }
    }
  };

  speechManager.onFinalTranscript = async (text) => {
    apiManager.resetSentimentStream();

    if (!text || text.trim().length === 0) {
      // console.log("⏭️  Skipping empty transcript");
      return;
    }

    // Prevent duplicate processing
    if (isProcessingResponse) {
      // console.log("⏭️ Already processing a response, skipping duplicate");
      return;
    }

    // console.log("📝 Final transcript");
    isProcessingResponse = true;

    // Stop speech recognition immediately after user finishes speaking
    if (speechManager && speechManager.isListening) {
      // console.log("🎤 Stopping speech recognition (waiting for response)");
      speechManager.stop(false); // Don't process transcript (we're already processing this one)
    }

    // Disable mic button during response generation and TTS
    uiController.disableMicButton();
    uiController.setThinkingStatus();
    uiController.addToHistory(text);
    addToConversation("user", text);

    const responseData = await apiManager.generateCounselorResponse(
      text,
      conversationHistory,
      currentUserAge,
      verbalStyle
    );

    const counselorText = responseData.response || "";
    const counselorEmotion = responseData.counselorEmotion || {
      dominantEmotion: "neutral",
      intensityMultiplier: 1.0,
    };

    if (!counselorText) {
      // console.log("⏭️ Empty counselor text, skipping.");
      isProcessingResponse = false;
      uiController.enableMicButton();

      // Restart speech recognition
      if (speechManager && !speechManager.isListening) {
        // console.log("🎤 Resuming speech recognition");
        speechManager.start();
      }
      return;
    }

    // Store for conversation history
    addToConversation("counselor", counselorText);

    // ===== APPLY COUNSELOR EMOTION with CUSTOMIZATION =====
    const currentSettings = customizationManager.getSettings();
    currentCounselorEmotion = counselorEmotion.dominantEmotion;
    let rawFinal =
      currentSettings.baseIntensity * counselorEmotion.intensityMultiplier;
    currentFinalIntensity = Math.max(0, rawFinal);

    // console.log(`🎭 Full Response`);
    console.log(
      `🎭 Answering with emotion=${currentCounselorEmotion}`
    );

    // Turn logging
    if (uiController.getSessionInfo()) {
      await apiManager.logTurn({
        userTranscript: text,
        counselorResponse: counselorText,
        counselorEmotion: {
          dominantEmotion: counselorEmotion.dominantEmotion,
          intensityMultiplier: counselorEmotion.intensityMultiplier,
          finalIntensity: currentFinalIntensity,
        },
      });
    }

    // Store counselor text to show when TTS starts
    currentCounselorText = counselorText;

    if (
      microResponseController?.isActive() ||
      microResponseController?.isNodding()
    ) {
      microResponseController.stopImmediate();
      // console.log("⚡ Micro stopped, blendshapes preserved");
      // console.log("🎭 Full Response applied (smooth transition from Micro)");
    }

    if (nonverbalMode === "steady") {
      currentCounselorEmotion = "serious";
      currentFinalIntensity = currentSettings.baseIntensity; // LLM multiplier 무시, 일관 유지
    }

    avatarController.setEmotion(currentCounselorEmotion, currentFinalIntensity);

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
    // Only update UI when starting listening, not when stopping
    // (stopping is handled manually by button clicks)
    if (isListening) {
      uiController.setListeningStatus(true);
    }
  };

  // Connect UI buttons
  uiController.micButton.addEventListener("click", async () => {
    const buttonText =
      uiController.micButton.querySelector(".status-text").textContent;

    if (buttonText === "Stop Conversation") {
      // Stop everything
      speechManager.stop(false);

      // Stop TTS if playing
      if (ttsManager && ttsManager.isSpeaking) {
        ttsManager.stop();
      }

      // Stop micro response
      if (
        microResponseController?.isActive() ||
        microResponseController?.isNodding()
      ) {
        microResponseController.stopImmediate();
      }

      // Clear expression interval
      if (expressionInterval) {
        clearInterval(expressionInterval);
        expressionInterval = null;
      }

      // Fade to neutral
      avatarController.fadeToNeutral(0.5);

      // Reset idle animation
      if (idleAnimationController) {
        idleAnimationController.resumeHeadSway();
      }

      // Reset processing flag
      isProcessingResponse = false;

      // Set UI to restart state
      uiController.setRestartState();
    } else {
      // Start or restart

      // Start session logging ONLY if not already active
      if (!currentSessionActive) {
        const sessionInfo = uiController.getSessionInfo();
        // console.log("🔍 Session info:", sessionInfo);

        if (sessionInfo) {
          const currentSettings = customizationManager.getSettings();
          const language = speechManager.getLanguage();

          await apiManager.startSession({
            ...sessionInfo,
            customizationSettings: currentSettings,
            language,
          });

          currentSessionActive = true;
          currentUserAge = sessionInfo.age;
          console.log("✅ Session logging started");
        } else {
          // console.log("⚠️ No session info available");
        }
      } else {
        // console.log("⏭️ Session already active, skipping start");
      }

      speechManager.start();
      // uiController.setStatus("ready", "Ready");
    }
  });

  uiController.newSessionButton.addEventListener("click", async () => {
    // Stop everything first
    speechManager.stop(false);

    if (ttsManager && ttsManager.isSpeaking) {
      ttsManager.stop();
    }

    if (
      microResponseController?.isActive() ||
      microResponseController?.isNodding()
    ) {
      microResponseController.stopImmediate();
    }

    if (expressionInterval) {
      clearInterval(expressionInterval);
      expressionInterval = null;
    }

    avatarController.fadeToNeutral(0.5);

    if (idleAnimationController) {
      idleAnimationController.resumeHeadSway();
    }

    isProcessingResponse = false;

    // End session logging
    if (currentSessionActive && uiController.getSessionInfo()) {
      await apiManager.endSession();
      currentSessionActive = false;
      // console.log("✅ Session logging ended");
    }

    // Clear all histories
    uiController.startNewSession();
    speechManager.clearTranscript();
    conversationHistory = [];

    customizationManager.resetToDefaults();
    uiController.setIntensityLevel(0.75);
    uiController.setFrequencyLevel(0.6);
    uiController.unlockCustomizationSettings();

    // console.log("🆕 New session started");

    try {
      const configRes = await fetch("http://localhost:3000/api/config");
      const config = await configRes.json();

      if (config.loggingEnabled) {
        uiController.showSessionModal();
      }
    } catch (e) {
      console.warn("⚠️ Could not fetch config");
    }
  });

  uiController.languageSelect.addEventListener("change", (e) => {
    speechManager.setLanguage(e.target.value);
  });

  document.querySelectorAll("#nonverbal-mode .cond-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll("#nonverbal-mode .cond-btn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      setNonverbalMode(btn.dataset.mode);
    });
  });

  document.querySelectorAll("#verbal-style .cond-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll("#verbal-style .cond-btn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      setVerbalStyle(btn.dataset.style);
    });
  });

  // console.log("✅ Speech recognition initialized!");
}

// Initialize TTS system
function initializeTTS() {
  // console.log("🔊 Initializing TTS...");

  // Create TTS manager
  ttsManager = new TTSManager(apiManager);

  // Create Lip Sync controller
  lipSyncController = new LipSyncController(avatarController);

  // Setup TTS callbacks
  ttsManager.onStart = async () => {
    // console.log("🔊 TTS started");

    // Show counselor message in UI (synced with TTS start)
    if (currentCounselorText) {
      uiController.addCounselorMessage(currentCounselorText);
    }

    // Ensure speech recognition is stopped (should already be stopped from onFinalTranscript)
    if (speechManager && speechManager.isListening) {
      // console.log("⚠️ Speech recognition still active, stopping now");
      speechManager.stop(false); // Don't process transcript during TTS
    }

    uiController.setSpeakingStatus(true);
    uiController.disableNewSessionButton();
    lipSyncController.start();
    lipSyncController.setCurrentEmotion(currentCounselorEmotion || "neutral");

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
    // console.log("✅ Micro stopped, starting Full Response");

    if (currentCounselorEmotion && currentFinalIntensity > 0) {
      // Clear any existing interval
      if (expressionInterval) {
        clearInterval(expressionInterval);
      }

      // Sine wave based natural fluctuation with fade-in
      let time = 0;
      let fadeInProgress = 1; // 0 → 1 over fade-in duration
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

      // console.log(
      //   `🔄 Natural expression fluctuation started (sine wave with fade-in)`
      // );
    }
  };

  ttsManager.onEnd = () => {
    // console.log("🔇 TTS ended");
    uiController.setSpeakingStatus(false);
    uiController.enableMicButton();
    uiController.enableNewSessionButton();
    lipSyncController.stop();

    // Expression fluctuation stop
    if (expressionInterval) {
      clearInterval(expressionInterval);
      expressionInterval = null;
      // console.log("🔄 Expression fluctuation stopped");
    }

    if (idleAnimationController) {
      idleAnimationController.resumeHeadSway();
    }

    if (nonverbalMode === "steady") {
      const s = customizationManager.getSettings();
      avatarController.setEmotion("serious", s.baseIntensity);
    } else {
      avatarController.fadeToNeutral(1.0);
    }

    // Reset emotion state
    currentCounselorEmotion = null;
    currentFinalIntensity = 0;
    currentCounselorText = null;

    // Reset processing flag
    isProcessingResponse = false;

    // Restart speech recognition after TTS ends
    if (speechManager && !speechManager.isListening) {
      // console.log("🎤 Resuming speech recognition after TTS");
      speechManager.start();
    }
  };

  ttsManager.onError = (error) => {
    console.error("❌ TTS error:", error);
    uiController.setSpeakingStatus(false);
    uiController.enableMicButton();
    uiController.enableNewSessionButton();
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
      currentCounselorText = null;
    }
    // Reset processing flag
    isProcessingResponse = false;

    // Restart speech recognition after TTS error
    // BUT NOT if interrupted (interrupted means user manually stopped via New Session button)
    if (error === "interrupted") {
      console.log("ℹ️ TTS interrupted");
    } else if (speechManager && !speechManager.isListening) {
      // console.log("🎤 Resuming speech recognition after TTS error");
      speechManager.start();
    }
  };

  // console.log("✅ TTS initialized!");
}

function setNonverbalMode(mode) {
  nonverbalMode = mode;
  const s = customizationManager.getSettings();
  if (mode === "steady") {
    avatarController.setEmotion("serious", s.baseIntensity);
  } else {
    avatarController.fadeToNeutral(0.5);
  }
  console.log(`🎭 Nonverbal mode: ${mode}`);
}

function setVerbalStyle(style) {
  verbalStyle = style;
  console.log(`🗣️ Verbal style: ${style}`);
}

function addToConversation(speaker, text) {
  if (!text || !text.trim()) return;
  conversationHistory.push({ speaker, text, timestamp: Date.now() });
  if (conversationHistory.length > 40) conversationHistory.shift();
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

    // console.log(`🔊 Speaking in ${language}`);

    const selectedAvatar =
      sessionStorage.getItem("selectedAvatar") || DEV_DEFAULT_AVATAR;

    // Speak with TTS (callbacks handle UI and lip sync)
    await ttsManager.speak(text, language, selectedAvatar);
  } catch (error) {
    // Interrupt error: normal
    if (error.message && error.message.includes("interrupted")) {
      console.log("ℹ️  TTS interrupted");
    } else {
      console.error("❌ Error in TTS:", error);
    }
    // Continue even if TTS fails
  }
}

// Animation loop
function animate() {
  requestAnimationFrame(animate);

  if (ENV_COMPARISON) {
    const w = window.innerWidth, h = window.innerHeight;
    const halfW = w / 2;

    renderer.setScissorTest(true);

    // RPM
    camera.aspect = halfW / h;
    camera.updateProjectionMatrix();
    renderer.setViewport(0, 0, halfW, h);
    renderer.setScissor(0, 0, halfW, h);
    avatarControllerL.update();
    renderer.render(scene, camera);

    // Rocketbox
    cameraR.aspect = halfW / h;
    cameraR.updateProjectionMatrix();
    renderer.setViewport(halfW, 0, halfW, h);
    renderer.setScissor(halfW, 0, halfW, h);
    avatarControllerR.update();
    renderer.render(scene, cameraR);

    renderer.setScissorTest(false);
  } else {
    controls.update();
    avatarController.update();
    renderer.render(scene, camera);
  }
}
animate();

// Handle window resize
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

import { EMOTION_CONFIGS } from "./emotions.js";

export class AvatarController {
  constructor() {
    this.avatar = null;
    this.headMesh = null;
    this.morphTargetDictionary = null;
    this.currentEmotion = "neutral";
    this.targetMorphValues = {};
    this.currentMorphValues = {};
    this.transitionSpeed = 0.1;
  }

  init(avatar) {
    this.avatar = avatar;

    // Find Wolf3D_Avatar mesh (Ready Player Me standard)
    avatar.traverse((node) => {
      if (
        node.isMesh &&
        node.name === "Wolf3D_Avatar" &&
        node.morphTargetDictionary
      ) {
        this.headMesh = node;
        this.morphTargetDictionary = node.morphTargetDictionary;
      }
    });

    if (!this.headMesh) {
      console.error("❌ Wolf3D_Avatar mesh not found!");
      return;
    }

    console.log("✅ Avatar mesh loaded");
    console.log(
      "✅ Total morph targets:",
      Object.keys(this.morphTargetDictionary).length
    );

    this.initializeMorphValues();
  }

  initializeMorphValues() {
    // Initialize all morph targets to zero
    for (let key in this.morphTargetDictionary) {
      this.currentMorphValues[key] = 0;
      this.targetMorphValues[key] = 0;
    }
  }

  setMorphTarget(targetName, value) {
    if (!this.headMesh || !this.morphTargetDictionary) {
      console.warn("Avatar mesh not ready");
      return;
    }

    const index = this.morphTargetDictionary[targetName];
    if (index !== undefined) {
      this.targetMorphValues[targetName] = value;
    } else {
      console.warn(`Morph target "${targetName}" not found`);
    }
  }

  /**
   * Set emotion with FACS-based expression (Phase 2)
   * @param {string} emotion - Emotion name (joy, sadness, anger, fear, surprise, disgust, neutral)
   * @param {number} intensity - Emotion intensity from LLM (0~1)
   * @param {number} finalIntensity - baseIntensity × intensityMultiplier (0~1.5)
   */
  setEmotion(emotion, intensity = 0.5, finalIntensity = 0.7) {
    console.log(
      `Setting emotion: ${emotion}, intensity: ${intensity}, finalIntensity: ${finalIntensity}`
    );
    this.currentEmotion = emotion;

    const emotionConfig = EMOTION_CONFIGS[emotion];
    if (!emotionConfig) {
      console.warn(`Unknown emotion: ${emotion}`);
      return;
    }

    // Reset all morph targets to zero first
    for (let key in this.targetMorphValues) {
      this.targetMorphValues[key] = 0;
    }

    // Phase 1 compatibility: Old format (simple key-value mapping)
    if (typeof emotionConfig === "object" && !emotionConfig.blendshapes) {
      console.log("Using Phase 1 emotion mapping");
      for (let morphName in emotionConfig) {
        this.setMorphTarget(morphName, emotionConfig[morphName]);
      }
      return;
    }

    // Phase 2: FACS-based emotion config
    console.log(`Applying FACS-based emotion: ${emotionConfig.name}`);

    const blendshapes = emotionConfig.blendshapes || {};
    const duration = emotionConfig.duration || 3.0;

    // Calculate and apply blendshape values
    for (const [blendshapeName, params] of Object.entries(blendshapes)) {
      // Step 1: Calculate base emotion value
      const baseValue = params.base + params.scale * intensity;

      // Step 2: Apply finalIntensity (baseIntensity × multiplier)
      let finalValue = baseValue * finalIntensity;

      // Step 3: Clamp to [0, 1]
      finalValue = Math.max(0, Math.min(1, finalValue));

      // Apply to avatar
      this.setMorphTarget(blendshapeName, finalValue);
    }

    // Auto fade to neutral after duration
    setTimeout(() => {
      this.fadeToNeutral(duration * 0.3);
    }, duration * 1000);
  }

  /**
   * Gradually fade all expressions to neutral
   * @param {number} fadeDuration - Fade duration in seconds
   */
  fadeToNeutral(fadeDuration = 1.0) {
    console.log(`Fading to neutral over ${fadeDuration}s`);

    // Gradual fade out (20 steps)
    const steps = 20;
    const stepDuration = (fadeDuration * 1000) / steps;
    let currentStep = 0;

    // Store initial values
    const initialValues = {};
    for (let morphName in this.targetMorphValues) {
      if (this.targetMorphValues[morphName] > 0) {
        initialValues[morphName] = this.targetMorphValues[morphName];
      }
    }

    const fadeInterval = setInterval(() => {
      currentStep++;
      const progress = currentStep / steps; // 0 → 1

      // Gradually reduce each blendshape to 0
      for (const [morphName, initialValue] of Object.entries(initialValues)) {
        const targetValue = initialValue * (1 - progress);
        this.targetMorphValues[morphName] = targetValue;
      }

      // Fade complete
      if (currentStep >= steps) {
        clearInterval(fadeInterval);

        // Final reset to 0
        for (let key in this.targetMorphValues) {
          this.targetMorphValues[key] = 0;
        }
      }
    }, stepDuration);
  }

  update() {
    if (!this.headMesh) return;

    // Smooth transition with linear interpolation
    for (let morphName in this.targetMorphValues) {
      const index = this.morphTargetDictionary[morphName];
      if (index !== undefined) {
        const current = this.currentMorphValues[morphName];
        const target = this.targetMorphValues[morphName];

        this.currentMorphValues[morphName] +=
          (target - current) * this.transitionSpeed;

        this.headMesh.morphTargetInfluences[index] =
          this.currentMorphValues[morphName];
      }
    }
  }
}

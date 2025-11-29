import { EMOTION_CONFIGS } from "./emotions.js";

export class AvatarController {
  constructor() {
    this.avatar = null;
    this.headMesh = null;
    this.headBone = null;
    this.spineBone = null;
    this.morphTargetDictionary = null;
    this.currentEmotion = "neutral";
    this.targetMorphValues = {};
    this.currentMorphValues = {};
    this.transitionSpeed = 0.1;
  }

  init(avatar) {
    this.avatar = avatar;

    // Find Wolf3D_Avatar mesh and Head bone
    avatar.traverse((node) => {
      if (
        node.isMesh &&
        node.name === "Wolf3D_Avatar" &&
        node.morphTargetDictionary
      ) {
        this.headMesh = node;
        this.morphTargetDictionary = node.morphTargetDictionary;
      }

      // Find Head bone
      if (node.isBone && node.name === "Head") {
        this.headBone = node;
        console.log("✅ Head bone found!");
      }
      // Find Spine bone
      if (node.isBone && node.name === "Spine") {
        this.spineBone = node;
        console.log("✅ Spine bone found!");
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

  getHeadBone() {
    return this.headBone;
  }

  getSpineBone() {
    return this.spineBone;
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
   * @param {number} finalIntensity - baseIntensity × intensityMultiplier (0.255 ~ 1.38)
   */
  setEmotion(emotion, finalIntensity = 1.0) {
    this.currentEmotion = emotion;

    const emotionConfig = EMOTION_CONFIGS[emotion];
    if (!emotionConfig) {
      console.warn(`Unknown emotion: ${emotion}`);
      return;
    }

    const blendshapes = emotionConfig.blendshapes || {};

    const newEmotionBlendshapes = new Set(Object.keys(blendshapes));

    for (let key in this.targetMorphValues) {
      if (
        key === "eyeBlinkLeft" ||
        key === "eyeBlinkRight" ||
        key.includes("eyeLook")
      ) {
        continue;
      }

      if (!newEmotionBlendshapes.has(key)) {
        this.targetMorphValues[key] = 0;
      }
    }

    for (const [blendshapeName, value] of Object.entries(blendshapes)) {
      let finalValue = value * finalIntensity;
      finalValue = Math.max(0, Math.min(1, finalValue));

      this.setMorphTarget(blendshapeName, finalValue);
    }
  }

  /**
   * Gradually fade all expressions to neutral
   * @param {number} fadeDuration - Fade duration in seconds
   */
  fadeToNeutral(fadeDuration = 1.0) {
    // console.log(`Fading to neutral over ${fadeDuration}s`);

    // Gradual fade out (20 steps)
    const steps = 20;
    const stepDuration = (fadeDuration * 1000) / steps;
    let currentStep = 0;

    // Store initial values (exclude eyeBlink)
    const initialValues = {};
    for (let morphName in this.targetMorphValues) {
      // Skip eyeBlink morphs
      if (morphName.includes("eyeBlink") || morphName.includes("Eye_Blink")) {
        continue;
      }

      if (this.targetMorphValues[morphName] > 0) {
        initialValues[morphName] = this.targetMorphValues[morphName];
      }
    }

    const fadeInterval = setInterval(() => {
      currentStep++;
      const progress = currentStep / steps; // 0 → 1

      // Gradually reduce each blendshape to 0 (except eyeBlink)
      for (const [morphName, initialValue] of Object.entries(initialValues)) {
        const targetValue = initialValue * (1 - progress);
        this.targetMorphValues[morphName] = targetValue;
      }

      // Fade complete
      if (currentStep >= steps) {
        clearInterval(fadeInterval);

        // Final reset to 0 (except eyeBlink)
        for (let key in this.targetMorphValues) {
          if (key.includes("eyeBlink") || key.includes("Eye_Blink")) {
            continue; // Keep eyeBlink values
          }
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

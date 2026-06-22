import { EMOTION_CONFIGS } from "./emotions.js";
import { EMOTION_CONFIGS_AU } from "./emotions_au.js";

const MORPH_ALIASES = {
  browDownLeft: "AK_01_BrowDownLeft",
  browDownRight: "AK_02_BrowDownRight",
  browInnerUp: "AK_03_BrowInnerUp",
  browOuterUpLeft: "AK_04_BrowOuterUpLeft",
  browOuterUpRight: "AK_05_BrowOuterUpRight",
  cheekSquintLeft: "AK_07_CheekSquintLeft",
  cheekSquintRight: "AK_08_CheekSquintRight",
  eyeBlinkLeft: "AK_09_EyeBlinkLeft",
  eyeBlinkRight: "AK_10_EyeBlinkRight",
  eyeSquintLeft: "AK_19_EyeSquintLeft",
  eyeSquintRight: "AK_20_EyeSquintRight",
  eyeWideLeft: "AK_21_EyeWideLeft",
  eyeWideRight: "AK_22_EyeWideRight",
  mouthOpen: "AK_25_JawOpen",
  jawOpen: "AK_25_JawOpen",
  mouthClose: "AK_27_MouthClose",
  mouthDimpleLeft: "AK_28_MouthDimpleLeft",
  mouthDimpleRight: "AK_29_MouthDimpleRight",
  mouthFrownLeft: "AK_30_MouthFrownLeft",
  mouthFrownRight: "AK_31_MouthFrownRight",
  mouthPressLeft: "AK_36_MouthPressLeft",
  mouthPressRight: "AK_37_MouthPressRight",
  mouthSmileLeft: "AK_44_MouthSmileLeft",
  mouthSmileRight: "AK_45_MouthSmileRight",
  noseSneerLeft: "AK_50_NoseSneerLeft",
  noseSneerRight: "AK_51_NoseSneerRight",
  eyeLookDownLeft: "AK_11_EyeLookDownLeft",
  eyeLookDownRight: "AK_12_EyeLookDownRight",
  eyeLookInLeft: "AK_13_EyeLookInLeft",
  eyeLookInRight: "AK_14_EyeLookInRight",
  eyeLookOutLeft: "AK_15_EyeLookOutLeft",
  eyeLookOutRight: "AK_16_EyeLookOutRight",
  eyeLookUpLeft: "AK_17_EyeLookUpLeft",
  eyeLookUpRight: "AK_18_EyeLookUpRight",
};

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
    this.useAU = false;   // false = ARKit, true = AU
  }

  init(avatar) {
    this.avatar = avatar;

    let mesh1 = null;
    let fallback = null;
    let bestCount = -1;

    avatar.traverse((node) => {
      if (node.isMesh && node.morphTargetDictionary) {
        const nm = node.name.trim();
        if (nm === "Mesh_1" || nm === "Wolf3D_Avatar") {
          mesh1 = node;
        }
        const count = Object.keys(node.morphTargetDictionary).length;
        if (count > bestCount) {
          bestCount = count;
          fallback = node;
        }
      }

      if (node.isBone) {
        const n = node.name;
        if (!this.headBone && (n === "Head" || n === "Bip01_Head" || n === "Bip01_Head1")) {
          this.headBone = node;
        }
        if (!this.spineBone && (n === "Spine" || n === "Bip01_Spine1" || n === "Bip01_Spine2" || n === "Bip01_Spine")) {
          this.spineBone = node;
        }
      }
    });

    const chosen = mesh1 || fallback;
    if (!chosen) {
      console.error("❌ morph target 가진 mesh를 못 찾음");
      return;
    }

    this.headMesh = chosen;
    this.isRocketbox = (chosen.name === "Mesh_1");
    this.nodAxis = this.isRocketbox ? "z" : "x";
    this.swayAxis = this.isRocketbox ? "y" : "z";
    this.breathAxis = this.isRocketbox ? "z" : "x";
    this.morphTargetDictionary = chosen.morphTargetDictionary;
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

    const key = this._resolveMorph(targetName);
    if (key !== null) {
      this.targetMorphValues[key] = value;
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
    this._lastIntensity = finalIntensity;

    const configs = this.useAU ? EMOTION_CONFIGS_AU : EMOTION_CONFIGS;
    const emotionConfig = configs[emotion];
    if (!emotionConfig) {
      console.warn(`Unknown emotion: ${emotion}`);
      return;
    }

    const blendshapes = emotionConfig.blendshapes || {};

    const newEmotionBlendshapes = new Set(
      Object.keys(blendshapes)
        .map((n) => this._resolveMorph(n))
        .filter((k) => k !== null)
    );

    for (let key in this.targetMorphValues) {
      const lower = key.toLowerCase();
      if (
        lower.includes("eyeblink") ||
        lower.includes("eyelook")
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
      const lower = morphName.toLowerCase();
      if (lower.includes("eyeblink")) {
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
          const lower = key.toLowerCase();
          if (lower.includes("eyeblink")) {
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

  setExpressionMode(useAU) {
    if (this.useAU === useAU) return;
    this.useAU = useAU;
    for (let key in this.targetMorphValues) {
      const lower = key.toLowerCase();
      if (lower.includes("eyeblink") || lower.includes("eyelook")) continue;
      this.targetMorphValues[key] = 0;
    }
    this.setEmotion(this.currentEmotion, this._lastIntensity ?? 1.0);
  }

  _resolveMorph(name) {
    if (!this.morphTargetDictionary) return null;
    // 1. RPM
    if (this.morphTargetDictionary[name] !== undefined) return name;
    // 2. alias (Rocketbox AK_)
    const alias = MORPH_ALIASES[name];
    if (alias && this.morphTargetDictionary[alias] !== undefined) return alias;
    return null;
  }
}

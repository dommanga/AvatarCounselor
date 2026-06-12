/**
 * FACS-based Emotion Configurations for AI Avatar Counselor
 * Based on Ekman & Friesen (1978) Facial Action Coding System
 *
 * References:
 * - Ekman, P., & Friesen, W. V. (1978). Facial Action Coding System
 * - ARKit Blendshapes Documentation (Apple Developer)
 * - Ready Player Me Avatar Standard (72 ARKit blendshapes)
 *
 */

export const EMOTION_CONFIGS = {
  // ═══════════════════════════════════════════════════════════════════
  // JOY (HAPPINESS)
  // ═══════════════════════════════════════════════════════════════════
  joy: {
    name: "Joy",
    description: "Warm empathic smile - genuine care for client's good news",
    actionUnits: [6, 12],
    blendshapes: {
      // AU12: Lip Corner Puller
      mouthSmileLeft: 0.45,
      mouthSmileRight: 0.45,
      mouthDimpleLeft: 0.21,
      mouthDimpleRight: 0.21,

      // AU6: Cheek Raiser
      cheekSquintLeft: 0.55,
      cheekSquintRight: 0.55,

      // AU7: Lid Tightener
      eyeSquintLeft: 0.4,
      eyeSquintRight: 0.4,

      browInnerUp: 0.15,
    },
    reference: "Ekman & Friesen (1978) - Duchenne Smile",
  },

  // ═══════════════════════════════════════════════════════════════════
  // SADNESS
  // ═══════════════════════════════════════════════════════════════════
  sadness: {
    name: "Sadness",
    description: "Empathic concern - understanding client's pain",
    actionUnits: [1, 4, 15],
    blendshapes: {
      // AU1+AU4: Sad Eyebrows
      browInnerUp: 0.65,

      // AU15: Lip Corner Depressor
      mouthFrownLeft: 0.5,
      mouthFrownRight: 0.5,

      // Subtle eye
      eyeWideLeft: 0.25,
      eyeWideRight: 0.25,
      eyeSquintLeft: 0.25,
      eyeSquintRight: 0.25,
    },
    reference: "Ekman & Friesen (1978)",
  },

  // ═══════════════════════════════════════════════════════════════════
  // ANGER
  // ═══════════════════════════════════════════════════════════════════
  anger: {
    name: "Anger",
    description: "Supportive validation - understanding client's frustration",
    actionUnits: [4, 5, 7, 23],
    blendshapes: {
      // AU4: Brow Lowerer
      browDownLeft: 0.35,
      browDownRight: 0.35,

      // AU5+AU7: Eye Tension
      eyeSquintLeft: 0.35,
      eyeSquintRight: 0.35,

      // AU23: Lip Tightener
      mouthPressLeft: 0.35,
      mouthPressRight: 0.35,
      mouthFrownLeft: 0.35,
      mouthFrownRight: 0.35,
    },
    reference: "Ekman & Friesen (1978)",
  },

  // ═══════════════════════════════════════════════════════════════════
  // FEAR
  // ═══════════════════════════════════════════════════════════════════
  fear: {
    name: "Fear",
    description: "Calm reassurance - acknowledging client's worry",
    actionUnits: [1, 2, 4, 5, 20],
    blendshapes: {
      // AU1+AU2: Raised Eyebrows
      browInnerUp: 0.55,
      browOuterUpLeft: 0.35,
      browOuterUpRight: 0.35,

      // AU5: Wide Eyes
      eyeWideLeft: 0.25,
      eyeWideRight: 0.25,
    },
    reference: "Ekman & Friesen (1978)",
  },

  // ═══════════════════════════════════════════════════════════════════
  // SURPRISE
  // ═══════════════════════════════════════════════════════════════════
  surprise: {
    name: "Surprise",
    description: "Genuine interest - engaged with client's unexpected news",
    actionUnits: [1, 2, 5, 26],
    blendshapes: {
      // AU1+AU2: Strongly Raised Eyebrows
      browInnerUp: 0.6,
      browOuterUpLeft: 0.6,
      browOuterUpRight: 0.6,

      // AU5: Very Wide Eyes
      eyeWideLeft: 0.5,
      eyeWideRight: 0.5,

      // AU26: Jaw Drop
      jawOpen: 0.25,
      mouthOpen: 0.35,
    },
    reference: "Ekman & Friesen (1978)",
  },

  // ═══════════════════════════════════════════════════════════════════
  // DISGUST
  // ═══════════════════════════════════════════════════════════════════
  disgust: {
    name: "Disgust",
    description:
      "Thoughtful concern - acknowledging difficult or unfair situations",
    actionUnits: [9, 15, 16],
    blendshapes: {
      // AU9: Nose Wrinkler
      noseSneerLeft: 0.25,
      noseSneerRight: 0.25,

      // AU15: Lip Corner Depressor
      mouthFrownLeft: 0.35,
      mouthFrownRight: 0.35,

      // Brow component
      browDownLeft: 0.35,
      browDownRight: 0.35,

      eyeSquintLeft: 0.25,
      eyeSquintRight: 0.25,
    },
    reference: "Ekman & Friesen (1978)",
  },

  // ═══════════════════════════════════════════════════════════════════
  // NEUTRAL (Baseline)
  // ═══════════════════════════════════════════════════════════════════
  neutral: {
    name: "Neutral",
    description: "Resting face, no expression",
    actionUnits: [],
    blendshapes: {},
    reference: "Baseline state",
  },

  serious: {
    name: "Serious",
    description: "Concentrated attentive neutral — Steady base expression",
    actionUnits: [4, 7],
    blendshapes: {
      browDownLeft: 0.1,
      browDownRight: 0.1,
      eyeSquintLeft: 0.18,
      eyeSquintRight: 0.18,
      mouthPressLeft: 0.12,
      mouthPressRight: 0.12,
    },
    reference: "Concentrated neutral (stern evaluator baseline)",
  },
};

/**
 * Helper function: Get dominant emotion from emotion distribution
 * @param {Object} emotions - Object with emotion names as keys and intensities as values
 * @returns {Object} - { emotion: string, intensity: number }
 *
 * Example:
 * getDominantEmotion({ joy: 0.2, sadness: 0.7, anger: 0.1 })
 * // Returns: { emotion: "sadness", intensity: 0.7 }
 */
export function getDominantEmotion(emotions) {
  let maxEmotion = "neutral";
  let maxIntensity = 0;

  for (const [emotion, intensity] of Object.entries(emotions)) {
    if (intensity > maxIntensity && EMOTION_CONFIGS[emotion]) {
      maxIntensity = intensity;
      maxEmotion = emotion;
    }
  }

  return { emotion: maxEmotion, intensity: maxIntensity };
}

/**
 * Helper function: Validate emotion config
 * @param {string} emotion - Emotion name
 * @returns {boolean}
 */
export function isValidEmotion(emotion) {
  return emotion in EMOTION_CONFIGS;
}

/**
 * Helper function: Get all available emotions
 * @returns {string[]}
 */
export function getAvailableEmotions() {
  return Object.keys(EMOTION_CONFIGS);
}

/**
 * LLM-extracted Emotion Label Mappings
 * For parsing natural language emotion descriptions
 */
export const EMOTION_LABELS = {
  // Joy variants
  joy: "joy",
  happy: "joy",
  happiness: "joy",
  excited: "joy",
  pleased: "joy",
  delighted: "joy",
  cheerful: "joy",

  // Sadness variants
  sad: "sadness",
  sadness: "sadness",
  depressed: "sadness",
  down: "sadness",
  unhappy: "sadness",
  miserable: "sadness",
  melancholy: "sadness",

  // Anger variants
  angry: "anger",
  anger: "anger",
  frustrated: "anger",
  annoyed: "anger",
  mad: "anger",
  furious: "anger",
  irritated: "anger",

  // Fear variants
  scared: "fear",
  fear: "fear",
  afraid: "fear",
  anxious: "fear",
  worried: "fear",
  terrified: "fear",
  frightened: "fear",

  // Surprise variants
  surprised: "surprise",
  surprise: "surprise",
  shocked: "surprise",
  amazed: "surprise",
  astonished: "surprise",
  startled: "surprise",

  // Disgust variants
  disgusted: "disgust",
  disgust: "disgust",
  repulsed: "disgust",
  revolted: "disgust",
  nauseated: "disgust",
};

/**
 * Normalize emotion label from LLM output
 * @param {string} label - Raw emotion label from LLM
 * @returns {string} - Normalized emotion name
 */
export function normalizeEmotionLabel(label) {
  const normalized = label.toLowerCase().trim();
  return EMOTION_LABELS[normalized] || "neutral";
}

/**
 * FACS-based Emotion Configurations for AI Avatar Counselor
 * Based on Ekman & Friesen (1978) Facial Action Coding System
 *
 * References:
 * - Ekman, P., & Friesen, W. V. (1978). Facial Action Coding System
 * - ARKit Blendshapes Documentation (Apple Developer)
 * - Ready Player Me Avatar Standard (72 ARKit blendshapes)
 *
 * @version Phase 2.0
 * @date 2025-11-10
 */

/**
 * Emotion Configuration Structure:
 * {
 *   name: string,
 *   actionUnits: number[],           // FACS Action Units
 *   blendshapes: {
 *     blendshapeName: {
 *       base: number,                // Base intensity (0~1)
 *       scale: number                // Scale factor for dynamic adjustment
 *     }
 *   },
 *   duration: number,                // Display duration in seconds
 *   reference: string                // Scientific reference
 * }
 */

export const EMOTION_CONFIGS = {
  // ═══════════════════════════════════════════════════════════════════
  // JOY (HAPPINESS)
  // ═══════════════════════════════════════════════════════════════════
  joy: {
    name: "Joy",
    description: "Duchenne smile - genuine happiness",
    actionUnits: [6, 12], // AU6: Cheek Raiser, AU12: Lip Corner Puller
    blendshapes: {
      // === AU12: Lip Corner Puller (Primary) ===
      mouthSmileLeft: { base: 0.4, scale: 0.3 },
      mouthSmileRight: { base: 0.4, scale: 0.3 },
      mouthDimpleLeft: { base: 0.3, scale: 0.01 },
      mouthDimpleRight: { base: 0.3, scale: 0.01 },

      // === AU6: Cheek Raiser (Orbicularis Oculi) ===
      cheekSquintLeft: { base: 0.5, scale: 0.3 },
      cheekSquintRight: { base: 0.5, scale: 0.3 },

      // === AU7: Lid Tightener (Associated with genuine smile) ===
      eyeSquintLeft: { base: 0.3, scale: 0.2 },
      eyeSquintRight: { base: 0.3, scale: 0.2 },

      browInnerUp: { base: 0.0, scale: 0.15 },
      // mouthOpen: { base: 0.2, scale: 0.1 },
      // jawOpen: { base: 0.0, scale: 0.3 },
    },
    duration: 3.5,
    reference: "Ekman & Friesen (1978) - Duchenne Smile",
  },

  // ═══════════════════════════════════════════════════════════════════
  // SADNESS
  // ═══════════════════════════════════════════════════════════════════
  sadness: {
    name: "Sadness",
    description: "Inner brow raised, lip corners down",
    actionUnits: [1, 4, 15], // AU1+4: Inner Brow Raiser, AU15: Lip Corner Depressor
    blendshapes: {
      // === AU1+AU4: Sad Eyebrows ===
      browInnerUp: { base: 0.35, scale: 0.35 },

      // === AU15: Lip Corner Depressor ===
      mouthFrownLeft: { base: 0.55, scale: 0.3 },
      mouthFrownRight: { base: 0.55, scale: 0.3 },

      // === Additional: Subtle eye ===
      eyeWideLeft: { base: 0.2, scale: 0.15 },
      eyeWideRight: { base: 0.2, scale: 0.15 },
      // eyeSquintLeft: { base: 0.4, scale: 0.15 },
      // eyeSquintRight: { base: 0.4, scale: 0.15 },

      // === Additional: Subtle mouth ===
      // mouthOpen: { base: 0.1, scale: 0.1 },
      // mouthFunnel: { base: 0.1, scale: 0.1 },
    },
    duration: 4.0,
    reference: "Ekman & Friesen (1978)",
  },

  // ═══════════════════════════════════════════════════════════════════
  // ANGER
  // ═══════════════════════════════════════════════════════════════════
  anger: {
    name: "Anger",
    description: "Lowered brows, tightened eyelids, pressed lips",
    actionUnits: [4, 5, 7, 23], // AU4: Brow Lowerer, AU5: Upper Lid Raiser, AU7: Lid Tightener, AU23: Lip Tightener
    blendshapes: {
      // === AU4: Brow Lowerer (Corrugator Supercilii) ===
      browDownLeft: { base: 0.65, scale: 0.35 },
      browDownRight: { base: 0.65, scale: 0.35 },

      // === AU5+AU7: Eye Tension ===
      eyeSquintLeft: { base: 0.45, scale: 0.3 },
      eyeSquintRight: { base: 0.45, scale: 0.3 },

      // === AU23: Lip Tightener ===
      mouthPressLeft: { base: 0.4, scale: 0.3 },
      mouthPressRight: { base: 0.4, scale: 0.3 },
      mouthFrownLeft: { base: 0.55, scale: 0.3 },
      mouthFrownRight: { base: 0.55, scale: 0.3 },

      // === Additional: Jaw tension ===
      jawForward: { base: 0.3, scale: 0.25 },

      // === Nose wrinkle (optional, less common) ===
      noseSneerLeft: { base: 0.25, scale: 0.2 },
      noseSneerRight: { base: 0.25, scale: 0.2 },
    },
    duration: 3.8,
    reference: "Ekman & Friesen (1978)",
  },

  // ═══════════════════════════════════════════════════════════════════
  // FEAR
  // ═══════════════════════════════════════════════════════════════════
  fear: {
    name: "Fear",
    description:
      "Raised and drawn together eyebrows, wide eyes, lips stretched",
    actionUnits: [1, 2, 4, 5, 20], // AU1+2+4: Complex brow pattern, AU5: Upper Lid Raiser, AU20: Lip Stretch
    blendshapes: {
      // === AU1+AU2: Raised Eyebrows ===
      browInnerUp: { base: 0.7, scale: 0.35 },
      browOuterUpLeft: { base: 0.55, scale: 0.3 },
      browOuterUpRight: { base: 0.55, scale: 0.3 },

      // === AU5: Wide Eyes (Upper Lid Raiser) ===
      eyeWideLeft: { base: 0.55, scale: 0.35 },
      eyeWideRight: { base: 0.55, scale: 0.35 },

      // === AU20: Lip Stretch ===
      mouthStretchLeft: { base: 0.35, scale: 0.25 },
      mouthStretchRight: { base: 0.35, scale: 0.25 },

      // === Additional: Slight jaw drop ===
      jawOpen: { base: 0.2, scale: 0.15 },
    },
    duration: 3.5,
    reference: "Ekman & Friesen (1978)",
  },

  // ═══════════════════════════════════════════════════════════════════
  // SURPRISE
  // ═══════════════════════════════════════════════════════════════════
  surprise: {
    name: "Surprise",
    description: "Raised eyebrows, wide eyes, jaw drop",
    actionUnits: [1, 2, 5, 26], // AU1+2: Brow Raisers, AU5: Upper Lid Raiser, AU26: Jaw Drop
    blendshapes: {
      // === AU1+AU2: Strongly Raised Eyebrows ===
      browInnerUp: { base: 0.85, scale: 0.25 },
      browOuterUpLeft: { base: 0.75, scale: 0.25 },
      browOuterUpRight: { base: 0.75, scale: 0.25 },

      // === AU5: Very Wide Eyes ===
      eyeWideLeft: { base: 0.7, scale: 0.3 },
      eyeWideRight: { base: 0.7, scale: 0.3 },

      // === AU26: Jaw Drop ===
      jawOpen: { base: 0.35, scale: 0.25 },
      mouthOpen: { base: 0.45, scale: 0.3 },

      // === Additional: Mouth shape ===
      mouthFunnel: { base: 0.1, scale: 0.2 },
    },
    duration: 2.5, // Surprise is typically brief
    reference: "Ekman & Friesen (1978)",
  },

  // ═══════════════════════════════════════════════════════════════════
  // DISGUST
  // ═══════════════════════════════════════════════════════════════════
  disgust: {
    name: "Disgust",
    description: "Nose wrinkled, upper lip raised, lip corners down",
    actionUnits: [9, 15, 16], // AU9: Nose Wrinkler, AU15: Lip Corner Depressor, AU16: Lower Lip Depressor
    blendshapes: {
      // === AU9: Nose Wrinkler (Levator Labii Superioris Alaeque Nasi) ===
      noseSneerLeft: { base: 0.6, scale: 0.35 },
      noseSneerRight: { base: 0.6, scale: 0.35 },

      // === AU15: Lip Corner Depressor ===
      mouthFrownLeft: { base: 0.4, scale: 0.3 },
      mouthFrownRight: { base: 0.4, scale: 0.3 },

      // === AU16: Lower Lip Depressor ===
      mouthLowerDownLeft: { base: 0.35, scale: 0.25 },
      mouthLowerDownRight: { base: 0.35, scale: 0.25 },

      // === Additional: Upper lip raiser ===
      mouthShrugUpper: { base: 0.4, scale: 0.25 },

      // === Brow component (optional) ===
      browDownLeft: { base: 0.3, scale: 0.2 },
      browDownRight: { base: 0.3, scale: 0.2 },
    },
    duration: 3.0,
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
    duration: 2.0,
    reference: "Baseline state",
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

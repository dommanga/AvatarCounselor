// Emotion-BlendShape Mapping Table
// ARKit blendshapes
export const EMOTION_MAPPINGS = {
  neutral: {
    // default (all zero)
  },

  joy: {
    mouthSmile: 0.7,
    mouthSmileLeft: 0.7,
    mouthSmileRight: 0.7,
    cheekSquintLeft: 0.4,
    cheekSquintRight: 0.4,
    eyeSquintLeft: 0.3,
    eyeSquintRight: 0.3,
  },

  sadness: {
    browInnerUp: 0.6,
    mouthFrownLeft: 0.5,
    mouthFrownRight: 0.5,
    eyeBlinkLeft: 0.3,
    eyeBlinkRight: 0.3,
    mouthLowerDownLeft: 0.3,
    mouthLowerDownRight: 0.3,
  },

  anger: {
    browDownLeft: 0.7,
    browDownRight: 0.7,
    jawForward: 0.4,
    mouthPucker: 0.3,
    noseSneerLeft: 0.4,
    noseSneerRight: 0.4,
    eyeSquintLeft: 0.5,
    eyeSquintRight: 0.5,
  },

  fear: {
    browInnerUp: 0.8,
    browOuterUpLeft: 0.6,
    browOuterUpRight: 0.6,
    eyeWideLeft: 0.6,
    eyeWideRight: 0.6,
    jawOpen: 0.3,
    mouthStretchLeft: 0.3,
    mouthStretchRight: 0.3,
  },

  surprise: {
    browInnerUp: 0.9,
    browOuterUpLeft: 0.8,
    browOuterUpRight: 0.8,
    eyeWideLeft: 0.8,
    eyeWideRight: 0.8,
    jawOpen: 0.5,
    mouthFunnel: 0.4,
  },

  disgust: {
    noseSneerLeft: 0.7,
    noseSneerRight: 0.7,
    mouthShrugUpper: 0.5,
    browDownLeft: 0.4,
    browDownRight: 0.4,
    eyeSquintLeft: 0.4,
    eyeSquintRight: 0.4,
  },
};

// LLM-extracted Emotion-Text Mappings
export const EMOTION_LABELS = {
  joy: "joy",
  happy: "joy",
  happiness: "joy",
  excited: "joy",
  pleased: "joy",

  sad: "sadness",
  sadness: "sadness",
  depressed: "sadness",
  down: "sadness",
  unhappy: "sadness",

  angry: "anger",
  anger: "anger",
  frustrated: "anger",
  annoyed: "anger",
  mad: "anger",

  scared: "fear",
  fear: "fear",
  afraid: "fear",
  anxious: "fear",
  worried: "fear",

  surprised: "surprise",
  surprise: "surprise",
  shocked: "surprise",
  amazed: "surprise",

  disgusted: "disgust",
  disgust: "disgust",
  repulsed: "disgust",
};

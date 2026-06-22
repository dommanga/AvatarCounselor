// FACS Action Unit 버전 (Rocketbox 전용)
// Ekman & Friesen FACS 표준 AU 조합 (Wegrzyn et al. 2017 매핑 기준)

export const EMOTION_CONFIGS_AU = {
  joy: {
    name: "Joy",
    actionUnits: [6, 12, 25],
    blendshapes: {
      AU_06_CheekRaiser: 0.55,        // AU6
      AU_12_LipCornerPuller: 0.75,    // AU12
      AU_25_LipsPart: 0.20,           // AU25 (입 살짝 벌어짐)
    },
  },

  sadness: {
    name: "Sadness",
    actionUnits: [1, 4, 15],
    blendshapes: {
      AU_01_InnerBrowRaiser: 0.65,    // AU1
      AU_04_BrowLowerer: 0.30,        // AU4 (AU1+4 = 슬픈 눈썹)
      AU_15_LipCornerDepressor: 0.50, // AU15
    },
  },

  anger: {
    name: "Anger",
    actionUnits: [4, 5, 7, 23],
    blendshapes: {
      AU_04_BrowLowerer: 0.40,        // AU4
      AU_05_UpperLidRaiser: 0.30,     // AU5
      AU_07_LidTightener: 0.35,       // AU7
      AU_23_LipTightener: 0.35,       // AU23
    },
  },

  fear: {
    name: "Fear",
    actionUnits: [1, 2, 4, 5, 20],
    blendshapes: {
      AU_01_InnerBrowRaiser: 0.55,    // AU1
      AU_02_OuterBrowRaiser: 0.35,    // AU2
      AU_04_BrowLowerer: 0.25,        // AU4
      AU_05_UpperLidRaiser: 0.30,     // AU5
      AU_20_LipStretcher: 0.25,       // AU20
    },
  },

  surprise: {
    name: "Surprise",
    actionUnits: [1, 2, 5, 26],
    blendshapes: {
      AU_01_InnerBrowRaiser: 0.60,    // AU1
      AU_02_OuterBrowRaiser: 0.60,    // AU2
      AU_05_UpperLidRaiser: 0.50,     // AU5
      AU_26_JawDrop: 0.30,            // AU26
    },
  },

  disgust: {
    name: "Disgust",
    actionUnits: [9, 15, 16],
    blendshapes: {
      AU_09_NoseWrinkler: 0.40,       // AU9
      AU_15_LipCornerDepressor: 0.35, // AU15
      AU_16_LowerLipDepressor: 0.25,  // AU16
    },
  },

  neutral: { name: "Neutral", actionUnits: [], blendshapes: {} },

  serious: {
    name: "Serious",
    actionUnits: [4, 7],
    blendshapes: {
      AU_04_BrowLowerer: 0.12,
      AU_07_LidTightener: 0.18,
    },
  },
};
import { EMOTION_MAPPINGS } from "./emotions.js";

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

  setEmotion(emotion) {
    console.log("Setting emotion:", emotion);
    this.currentEmotion = emotion;

    const emotionMapping = EMOTION_MAPPINGS[emotion];
    if (!emotionMapping) {
      console.warn(`Unknown emotion: ${emotion}`);
      return;
    }

    // Reset all morph targets to zero
    for (let key in this.targetMorphValues) {
      this.targetMorphValues[key] = 0;
    }

    // Apply new emotion mapping
    for (let morphName in emotionMapping) {
      this.setMorphTarget(morphName, emotionMapping[morphName]);
    }
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

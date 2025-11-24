/**
 * LipSyncController - Enhanced natural lip sync simulation
 * Uses sine wave patterns and syllable-like rhythms
 */
export class LipSyncController {
  constructor(avatarController) {
    this.avatarController = avatarController;
    this.isActive = false;
    this.animationFrameId = null;

    // Current state
    this.currentJawOpen = 0;
    this.currentMouthOpen = 0;

    // Animation parameters
    this.time = 0;
    this.syllablePhase = 0;
    this.syllableDuration = 0.3; // seconds per syllable
    this.pauseChance = 0.15; // 15% chance of brief pause
    this.isPausing = false;
    this.pauseTimer = 0;

    // Tunable parameters
    this.maxJawOpen = 0.5; // Reduced from 0.9
    this.maxMouthOpen = 0.3; // Added for more natural look
    this.baseSpeed = 0.12; // Smoother interpolation
    this.variationSpeed = 0.08; // Speed for variation
  }

  /**
   * Start natural lip sync simulation
   */
  start() {
    this.isActive = true;
    this.time = 0;
    this.syllablePhase = 0;
    this.animate();
    console.log("👄 Enhanced lip sync started");
  }

  /**
   * Enhanced animation loop - natural speech-like movement
   */
  animate() {
    if (!this.isActive) return;

    const deltaTime = 1 / 60; // Assume 60fps
    this.time += deltaTime;

    // Check for random pauses (like natural speech breaks)
    if (!this.isPausing && Math.random() < this.pauseChance * deltaTime) {
      this.isPausing = true;
      this.pauseTimer = 0.1 + Math.random() * 0.15; // 0.1-0.25 second pause
    }

    if (this.isPausing) {
      this.pauseTimer -= deltaTime;
      if (this.pauseTimer <= 0) {
        this.isPausing = false;
      }

      // Close mouth during pause
      const targetJaw = 0;
      const targetMouth = 0;
      this.currentJawOpen += (targetJaw - this.currentJawOpen) * this.baseSpeed;
      this.currentMouthOpen +=
        (targetMouth - this.currentMouthOpen) * this.baseSpeed;
    } else {
      // Syllable-based movement
      this.syllablePhase += deltaTime / this.syllableDuration;

      if (this.syllablePhase >= 1.0) {
        this.syllablePhase = 0;
        // Vary syllable duration slightly
        this.syllableDuration = 0.25 + Math.random() * 0.2; // 0.25-0.45s
      }

      // Smooth sine wave for syllable (0 → 1 → 0)
      const syllableProgress = Math.sin(this.syllablePhase * Math.PI);

      // Add subtle randomness for variation (reduced amplitude)
      const variation = Math.sin(this.time * 8) * 0.15; // Slower, smaller variation

      // Combine for natural movement
      const intensity = syllableProgress * 0.85 + variation * 0.15;

      // Different movements for jaw and mouth
      const targetJaw = intensity * this.maxJawOpen;
      const targetMouth = intensity * this.maxMouthOpen;

      // Smooth interpolation
      this.currentJawOpen +=
        (targetJaw - this.currentJawOpen) *
        (this.baseSpeed + this.variationSpeed * syllableProgress);
      this.currentMouthOpen +=
        (targetMouth - this.currentMouthOpen) * this.baseSpeed;
    }

    // Update avatar
    this.updateMouth(this.currentJawOpen, this.currentMouthOpen);

    this.animationFrameId = requestAnimationFrame(() => this.animate());
  }

  /**
   * Stop lip sync and close mouth smoothly
   */
  stop() {
    this.isActive = false;

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    // Smoothly close mouth over ~300ms
    const closeMouth = () => {
      if (this.currentJawOpen > 0.01 || this.currentMouthOpen > 0.01) {
        this.currentJawOpen *= 0.5;
        this.currentMouthOpen *= 0.5;
        this.updateMouth(this.currentJawOpen, this.currentMouthOpen);
        requestAnimationFrame(closeMouth);
      } else {
        this.currentJawOpen = 0;
        this.currentMouthOpen = 0;
        this.updateMouth(0, 0);
      }
    };
    closeMouth();

    console.log("👄 Lip sync stopped");
  }

  /**
   * Update mouth blendshapes on avatar
   */
  updateMouth(jawValue, mouthValue) {
    if (this.avatarController && this.avatarController.setMorphTarget) {
      this.avatarController.setMorphTarget("jawOpen", jawValue);
      this.avatarController.setMorphTarget("mouthOpen", mouthValue);

      // Optional: Add subtle smile variation for more natural look
      const smileVariation = Math.sin(this.time * 3) * 0.05;
      if (this.isActive) {
        this.avatarController.setMorphTarget(
          "mouthSmileLeft",
          Math.max(0, smileVariation)
        );
        this.avatarController.setMorphTarget(
          "mouthSmileRight",
          Math.max(0, smileVariation)
        );
      }
    }
  }

  /**
   * Adjust parameters for different speech styles
   */
  setParameters(params) {
    if (params.maxJawOpen !== undefined) this.maxJawOpen = params.maxJawOpen;
    if (params.maxMouthOpen !== undefined)
      this.maxMouthOpen = params.maxMouthOpen;
    if (params.baseSpeed !== undefined) this.baseSpeed = params.baseSpeed;
    if (params.syllableDuration !== undefined)
      this.syllableDuration = params.syllableDuration;
    if (params.pauseChance !== undefined) this.pauseChance = params.pauseChance;
  }

  /**
   * Preset configurations
   */
  static PRESETS = {
    calm: {
      maxJawOpen: 0.4,
      maxMouthOpen: 0.25,
      syllableDuration: 0.35,
      pauseChance: 0.2,
    },
    normal: {
      maxJawOpen: 0.5,
      maxMouthOpen: 0.3,
      syllableDuration: 0.3,
      pauseChance: 0.15,
    },
    expressive: {
      maxJawOpen: 0.65,
      maxMouthOpen: 0.4,
      syllableDuration: 0.25,
      pauseChance: 0.1,
    },
  };

  /**
   * Apply preset configuration
   */
  applyPreset(presetName) {
    const preset = LipSyncController.PRESETS[presetName];
    if (preset) {
      this.setParameters(preset);
      console.log(`👄 Applied lip sync preset: ${presetName}`);
    }
  }
}

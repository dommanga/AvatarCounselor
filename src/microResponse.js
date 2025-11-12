/**
 * MicroResponseController
 *
 * Purpose: Generate subtle facial expressions during user speech (listening mode)
 * Based on sentiment analysis of interim transcripts
 *
 * Key Features:
 * - Lightweight expressions (low intensity)
 * - Short duration (0.5-1.5s)
 * - Frequency control (baseFrequency)
 * - Debouncing to avoid over-triggering
 * - Head nodding synchronized with facial expressions
 */

export class MicroResponseController {
  constructor(avatarController, customization = {}) {
    this.avatarController = avatarController;

    // Customization settings
    this.customization = {
      baseIntensity: customization.baseIntensity || 0.5, // 0.0-1.0
      baseFrequency: customization.baseFrequency || 0.5, // 0.0-1.0
      noddingProbability: 0.9, // chance of nodding
      ...customization,
    };

    // Debouncing
    this._lastTriggerTime = 0;
    this._minTriggerInterval = 2000; // minimum - 2s interval (will be adjusted by baseFrequency)

    this._isActive = false;
    this._currentMicroResponse = null;

    // Head nodding state
    this._noddingInterval = null;
    this._isNodding = false;
  }

  /**
   * Trigger micro response based on sentiment
   * @param {string} sentiment - 'positive', 'negative', or 'neutral'
   */
  trigger(sentiment) {
    // Debounce check
    const now = Date.now();
    const adjustedInterval =
      this._minTriggerInterval / this.customization.baseFrequency;

    if (now - this._lastTriggerTime < adjustedInterval) {
      console.log(`⏭️ Micro response debounced (${sentiment})`);
      return;
    }

    this._lastTriggerTime = now;

    // Get micro response config
    const microConfig = this._getMicroResponseConfig(sentiment);
    if (!microConfig) {
      console.warn(`Unknown sentiment: ${sentiment}`);
      return;
    }

    console.log(
      `😊 Micro response triggered: ${sentiment} (${microConfig.name})`
    );

    // Apply micro response
    this._applyMicroResponse(microConfig);
  }

  /**
   * Get micro response configuration for sentiment
   * @param {string} sentiment
   * @returns {Object} Micro response config
   */
  _getMicroResponseConfig(sentiment) {
    const configs = {
      positive: {
        name: "Gentle Smile",
        blendshapes: {
          mouthSmile: { value: 0.3 },
          eyeSquintLeft: { value: 0.15 },
          eyeSquintRight: { value: 0.15 },
          browInnerUp: { value: 0.1 },
        },
        duration: 1.5,
        // Head nodding config
        nodding: {
          count: 2, // Number of nods
          speed: 0.4, // Faster for positive
        },
      },

      negative: {
        name: "Empathetic Concern",
        blendshapes: {
          mouthFrownLeft: { value: 0.35 },
          mouthFrownRight: { value: 0.35 },
          browInnerUp: { value: 0.3 },
          eyeWideLeft: { value: 0.2 },
          eyeWideRight: { value: 0.2 },
        },
        duration: 1.8,
        // Head nodding config
        nodding: {
          count: 2, // Fewer nods for negative
          speed: 0.6, // Slower for empathy
        },
      },

      neutral: {
        name: "Attentive Listening",
        blendshapes: {
          mouthSmile: { value: 0.15 },
          browInnerUp: { value: 0.08 },
        },
        duration: 1.2,
        // Head nodding config
        nodding: {
          count: 1,
          speed: 0.45,
        },
      },
    };

    return configs[sentiment];
  }

  /**
   * Apply micro response to avatar
   * @param {Object} microConfig
   */
  _applyMicroResponse(microConfig) {
    this._isActive = true;
    this._currentMicroResponse = microConfig;

    // Apply blendshapes with intensity adjustment
    for (const [blendshapeName, params] of Object.entries(
      microConfig.blendshapes
    )) {
      const adjustedValue = params.value * this.customization.baseIntensity;
      this.avatarController.setMorphTarget(blendshapeName, adjustedValue);
    }

    // Start head nodding (with probability check)
    if (
      microConfig.nodding &&
      Math.random() < this.customization.noddingProbability
    ) {
      setTimeout(() => {
        this._startHeadNodding(microConfig.nodding);
      });
    }

    // Auto-fade after duration
    setTimeout(() => {
      this._fadeToNeutral(microConfig.duration * 0.6);
    }, microConfig.duration * 1000);
  }

  /**
   * Start head nodding animation
   * @param {Object} noddingConfig - { count, speed }
   */
  _startHeadNodding(noddingConfig) {
    if (this._isNodding) {
      console.log("⏭️ Nodding already in progress, skipping new trigger");
      return;
    }

    const headBone = this.avatarController.getHeadBone();
    if (!headBone) {
      console.warn("⚠️ Head bone not available for nodding");
      return;
    }

    this._isNodding = true;

    // Nodding parameters
    const { count, speed } = noddingConfig;
    const baseIntensity = this.customization.baseIntensity;

    // Rotation range: -2° to 10° (asymmetric, more downward)
    const minRotation = -2 * (Math.PI / 180) * baseIntensity;
    const maxRotation = 8 * (Math.PI / 180) * baseIntensity;

    let currentNod = 0;
    const stepsPerNod = 20;
    let currentStep = 0;

    console.log(`👤 Starting head nodding (${count} nods, speed: ${speed})`);

    this._noddingInterval = setInterval(() => {
      currentStep++;

      // Progress within current nod (0 → 1)
      const nodProgress = (currentStep % stepsPerNod) / stepsPerNod;

      // Smoothstep function for smooth start and end (sigmoid-like)
      // Goes from 0 → 1 → 0 with smooth transitions at both ends
      const smoothValue =
        nodProgress < 0.5
          ? 2 * nodProgress * nodProgress // Ease in (0 → 0.5)
          : 1 - 2 * (1 - nodProgress) * (1 - nodProgress); // Ease out (0.5 → 1)

      // Map to sine-like range (0 → 1 → 0)
      const easeValue = Math.sin(smoothValue * Math.PI);

      // Fade out the last nod
      const nodFadeFactor =
        currentNod === count - 1
          ? 1 - ((currentStep % stepsPerNod) / stepsPerNod) * 0.3 // Last nod: reduce by 30%
          : 1.0;

      // Calculate rotation: starts at 0, goes down (positive rotation in X)
      const rotationX =
        (minRotation + (maxRotation - minRotation) * easeValue) * nodFadeFactor;

      // Apply rotation
      headBone.rotation.x = rotationX;

      // Move to next nod
      if (currentStep % stepsPerNod === 0) {
        currentNod++;

        // Stop after all nods complete
        if (currentNod >= count) {
          clearInterval(this._noddingInterval);
          this._noddingInterval = null;
          this._isNodding = false;

          console.log("👤 Head nodding complete");
        }
      }
    }, speed * 100); // Speed multiplier (smaller = faster)
  }

  /**
   * Fade micro response to neutral
   * @param {number} fadeDuration - Fade duration in seconds
   */
  _fadeToNeutral(fadeDuration = 0.3) {
    if (!this._currentMicroResponse) return;

    console.log(`😐 Micro response fading to neutral (${fadeDuration}s)`);

    // Gradual fadeout (20 steps)
    const steps = 20;
    const stepDuration = (fadeDuration * 1000) / steps;
    let currentStep = 0;

    // Store current blendshapes value
    const initialValues = {};
    for (const [blendshapeName, params] of Object.entries(
      this._currentMicroResponse.blendshapes
    )) {
      initialValues[blendshapeName] =
        params.value * this.customization.baseIntensity;
    }

    const fadeInterval = setInterval(() => {
      currentStep++;
      const progress = currentStep / steps; // 0 → 1

      for (const [blendshapeName, initialValue] of Object.entries(
        initialValues
      )) {
        const targetValue = initialValue * (1 - progress);
        this.avatarController.setMorphTarget(blendshapeName, targetValue);
      }

      // Fade complete
      if (currentStep >= steps) {
        clearInterval(fadeInterval);

        // Finally, 0 value
        for (const blendshapeName of Object.keys(
          this._currentMicroResponse.blendshapes
        )) {
          this.avatarController.setMorphTarget(blendshapeName, 0);
        }

        this._isActive = false;
        this._currentMicroResponse = null;
      }
    }, stepDuration);
  }

  /**
   * Stop any active micro response immediately
   */
  stop() {
    if (!this._currentMicroResponse) return;

    console.log("ℹ️ Stopping micro response");

    // Stop head nodding
    if (this._noddingInterval) {
      clearInterval(this._noddingInterval);
      this._noddingInterval = null;
    }

    // Reset head rotation
    const headBone = this.avatarController.getHeadBone();
    if (headBone) {
      headBone.rotation.x = 0;
      headBone.rotation.y = 0;
    }

    this._isNodding = false;

    // Immediate reset of facial expressions
    for (const blendshapeName of Object.keys(
      this._currentMicroResponse.blendshapes
    )) {
      this.avatarController.setMorphTarget(blendshapeName, 0);
    }

    this._isActive = false;
    this._currentMicroResponse = null;
  }

  /**
   * Update customization settings
   * @param {Object} newCustomization
   */
  updateCustomization(newCustomization) {
    this.customization = {
      ...this.customization,
      ...newCustomization,
    };

    console.log("⚙️ Micro response customization updated:", this.customization);
  }

  /**
   * Check if micro response is currently active
   * @returns {boolean}
   */
  isActive() {
    return this._isActive;
  }

  /**
   * Check if head is currently nodding
   * @returns {boolean}
   */
  isNodding() {
    return this._isNodding;
  }
}

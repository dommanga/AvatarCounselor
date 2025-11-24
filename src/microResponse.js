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
      baseIntensity: customization.baseIntensity || 0.75, // 0.3-1.2
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

    // Track active intervals for cleanup
    this._activeIntervals = new Set();

    this._autoFadeTimeout = null;
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
          mouthSmileLeft: { value: 0.3 },
          mouthSmileRight: { value: 0.3 },
          eyeSquintLeft: { value: 0.2 },
          eyeSquintRight: { value: 0.2 },
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
    this._autoFadeTimeout = setTimeout(() => {
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

    // Track this interval
    this._activeIntervals.add(this._noddingInterval);
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
        this._activeIntervals.delete(fadeInterval);

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

    this._activeIntervals.add(fadeInterval);
  }

  /**
   * Stop immediately without fade (for instant transition to full response)
   */
  stopImmediate() {
    // Cancel auto-fade timeout
    if (this._autoFadeTimeout) {
      clearTimeout(this._autoFadeTimeout);
      this._autoFadeTimeout = null;
    }

    // Clear all active intervals
    for (const interval of this._activeIntervals) {
      clearInterval(interval);
    }
    this._activeIntervals.clear();

    // Stop head nodding interval (but let rotation naturally return to 0 via IdleAnimation)
    if (this._noddingInterval) {
      clearInterval(this._noddingInterval);
      this._noddingInterval = null;
    }
    this._isNodding = false;

    // Mark as inactive but DON'T reset blendshapes to 0
    // Full response will smoothly overwrite them via avatar's interpolation
    if (this._currentMicroResponse) {
      this._isActive = false;
      this._currentMicroResponse = null;
    }

    console.log(
      "⚡ Micro response stopped immediately (blendshapes preserved for smooth transition)"
    );
  }

  /**
   * Stop any active micro response with smooth fadeout
   * Returns a Promise that resolves when all fadeouts are complete
   * @param {number} fadeDuration - Fade duration in seconds (default: 0.3s)
   * @returns {Promise} Resolves when stop is complete
   */
  stop(fadeDuration = 0.3) {
    return new Promise((resolve) => {
      // Cancel auto-fade timeout
      if (this._autoFadeTimeout) {
        clearTimeout(this._autoFadeTimeout);
        this._autoFadeTimeout = null;
      }

      // If nothing active, resolve immediately
      if (!this._currentMicroResponse && !this._isNodding) {
        resolve();
        return;
      }

      console.log(`ℹ️ Stopping micro response with ${fadeDuration}s fade`);

      // Clear all active intervals immediately
      for (const interval of this._activeIntervals) {
        clearInterval(interval);
      }
      this._activeIntervals.clear();

      // Stop head nodding interval
      if (this._noddingInterval) {
        clearInterval(this._noddingInterval);
        this._noddingInterval = null;
      }

      // Track completion of both fadeouts
      const fadePromises = [];

      // Smooth fadeout for head rotation
      const headBone = this.avatarController.getHeadBone();
      if (headBone && this._isNodding) {
        const headFadePromise = new Promise((resolveHead) => {
          const initialRotationX = headBone.rotation.x;
          const initialRotationY = headBone.rotation.y;

          const steps = 10;
          const stepDuration = (fadeDuration * 1000) / steps;
          let currentStep = 0;

          const rotationFadeInterval = setInterval(() => {
            currentStep++;
            const progress = currentStep / steps; // 0 → 1

            headBone.rotation.x = initialRotationX * (1 - progress);

            if (currentStep >= steps) {
              clearInterval(rotationFadeInterval);
              headBone.rotation.x = 0;
              resolveHead();
            }
          }, stepDuration);
        });
        fadePromises.push(headFadePromise);
      }

      this._isNodding = false;

      // Smooth fadeout for facial expressions
      if (this._currentMicroResponse) {
        const faceFadePromise = new Promise((resolveFace) => {
          const steps = 15;
          const stepDuration = (fadeDuration * 1000) / steps;
          let currentStep = 0;

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

              // Final reset to 0
              for (const blendshapeName of Object.keys(
                this._currentMicroResponse.blendshapes
              )) {
                this.avatarController.setMorphTarget(blendshapeName, 0);
              }

              this._isActive = false;
              this._currentMicroResponse = null;
              resolveFace();
            }
          }, stepDuration);
        });
        fadePromises.push(faceFadePromise);
      }

      // Resolve when all fadeouts complete
      if (fadePromises.length > 0) {
        Promise.all(fadePromises).then(() => {
          console.log("✅ Micro response stop complete");
          resolve();
        });
      } else {
        this._isActive = false;
        this._currentMicroResponse = null;
        resolve();
      }
    });
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

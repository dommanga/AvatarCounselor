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
      baseFrequency: customization.baseFrequency || 0.5, // 0.2-1.0
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

    this.nodAxis = this.avatarController.nodAxis || "x";
    this._eyeCompensationFactor = customization.eyeCompensationFactor ?? 0.6;
    this._currentEyeCompensation = 0;
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
      // console.log(`⏭️ Micro response debounced`);
      return;
    }

    if (this._isActive) {
      // console.log(`Micro response not ended - debounced`);
      return;
    }

    this._lastTriggerTime = now;

    const microConfig = this._getMicroResponseConfig(sentiment);
    if (!microConfig) {
      console.warn(`Unknown sentiment: ${sentiment}`);
      return;
    }

    console.log(`😊 Listening with emotion: ${sentiment}`);
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
          mouthSmileLeft: { value: 0.45 },
          mouthSmileRight: { value: 0.45 },
          eyeSquintLeft: { value: 0.3 },
          eyeSquintRight: { value: 0.3 },
          browInnerUp: { value: 0.15 },
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
          mouthFrownLeft: { value: 0.45 },
          mouthFrownRight: { value: 0.45 },
          browInnerUp: { value: 0.4 },
          eyeWideLeft: { value: 0.3 },
          eyeWideRight: { value: 0.3 },
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
          mouthSmileLeft: { value: 0.15 },
          mouthSmileRight: { value: 0.15 },
          browInnerUp: { value: 0.08 },
        },
        duration: 1.2,
        // Head nodding config
        nodding: {
          count: 2,
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
      let nodConfig = microConfig.nodding;
      if (Math.random() < 0.25) {
        nodConfig = {
          ...microConfig.nodding,
          count: Math.floor(Math.random() * 2) + 2, // 2 or 3
        };
      }
      setTimeout(() => {
        this._startHeadNodding(nodConfig);
      });
    }

    // Auto-fade after duration
    this._autoFadeTimeout = setTimeout(() => {
      this._fadeToNeutral(microConfig.duration);
    }, microConfig.duration * 1000);
  }

  /**
   * Start head nodding animation
   * @param {Object} noddingConfig - { count, speed }
   */
  _startHeadNodding(noddingConfig) {
    if (this._isNodding) return;

    const headBone = this.avatarController.getHeadBone();
    if (!headBone) {
      console.warn("⚠️ Head bone not available for nodding");
      return;
    }

    this._isNodding = true;

    const startRotation = headBone.rotation[this.nodAxis];

    const { count, speed } = noddingConfig;
    const baseIntensity = this.customization.baseIntensity;

    const minRotation = -2 * (Math.PI / 180) * baseIntensity;
    const maxRotation = 8 * (Math.PI / 180) * baseIntensity;

    // 60fps 고정 — 한 nod에 걸리는 시간(ms)으로 속도 제어
    const FRAME_MS = 16;
    const nodDurationMs = speed * 100 * 20; // 기존 (speed*100)*stepsPerNod 와 동일한 총 시간
    const totalDurationMs = nodDurationMs * count;

    const startTime = performance.now();

    this._noddingInterval = setInterval(() => {
      const elapsed = performance.now() - startTime;
      const globalProgress = Math.min(elapsed / totalDurationMs, 1); // 0 → 1 전체

      // 현재 몇 번째 nod인지, 그 안에서의 진행도
      const nodFloat = (elapsed / nodDurationMs);
      const currentNod = Math.floor(nodFloat);
      const nodProgress = Math.min(nodFloat - currentNod, 1); // 0 → 1 이번 nod 내

      // smoothstep → sine
      const smoothValue =
        nodProgress < 0.5
          ? 2 * nodProgress * nodProgress
          : 1 - 2 * (1 - nodProgress) * (1 - nodProgress);
      const easeValue = Math.sin(smoothValue * Math.PI);

      // 마지막 nod는 끝으로 갈수록 0까지 수렴 (jump 방지)
      const nodFadeFactor =
        currentNod === count - 1
          ? (1 - nodProgress) // 1 → 0 으로 완전히 감쇠
          : 1.0;

      const rotationX =
        (minRotation + (maxRotation - minRotation) * easeValue) * nodFadeFactor;

      const BLEND_IN_MS = 150;
      const blendProgress = Math.min(elapsed / BLEND_IN_MS, 1);
      const blendedRotation = startRotation * (1 - blendProgress) + rotationX * blendProgress;

      headBone.rotation[this.nodAxis] = blendedRotation;

      const eyeComp = Math.max(0, rotationX / maxRotation) * this._eyeCompensationFactor;
      this._currentEyeCompensation = eyeComp;
      this.avatarController.setMorphTargetImmediate("eyeLookUpLeft", eyeComp);
      this.avatarController.setMorphTargetImmediate("eyeLookUpRight", eyeComp);

      // 전체 완료
      if (globalProgress >= 1) {
        clearInterval(this._noddingInterval);
        this._noddingInterval = null;
        this._isNodding = false;

        // head를 명시적으로 0 복귀 (jump 방지)
        headBone.rotation[this.nodAxis] = 0;

        this.avatarController.setMorphTarget("eyeLookUpLeft", 0);
        this.avatarController.setMorphTarget("eyeLookUpRight", 0);
        this._currentEyeCompensation = 0;
      }
    }, FRAME_MS);

    this._activeIntervals.add(this._noddingInterval);
  }

  /**
   * Fade micro response to neutral
   * @param {number} fadeDuration - Fade duration in seconds
   */
  _fadeToNeutral(fadeDuration = 0.3) {
    if (!this._currentMicroResponse) return;

    // console.log(`😐 Micro response fading to neutral (${fadeDuration}s)`);

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

    this.avatarController.setMorphTarget("eyeLookUpLeft", 0);
    this.avatarController.setMorphTarget("eyeLookUpRight", 0);
    this._currentEyeCompensation = 0;

    // Mark as inactive but DON'T reset blendshapes to 0
    // Full response will smoothly overwrite them via avatar's interpolation
    if (this._currentMicroResponse) {
      this._isActive = false;
      this._currentMicroResponse = null;
    }

    // console.log(
    //   "⚡ Micro response stopped immediately (blendshapes preserved for smooth transition)"
    // );
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

      // console.log(`ℹ️ Stopping micro response with ${fadeDuration}s fade`);

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
          const initialRotation = headBone.rotation[this.nodAxis];
          const initialEyeComp = this._currentEyeCompensation;

          const steps = 10;
          const stepDuration = (fadeDuration * 1000) / steps;
          let currentStep = 0;

          const rotationFadeInterval = setInterval(() => {
            currentStep++;
            const progress = currentStep / steps; // 0 → 1

            headBone.rotation[this.nodAxis] = initialRotation * (1 - progress);

            const eyeComp = initialEyeComp * (1 - progress);
            this.avatarController.setMorphTarget("eyeLookUpLeft", eyeComp);
            this.avatarController.setMorphTarget("eyeLookUpRight", eyeComp);

            if (currentStep >= steps) {
              clearInterval(rotationFadeInterval);
              headBone.rotation[this.nodAxis] = 0;

              this.avatarController.setMorphTarget("eyeLookUpLeft", 0);
              this.avatarController.setMorphTarget("eyeLookUpRight", 0);
              this._currentEyeCompensation = 0;
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
          // console.log("✅ Micro response stop complete");
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

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
 */

export class MicroResponseController {
  constructor(avatarController, customization = {}) {
    this.avatarController = avatarController;

    // Customization settings
    this.customization = {
      baseIntensity: customization.baseIntensity || 0.7, // 0.0-1.5
      baseFrequency: customization.baseFrequency || 1.0, // 0.0-2.0
      ...customization,
    };

    // Debouncing
    this._lastTriggerTime = 0;
    this._minTriggerInterval = 2000; // minimum - 2s interval (will be adjusted by baseFrequency)

    this._isActive = false;
    this._currentMicroResponse = null;
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
      console.log(`⏭️  Micro response debounced (${sentiment})`);
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
          // Subtle eye smile
          eyeSquintLeft: { value: 0.15 },
          eyeSquintRight: { value: 0.15 },
          // Slight brow raise (interest)
          browInnerUp: { value: 0.1 },
        },
        duration: 1.0, // seconds
      },

      negative: {
        name: "Empathetic Concern",
        blendshapes: {
          // Slight frown
          mouthFrownLeft: { value: 0.25 },
          mouthFrownRight: { value: 0.25 },
          // Concerned brows
          browInnerUp: { value: 0.3 },
          browOuterUpLeft: { value: 0.2 },
          browOuterUpRight: { value: 0.2 },
          // Eye expression
          eyeWideLeft: { base: 0.2, scale: 0.15 },
          eyeWideRight: { base: 0.2, scale: 0.15 },
          // Slight mouth press (empathy)
          mouthPressLeft: { value: 0.15 },
          mouthPressRight: { value: 0.15 },
        },
        duration: 1.2,
      },

      neutral: {
        name: "Attentive Listening",
        blendshapes: {
          // Very subtle smile
          mouthSmile: { value: 0.15 },
          // Slight brow raise (attention)
          browInnerUp: { value: 0.08 },
        },
        duration: 0.8,
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

    // Auto-fade after duration
    setTimeout(() => {
      this._fadeToNeutral(microConfig.duration * 0.3);
    }, microConfig.duration * 1000);
  }

  /**
   * Fade micro response to neutral
   * @param {number} fadeDuration - Fade duration in seconds
   */
  _fadeToNeutral(fadeDuration = 0.3) {
    if (!this._currentMicroResponse) return;

    console.log(`😐 Micro response fading to neutral (${fadeDuration}s)`);

    // Reset all blendshapes to 0
    for (const blendshapeName of Object.keys(
      this._currentMicroResponse.blendshapes
    )) {
      this.avatarController.setMorphTarget(blendshapeName, 0);
    }

    this._isActive = false;
    this._currentMicroResponse = null;
  }

  /**
   * Stop any active micro response immediately
   */
  stop() {
    if (!this._currentMicroResponse) return;

    console.log("⏹️  Stopping micro response");

    // Immediate reset
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

    console.log(
      "⚙️  Micro response customization updated:",
      this.customization
    );
  }

  /**
   * Check if micro response is currently active
   * @returns {boolean}
   */
  isActive() {
    return this._isActive;
  }
}

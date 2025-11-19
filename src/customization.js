/**
 * CustomizationManager
 *
 * Purpose: Manage user customization settings for avatar responses
 * - Base Intensity: Expression strength (0.0-1.0)
 * - Base Frequency: Micro response frequency (0.0-1.0)
 *
 * Features:
 * - Real-time updates
 * - localStorage persistence
 * - Event-driven notifications to other modules
 */

export class CustomizationManager {
  constructor() {
    // Default values (normalized 0.0-1.0)
    this.settings = {
      baseIntensity: 0.5,
      baseFrequency: 0.5,
    };

    // Load from localStorage if exists
    this.loadSettings();

    // Listeners for settings changes
    this.listeners = [];
  }

  /**
   * Load settings from localStorage
   */
  loadSettings() {
    try {
      const saved = localStorage.getItem("avatarCustomization");
      if (saved) {
        const parsed = JSON.parse(saved);
        this.settings = {
          baseIntensity: this.clamp(parsed.baseIntensity ?? 0.5, 0, 1),
          baseFrequency: this.clamp(parsed.baseFrequency ?? 0.5, 0, 1),
        };
        console.log("✅ Loaded customization settings:", this.settings);
      }
    } catch (e) {
      console.warn("⚠️ Failed to load settings from localStorage:", e);
    }
  }

  /**
   * Save settings to localStorage
   */
  saveSettings() {
    try {
      localStorage.setItem(
        "avatarCustomization",
        JSON.stringify(this.settings)
      );
      console.log("💾 Saved customization settings:", this.settings);
    } catch (e) {
      console.error("❌ Failed to save settings:", e);
    }
  }

  /**
   * Update base intensity
   * @param {number} value - 0.0 to 1.0
   */
  setBaseIntensity(value) {
    const clamped = this.clamp(value, 0, 1);
    if (this.settings.baseIntensity !== clamped) {
      this.settings.baseIntensity = clamped;
      this.saveSettings();
      this.notifyListeners("baseIntensity", clamped);
      console.log(`⚙️ Base Intensity updated: ${clamped.toFixed(2)}`);
    }
  }

  /**
   * Update base frequency
   * @param {number} value - 0.0 to 1.0
   */
  setBaseFrequency(value) {
    const clamped = this.clamp(value, 0, 1);
    if (this.settings.baseFrequency !== clamped) {
      this.settings.baseFrequency = clamped;
      this.saveSettings();
      this.notifyListeners("baseFrequency", clamped);
      console.log(`⚙️ Base Frequency updated: ${clamped.toFixed(2)}`);
    }
  }

  /**
   * Get actual intensity for avatar application (0.5-1.5)
   * @returns {number} Actual intensity multiplier
   */
  getActualIntensity() {
    // 0.0 → 0.5, 0.5 → 1.0, 1.0 → 1.5
    return 0.5 + this.settings.baseIntensity;
  }

  /**
   * Get normalized settings for UI (0.0-1.0)
   */
  getSettings() {
    return { ...this.settings };
  }

  /**
   * Get settings with actual intensity for application
   */
  getActualSettings() {
    return {
      baseIntensity: this.getActualIntensity(),
      baseFrequency: this.settings.baseFrequency,
    };
  }

  /**
   * Register a listener for settings changes
   * @param {Function} callback - (settingName, newValue) => void
   */
  addListener(callback) {
    this.listeners.push(callback);
  }

  /**
   * Remove a listener
   * @param {Function} callback
   */
  removeListener(callback) {
    this.listeners = this.listeners.filter((l) => l !== callback);
  }

  /**
   * Notify all listeners about settings change
   * @param {string} settingName
   * @param {number} newValue
   */
  notifyListeners(settingName, newValue) {
    this.listeners.forEach((listener) => {
      try {
        listener(settingName, newValue);
      } catch (e) {
        console.error("❌ Error in customization listener:", e);
      }
    });
  }

  /**
   * Clamp value between min and max
   * @param {number} value
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  /**
   * Reset to default settings
   */
  resetToDefaults() {
    this.settings = {
      baseIntensity: 0.5,
      baseFrequency: 0.5,
    };
    this.saveSettings();
    this.notifyListeners("reset", null);
    console.log("🔄 Reset to default settings");
  }
}

/**
 * CustomizationManager
 *
 * Actual ranges:
 * - baseIntensity: 0.3-1.2 (stored and used directly)
 * - baseFrequency: 0.2-1.0
 */
export class CustomizationManager {
  constructor() {
    // Default values (actual values, not normalized)
    this.settings = {
      baseIntensity: 0.75,
      baseFrequency: 0.6,
    };

    // Load from localStorage if exists
    // this.loadSettings();

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
          baseIntensity: this.clamp(parsed.baseIntensity ?? 0.75, 0.3, 1.2),
          baseFrequency: this.clamp(parsed.baseFrequency ?? 0.6, 0, 1),
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
   * @param {number} value - 0.3 to 1.2 (actual value)
   */
  setBaseIntensity(value) {
    const clamped = this.clamp(value, 0.3, 1.2);
    if (this.settings.baseIntensity !== clamped) {
      this.settings.baseIntensity = clamped;
      // this.saveSettings();
      this.notifyListeners("baseIntensity", clamped);
    }
  }

  /**
   * Update base frequency
   * @param {number} value - 0.2 to 1.0
   */
  setBaseFrequency(value) {
    const clamped = this.clamp(value, 0, 1);
    if (this.settings.baseFrequency !== clamped) {
      this.settings.baseFrequency = clamped;
      // this.saveSettings();
      this.notifyListeners("baseFrequency", clamped);
    }
  }

  /**
   * Get settings (no conversion needed)
   */
  getSettings() {
    return { ...this.settings };
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
      baseIntensity: 0.75,
      baseFrequency: 0.6,
    };
    // this.saveSettings();
    this.notifyListeners("reset", null);
    console.log("🔄 Reset to default settings");
  }
}

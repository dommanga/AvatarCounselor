/**
 * IdleAnimationController
 *
 * Manages natural idle movements for the avatar:
 * 1. Eye Blink - Random blinking (2-6 seconds interval)
 * 2. Eye Gaze - Subtle eye tremor (always active)
 * 3. Eye Movement - Occasional gaze shift (10-20 seconds)
 * 4. Breathing
 * 5. Head sway - y-axis movement
 */

export class IdleAnimationController {
  constructor(avatarController) {
    this.avatarController = avatarController;

    // Blink state
    this.blinkInterval = null;
    this.isBlinking = false;

    // Gaze state (subtle tremor)
    this.gazeUpdateInterval = null;
    this.currentGaze = { up: 0, left: 0 };

    // Eye movement state (occasional shift)
    this.movementInterval = null;
    this.isMoving = false;
    this.currentLookTarget = { up: 0, left: 0 };

    // Breathing state
    this.breathingInterval = null;
    this.currentBreathPhase = 0;

    // Head sway state
    this.swayInterval = null;
    this.currentSwayTarget = 0;
    this.currentSwayValue = 0;

    // Configuration
    this.config = {
      // Blink
      blinkMinInterval: 2000, // Min 2 seconds
      blinkMaxInterval: 6000, // Max 6 seconds
      blinkDuration: 150, // 150ms blink

      // Gaze (subtle tremor)
      gazeUpdateRate: 100, // Update every 100ms
      gazeIntensity: 0.05, // Max ±0.05 range

      // Movement (occasional shift)
      movementMinInterval: 10000, // Min 10 seconds
      movementMaxInterval: 15000, // Max 20 seconds
      movementDuration: 1500, // Hold for 1.5 seconds
      movementIntensity: 0.3, // Max ±0.3 range

      // Breathing config
      breathingRate: 4000, // 4 seconds per breath cycle
      breathingIntensity: 0.05, // Jaw opening amount

      // Head sway config
      swayUpdateRate: 80, // Update every 50ms
      swayChangeInterval: 6000, // Change direction every 8 seconds
      swayIntensity: 0.1, // Max ±0.15 radians (~8.6 degrees)
    };
  }

  /**
   * Start all idle movement behaviors
   */
  start() {
    console.log("🧍 Starting idle movements");
    this.startBlinking();
    this.startGaze();
    this.startMovement();
    this.startBreathing();
    this.startHeadSway();
  }

  /**
   * Stop all idle movement behaviors
   */
  stop() {
    console.log("🧍 Stopping idle movements");
    this.stopBlinking();
    this.stopGaze();
    this.stopMovement();
    this.stopBreathing();
    this.stopHeadSway();
  }

  // ═══════════════════════════════════════════════════════════
  // Eye Blink
  // ═══════════════════════════════════════════════════════════

  startBlinking() {
    this.scheduleNextBlink();
  }

  scheduleNextBlink() {
    const interval = this.randomBetween(
      this.config.blinkMinInterval,
      this.config.blinkMaxInterval
    );

    this.blinkInterval = setTimeout(() => {
      this.blink();
      this.scheduleNextBlink(); // Schedule next
    }, interval);
  }

  blink() {
    if (this.isBlinking) return;

    this.isBlinking = true;

    // Close eyes
    this.avatarController.setMorphTarget("eyeBlinkLeft", 1.0);
    this.avatarController.setMorphTarget("eyeBlinkRight", 1.0);

    // Open after duration
    setTimeout(() => {
      this.avatarController.setMorphTarget("eyeBlinkLeft", 0);
      this.avatarController.setMorphTarget("eyeBlinkRight", 0);
      this.isBlinking = false;
    }, this.config.blinkDuration);
  }

  stopBlinking() {
    if (this.blinkInterval) {
      clearTimeout(this.blinkInterval);
      this.blinkInterval = null;
    }

    // Reset blink
    this.avatarController.setMorphTarget("eyeBlinkLeft", 0);
    this.avatarController.setMorphTarget("eyeBlinkRight", 0);
    this.isBlinking = false;
  }

  // ═══════════════════════════════════════════════════════════
  // Eye Gaze (Subtle Tremor)
  // ═══════════════════════════════════════════════════════════

  startGaze() {
    this.gazeUpdateInterval = setInterval(() => {
      this.updateGaze();
    }, this.config.gazeUpdateRate);
  }

  updateGaze() {
    // Don't update gaze during eye movement
    if (this.isMoving) return;

    // Subtle random tremor
    const targetUp = this.randomBetween(
      -this.config.gazeIntensity,
      this.config.gazeIntensity
    );
    const targetLeft = this.randomBetween(
      -this.config.gazeIntensity,
      this.config.gazeIntensity
    );

    // Smooth interpolation
    this.currentGaze.up += (targetUp - this.currentGaze.up) * 0.3;
    this.currentGaze.left += (targetLeft - this.currentGaze.left) * 0.3;

    // Apply to avatar (only if not moving)
    if (!this.isMoving) {
      this.applyEyeLook(this.currentGaze.up, this.currentGaze.left);
    }
  }

  stopGaze() {
    if (this.gazeUpdateInterval) {
      clearInterval(this.gazeUpdateInterval);
      this.gazeUpdateInterval = null;
    }

    // Reset gaze
    this.currentGaze = { up: 0, left: 0 };
    this.applyEyeLook(0, 0);
  }

  // ═══════════════════════════════════════════════════════════
  // Eye Movement (Occasional Gaze Shift)
  // ═══════════════════════════════════════════════════════════

  startMovement() {
    this.scheduleNextMovement();
  }

  scheduleNextMovement() {
    const interval = this.randomBetween(
      this.config.movementMinInterval,
      this.config.movementMaxInterval
    );

    this.movementInterval = setTimeout(() => {
      this.performEyeMovement();
      this.scheduleNextMovement(); // Schedule next
    }, interval);
  }

  performEyeMovement() {
    if (this.isMoving) return;

    this.isMoving = true;

    // Random look direction
    const targetUp = this.randomBetween(
      -this.config.movementIntensity,
      this.config.movementIntensity
    );
    const targetLeft = this.randomBetween(
      -this.config.movementIntensity,
      this.config.movementIntensity
    );

    // Smoothly move to target
    const steps = 15;
    const stepDuration = this.config.movementDuration / (steps * 2); // Half for move, half for return
    let currentStep = 0;

    const moveInterval = setInterval(() => {
      currentStep++;

      if (currentStep <= steps) {
        // Move to target
        const progress = currentStep / steps;
        const currentUp = targetUp * progress;
        const currentLeft = targetLeft * progress;
        this.applyEyeLook(currentUp, currentLeft);
      } else if (currentStep <= steps * 2) {
        // Return to center
        const progress = (currentStep - steps) / steps;
        const currentUp = targetUp * (1 - progress);
        const currentLeft = targetLeft * (1 - progress);
        this.applyEyeLook(currentUp, currentLeft);
      } else {
        // Movement complete
        clearInterval(moveInterval);
        this.isMoving = false;
        this.applyEyeLook(0, 0);
      }
    }, stepDuration);
  }

  stopMovement() {
    if (this.movementInterval) {
      clearTimeout(this.movementInterval);
      this.movementInterval = null;
    }

    this.isMoving = false;
    this.currentLookTarget = { up: 0, left: 0 };
  }

  // ═══════════════════════════════════════════════════════════
  // Breathing Animation
  // ═══════════════════════════════════════════════════════════

  startBreathing() {
    this.breathingInterval = setInterval(() => {
      this.updateBreathing();
    }, 50); // Update every 50ms for smooth animation
  }

  updateBreathing() {
    // Increment phase (0 → 2π per cycle)
    const cycleSpeed = (2 * Math.PI) / (this.config.breathingRate / 50);
    this.currentBreathPhase += cycleSpeed;

    // Sine wave for breathing (smooth in/out)
    const breathValue = Math.sin(this.currentBreathPhase) * 0.5 + 0.5; // 0 → 1 → 0

    // Apply subtle jaw opening
    const jawOpen = breathValue * this.config.breathingIntensity;
    this.avatarController.setMorphTarget("jawOpen", jawOpen);

    // Chest breathing via Spine rotation
    const spineBone = this.avatarController.getSpineBone();
    if (spineBone) {
      // Subtle back/forward rotation (X-axis: backward when inhaling)
      const spineRotation = (breathValue - 0.5) * 0.02; // ±0.01 radians
      spineBone.rotation.x = spineRotation;
    }
  }

  stopBreathing() {
    if (this.breathingInterval) {
      clearInterval(this.breathingInterval);
      this.breathingInterval = null;
    }

    // Reset breathing
    this.avatarController.setMorphTarget("jawOpen", 0);
    const spineBone = this.avatarController.getSpineBone();
    if (spineBone) {
      spineBone.rotation.x = 0;
    }

    this.currentBreathPhase = 0;
  }

  // ═══════════════════════════════════════════════════════════
  // Head Sway (Y-axis rotation)
  // ═══════════════════════════════════════════════════════════

  startHeadSway() {
    // Smooth interpolation update
    this.swayInterval = setInterval(() => {
      this.updateHeadSway();
    }, this.config.swayUpdateRate);

    // Change target direction periodically
    this.scheduleNextSwayTarget();
  }

  scheduleNextSwayTarget() {
    setTimeout(() => {
      // Pick new random target
      this.currentSwayTarget = this.randomBetween(
        -this.config.swayIntensity,
        this.config.swayIntensity
      );

      // Schedule next change
      this.scheduleNextSwayTarget();
    }, this.config.swayChangeInterval);
  }

  updateHeadSway() {
    const headBone = this.avatarController.getHeadBone();
    if (!headBone) return;

    // Don't sway during nodding
    if (this.avatarController.microResponseController?.isNodding()) {
      return;
    }

    // Calculate difference
    const diff = this.currentSwayTarget - this.currentSwayValue;
    const distance = Math.abs(diff);

    // Ease-in-out interpolation (faster in middle, slower at ends)
    // Use sigmoid-like curve for natural movement
    let speed = 0.08; // Base speed (increased from 0.02)

    if (distance > 0.01) {
      // Ease out when close to target (smoothstep)
      const progress = Math.min(distance / this.config.swayIntensity, 1.0);
      const easeProgress =
        progress < 0.5
          ? 2 * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      speed = 0.08 * easeProgress;
    }

    // Apply smooth interpolation with easing
    this.currentSwayValue += diff * speed;

    // Apply Y-axis rotation
    headBone.rotation.y = this.currentSwayValue;
  }

  stopHeadSway() {
    if (this.swayInterval) {
      clearInterval(this.swayInterval);
      this.swayInterval = null;
    }

    // Reset head rotation
    const headBone = this.avatarController.getHeadBone();
    if (headBone) {
      headBone.rotation.y = 0;
    }

    this.currentSwayValue = 0;
    this.currentSwayTarget = 0;
  }

  // ═══════════════════════════════════════════════════════════
  // Helper Methods
  // ═══════════════════════════════════════════════════════════

  applyEyeLook(upDown, leftRight) {
    // Up/Down: positive = up, negative = down
    if (upDown > 0) {
      this.avatarController.setMorphTarget("eyeLookUpLeft", Math.abs(upDown));
      this.avatarController.setMorphTarget("eyeLookUpRight", Math.abs(upDown));
      this.avatarController.setMorphTarget("eyeLookDownLeft", 0);
      this.avatarController.setMorphTarget("eyeLookDownRight", 0);
    } else {
      this.avatarController.setMorphTarget("eyeLookUpLeft", 0);
      this.avatarController.setMorphTarget("eyeLookUpRight", 0);
      this.avatarController.setMorphTarget("eyeLookDownLeft", Math.abs(upDown));
      this.avatarController.setMorphTarget(
        "eyeLookDownRight",
        Math.abs(upDown)
      );
    }

    // Left/Right: positive = left, negative = right
    if (leftRight > 0) {
      this.avatarController.setMorphTarget(
        "eyeLookOutLeft",
        Math.abs(leftRight)
      );
      this.avatarController.setMorphTarget(
        "eyeLookInRight",
        Math.abs(leftRight)
      );
      this.avatarController.setMorphTarget("eyeLookInLeft", 0);
      this.avatarController.setMorphTarget("eyeLookOutRight", 0);
    } else {
      this.avatarController.setMorphTarget("eyeLookOutLeft", 0);
      this.avatarController.setMorphTarget("eyeLookInRight", 0);
      this.avatarController.setMorphTarget(
        "eyeLookInLeft",
        Math.abs(leftRight)
      );
      this.avatarController.setMorphTarget(
        "eyeLookOutRight",
        Math.abs(leftRight)
      );
    }
  }

  randomBetween(min, max) {
    return Math.random() * (max - min) + min;
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    console.log("🧍 Idle movement config updated:", this.config);
  }
}

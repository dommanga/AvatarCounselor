/**
 * LipSyncController - Simple timing-based lip sync for Web Speech API
 * Works with existing AvatarController
 */
export class LipSyncController {
  constructor(avatarController) {
    this.avatarController = avatarController;
    this.isActive = false;
    this.animationFrameId = null;
    this.currentJawOpen = 0;

    // Parameters (tunable)
    this.maxJawOpen = 0.9;
    this.speed = 0.15;
  }

  /**
   * Start timing-based lip sync simulation
   * (Web Speech API doesn't provide audio stream)
   */
  start() {
    this.isActive = true;
    this.animate();
    console.log("👄 Lip sync started");
  }

  /**
   * Animation loop - simulate mouth movement
   */
  animate() {
    if (!this.isActive) return;

    // Random jaw movement to simulate speech
    const targetJaw = Math.random() * 0.6;
    this.currentJawOpen += (targetJaw - this.currentJawOpen) * this.speed;

    // Update avatar jaw
    this.updateJaw(this.currentJawOpen * this.maxJawOpen);

    this.animationFrameId = requestAnimationFrame(() => this.animate());
  }

  /**
   * Stop lip sync and close mouth
   */
  stop() {
    this.isActive = false;

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    // Smoothly close mouth
    const closeMouth = () => {
      if (this.currentJawOpen > 0.01) {
        this.currentJawOpen *= 0.7;
        this.updateJaw(this.currentJawOpen * this.maxJawOpen);
        requestAnimationFrame(closeMouth);
      } else {
        this.currentJawOpen = 0;
        this.updateJaw(0);
      }
    };
    closeMouth();

    console.log("👄 Lip sync stopped");
  }

  /**
   * Update jaw blendshape on avatar
   */
  updateJaw(value) {
    // Use existing avatarController method
    if (this.avatarController && this.avatarController.setMorphTarget) {
      this.avatarController.setMorphTarget("jawOpen", value);
    }
  }

  /**
   * Adjust parameters
   */
  setParameters(params) {
    if (params.maxJawOpen !== undefined) this.maxJawOpen = params.maxJawOpen;
    if (params.speed !== undefined) this.speed = params.speed;
  }
}

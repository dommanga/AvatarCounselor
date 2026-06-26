/**
 * LipSyncController - Viseme-based lip sync using Hume phoneme timestamps
 * Synchronizes Rocketbox AA_VI_xx visemes to audio.currentTime
 */
export class LipSyncController {
  constructor(avatarController) {
    this.avatarController = avatarController;
    this.isActive = false;
    this.animationFrameId = null;
    this.currentEmotion = "neutral";

    // Viseme playback state
    this.visemes = [];          // [{ viseme, begin(ms), end(ms) }]
    this.audioEl = null;        // audio element to sync against
    this.currentVisemeWeights = {}; // morph name → current weight (for interpolation)

    // All possible viseme morphs (for clearing)
    this.allVisemes = [
      "AA_VI_00_Sil", "AA_VI_01_PP", "AA_VI_02_FF", "AA_VI_03_TH",
      "AA_VI_04_DD", "AA_VI_05_KK", "AA_VI_06_CH", "AA_VI_07_SS",
      "AA_VI_08_nn", "AA_VI_09_RR", "AA_VI_10_aa", "AA_VI_11_E",
      "AA_VI_12_I", "AA_VI_13_O", "AA_VI_14_U",
    ];

    // Tunable
    this.maxWeight = 1.0;       // peak morph weight for active viseme
    this.lerpSpeed = 0.55;      // interpolation toward target (higher = snappier)
  }

  /**
   * Start viseme-based lip sync
   * @param {HTMLAudioElement} audioEl - audio element to sync to
   * @param {Array} visemes - [{ viseme, begin, end }] in ms
   */
  startWithVisemes(audioEl, visemes) {
    this.audioEl = audioEl;
    this.visemes = visemes || [];
    this.isActive = true;

    // init weights
    this.currentVisemeWeights = {};
    for (const v of this.allVisemes) this.currentVisemeWeights[v] = 0;

    this.animate();
  }

  animate() {
    if (!this.isActive) return;

    const nowMs = this.audioEl ? this.audioEl.currentTime * 1000 : 0;

    // find active viseme at current time
    let activeViseme = null;
    for (const v of this.visemes) {
      if (nowMs >= v.begin && nowMs < v.end) {
        activeViseme = v.viseme;
        break;
      }
    }

    // set targets: active → maxWeight, others → 0
    for (const vName of this.allVisemes) {
      const target = vName === activeViseme ? this.maxWeight : 0;
      const current = this.currentVisemeWeights[vName];
      const next = current + (target - current) * this.lerpSpeed;
      this.currentVisemeWeights[vName] = next;

      // apply only if meaningful (avoid spamming tiny values)
      this.avatarController.setMorphTarget(vName, next);
    }

    this.animationFrameId = requestAnimationFrame(() => this.animate());
  }

  /**
   * Stop and close mouth smoothly
   */
  stop() {
    this.isActive = false;

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    // smooth close
    const closeMouth = () => {
      let stillOpen = false;
      for (const vName of this.allVisemes) {
        let w = this.currentVisemeWeights[vName] || 0;
        if (w > 0.01) {
          w *= 0.5;
          this.currentVisemeWeights[vName] = w;
          this.avatarController.setMorphTarget(vName, w);
          stillOpen = true;
        } else if (w !== 0) {
          this.currentVisemeWeights[vName] = 0;
          this.avatarController.setMorphTarget(vName, 0);
        }
      }
      if (stillOpen) {
        requestAnimationFrame(closeMouth);
      }
    };
    closeMouth();
  }

  setCurrentEmotion(emotion) {
    this.currentEmotion = emotion;
  }
}
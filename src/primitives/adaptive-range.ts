/**
 * AdaptiveRange: self-calibrating normalizer.
 *
 * Tracks observed min/max of a raw signal and maps it to 0-1.
 * Uses exponential decay so the range slowly forgets old extremes,
 * adapting to each dancer without a calibration step.
 *
 * v2 additions:
 * - Warm-up: returns 0.5 for the first N frames while range establishes
 * - Minimum range floor: prevents collapse after extended stillness
 */
export class AdaptiveRange {
  private min: number;
  private max: number;
  private readonly decay: number;
  private readonly warmupFrames: number;
  private readonly minRange: number;
  private frameCount = 0;

  constructor(decay = 0.001, warmupFrames = 90, minRange = 0.05) {
    this.min = Infinity;
    this.max = -Infinity;
    this.decay = decay;
    this.warmupFrames = warmupFrames;
    this.minRange = minRange;
  }

  update(raw: number): number {
    this.frameCount++;

    // Expand range instantly
    if (raw < this.min) this.min = raw;
    if (raw > this.max) this.max = raw;

    // Decay range toward the signal (forget old extremes)
    this.min += (raw - this.min) * this.decay;
    this.max -= (this.max - raw) * this.decay;

    // Warm-up: return midpoint while range is establishing
    if (this.frameCount <= this.warmupFrames) return 0.5;

    // Enforce minimum range floor
    let range = this.max - this.min;
    if (range < this.minRange) {
      const mid = (this.max + this.min) / 2;
      const halfRange = this.minRange / 2;
      // Use minRange centered on current midpoint for normalization
      const effectiveMin = mid - halfRange;
      range = this.minRange;
      return Math.max(0, Math.min(1, (raw - effectiveMin) / range));
    }

    if (range < 0.0001) return 0.5;
    return Math.max(0, Math.min(1, (raw - this.min) / range));
  }

  reset() {
    this.min = Infinity;
    this.max = -Infinity;
    this.frameCount = 0;
  }
}

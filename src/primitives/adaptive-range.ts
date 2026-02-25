/**
 * AdaptiveRange: self-calibrating normalizer.
 *
 * Tracks observed min/max of a raw signal and maps it to 0-1.
 * Uses exponential decay so the range slowly forgets old extremes,
 * adapting to each dancer without a calibration step.
 */
export class AdaptiveRange {
  private min: number;
  private max: number;
  private readonly decay: number;

  constructor(decay = 0.001) {
    this.min = Infinity;
    this.max = -Infinity;
    this.decay = decay;
  }

  update(raw: number): number {
    // Expand range instantly
    if (raw < this.min) this.min = raw;
    if (raw > this.max) this.max = raw;

    // Decay range toward the signal (forget old extremes)
    this.min += (raw - this.min) * this.decay;
    this.max -= (this.max - raw) * this.decay;

    const range = this.max - this.min;
    if (range < 0.0001) return 0.5;
    return Math.max(0, Math.min(1, (raw - this.min) / range));
  }

  reset() {
    this.min = Infinity;
    this.max = -Infinity;
  }
}

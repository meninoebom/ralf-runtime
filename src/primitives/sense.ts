import { AdaptiveRange } from "./adaptive-range.js";
import type { QualityName } from "../types.js";

/**
 * Sense: extracts a 0-1 quality value from raw pose data.
 *
 * Each quality gets its own AdaptiveRange so it self-calibrates
 * to the dancer's movement range.
 */
export class Sense {
  private ranges = new Map<QualityName, AdaptiveRange>();
  private readonly decay: number;
  private readonly warmupFrames: number;
  private readonly minRange: number;

  constructor(decay = 0.001, warmupFrames = 90, minRange = 0.05) {
    this.decay = decay;
    this.warmupFrames = warmupFrames;
    this.minRange = minRange;
  }

  update(quality: QualityName, raw: number): number {
    let range = this.ranges.get(quality);
    if (!range) {
      range = new AdaptiveRange(this.decay, this.warmupFrames, this.minRange);
      this.ranges.set(quality, range);
    }
    return range.update(raw);
  }

  reset() {
    this.ranges.clear();
  }
}

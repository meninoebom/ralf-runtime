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

  update(quality: QualityName, raw: number): number {
    let range = this.ranges.get(quality);
    if (!range) {
      range = new AdaptiveRange();
      this.ranges.set(quality, range);
    }
    return range.update(raw);
  }

  reset() {
    this.ranges.clear();
  }
}

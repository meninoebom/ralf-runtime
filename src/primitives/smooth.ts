import type { QualityName } from "../types.js";

/**
 * Low-pass filter used internally by OneEuroFilter.
 */
class LowPassFilter {
  private y: number | null = null;

  filter(value: number, alpha: number): number {
    if (this.y === null) {
      this.y = value;
    } else {
      this.y = alpha * value + (1 - alpha) * this.y;
    }
    return this.y;
  }

  lastValue(): number {
    return this.y ?? 0;
  }

  reset() {
    this.y = null;
  }
}

/**
 * OneEuroFilter: adaptive low-pass filter invented for noisy pose tracking.
 *
 * Low latency during fast movement, strong smoothing during stillness.
 * Two key parameters:
 * - minCutoff: controls smoothing during slow movement (lower = smoother)
 * - beta: controls how quickly smoothing reduces during fast movement (higher = more responsive)
 */
export class OneEuroFilter {
  private readonly minCutoff: number;
  private readonly beta: number;
  private readonly dCutoff: number;
  private readonly xFilter = new LowPassFilter();
  private readonly dxFilter = new LowPassFilter();
  private lastTimestamp: number | null = null;

  constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  filter(value: number, timestamp?: number): number {
    const ts = timestamp ?? Date.now() / 1000;

    if (this.lastTimestamp === null) {
      this.lastTimestamp = ts;
      this.dxFilter.filter(0, this.alpha(1.0 / (1.0 + 1.0 / (2 * Math.PI * this.dCutoff))));
      return this.xFilter.filter(value, 1.0); // no smoothing on first sample
    }

    const dt = Math.max(ts - this.lastTimestamp, 1e-6);
    this.lastTimestamp = ts;

    // Estimate derivative
    const dx = (value - this.xFilter.lastValue()) / dt;
    const edx = this.dxFilter.filter(dx, this.alpha(dt, this.dCutoff));

    // Adaptive cutoff
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.xFilter.filter(value, this.alpha(dt, cutoff));
  }

  reset() {
    this.xFilter.reset();
    this.dxFilter.reset();
    this.lastTimestamp = null;
  }

  private alpha(dt: number, cutoff?: number): number {
    const c = cutoff ?? this.minCutoff;
    const tau = 1.0 / (2 * Math.PI * c);
    return 1.0 / (1.0 + tau / dt);
  }
}

/**
 * Smooth: wraps per-quality OneEuroFilter instances.
 * Same pattern as Sense wrapping per-quality AdaptiveRange.
 */
export class Smooth {
  private filters = new Map<QualityName, OneEuroFilter>();
  private readonly minCutoff: number;
  private readonly beta: number;

  constructor(minCutoff = 1.0, beta = 0.007) {
    this.minCutoff = minCutoff;
    this.beta = beta;
  }

  filter(quality: QualityName, value: number, timestamp?: number): number {
    let f = this.filters.get(quality);
    if (!f) {
      f = new OneEuroFilter(this.minCutoff, this.beta);
      this.filters.set(quality, f);
    }
    return f.filter(value, timestamp);
  }

  reset() {
    this.filters.clear();
  }
}

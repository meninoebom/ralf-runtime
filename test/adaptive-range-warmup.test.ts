import { describe, it, expect } from "vitest";
import { AdaptiveRange } from "../src/primitives/adaptive-range.js";

describe("AdaptiveRange warm-up", () => {
  it("returns 0.5 during warm-up period", () => {
    const ar = new AdaptiveRange(0.001, 5, 0.05); // 5-frame warmup
    for (let i = 0; i < 5; i++) {
      expect(ar.update(i * 10)).toBe(0.5);
    }
  });

  it("starts normalizing after warm-up", () => {
    const ar = new AdaptiveRange(0, 3, 0); // 3-frame warmup, no decay, no minRange
    ar.update(0);   // frame 1 - warmup
    ar.update(100); // frame 2 - warmup
    ar.update(50);  // frame 3 - warmup
    expect(ar.update(50)).toBeCloseTo(0.5, 1); // frame 4 - normalizing
    expect(ar.update(0)).toBeCloseTo(0.0, 1);
    expect(ar.update(100)).toBeCloseTo(1.0, 1);
  });

  it("minimum range prevents collapse after extended stillness", () => {
    const ar = new AdaptiveRange(0.1, 0, 0.1); // no warmup, high decay, minRange=0.1
    // Feed the same value many times to collapse the range
    for (let i = 0; i < 200; i++) {
      ar.update(0.5);
    }
    // Now a tiny change should NOT read as 1.0 because minRange enforces floor
    const result = ar.update(0.55);
    expect(result).toBeLessThan(1.0);
    expect(result).toBeGreaterThan(0.0);
  });

  it("existing behavior unchanged when warmupFrames=0, minRange=0", () => {
    const ar = new AdaptiveRange(0, 0, 0);
    ar.update(0);
    ar.update(100);
    const mid = ar.update(50);
    expect(mid).toBeCloseTo(0.5, 1);
  });
});

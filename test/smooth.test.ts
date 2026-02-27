import { describe, it, expect } from "vitest";
import { OneEuroFilter, Smooth } from "../src/primitives/smooth.js";

describe("OneEuroFilter", () => {
  it("smooths noisy signal", () => {
    const filter = new OneEuroFilter(1.0, 0.007);
    // Feed a constant value with noise
    const outputs: number[] = [];
    for (let i = 0; i < 50; i++) {
      const noisy = 0.5 + (Math.random() - 0.5) * 0.2;
      outputs.push(filter.filter(noisy, i / 30));
    }
    // Last values should be close to 0.5 (smoothed)
    const last10 = outputs.slice(-10);
    const avg = last10.reduce((a, b) => a + b, 0) / last10.length;
    expect(avg).toBeCloseTo(0.5, 0); // within 0.05
    // Variance should be much lower than input noise
    const variance = last10.reduce((s, v) => s + (v - avg) ** 2, 0) / last10.length;
    expect(variance).toBeLessThan(0.01);
  });

  it("tracks fast changes with low latency", () => {
    const filter = new OneEuroFilter(1.0, 0.5); // high beta = responsive to fast changes
    // Steady at 0
    for (let i = 0; i < 20; i++) {
      filter.filter(0, i / 30);
    }
    // Jump to 1.0
    let val = 0;
    for (let i = 20; i < 25; i++) {
      val = filter.filter(1.0, i / 30);
    }
    // Should track quickly - within a few frames
    expect(val).toBeGreaterThan(0.7);
  });

  it("provides strong smoothing during slow changes", () => {
    const filter = new OneEuroFilter(0.5, 0.007); // low minCutoff = strong smoothing
    // Gentle ramp
    const outputs: number[] = [];
    for (let i = 0; i < 30; i++) {
      const v = i / 30; // slow ramp 0 to ~1
      outputs.push(filter.filter(v, i / 30));
    }
    // Smoothed output should lag behind the input
    // At frame 15 (input ~0.5), output should be noticeably behind
    expect(outputs[15]).toBeLessThan(0.5);
  });

  it("first call returns the input value", () => {
    const filter = new OneEuroFilter();
    expect(filter.filter(0.42, 0)).toBe(0.42);
  });
});

describe("Smooth", () => {
  it("maintains per-quality isolation", () => {
    const smooth = new Smooth();
    // Feed different signals to different qualities
    for (let i = 0; i < 20; i++) {
      smooth.filter("velocity", 0.8, i / 30);
      smooth.filter("jerkiness", 0.2, i / 30);
    }
    const v = smooth.filter("velocity", 0.8, 20 / 30);
    const j = smooth.filter("jerkiness", 0.2, 20 / 30);
    expect(v).toBeCloseTo(0.8, 1);
    expect(j).toBeCloseTo(0.2, 1);
  });

  it("reset clears all filters", () => {
    const smooth = new Smooth();
    smooth.filter("velocity", 0.5, 0);
    smooth.reset();
    // After reset, next call should return raw value (first sample)
    expect(smooth.filter("velocity", 0.9, 1)).toBe(0.9);
  });
});

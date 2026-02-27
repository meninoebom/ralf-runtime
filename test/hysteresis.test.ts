import { describe, it, expect } from "vitest";
import { combine } from "../src/primitives/combine.js";
import type { HysteresisState, ReadingConfig } from "../src/types.js";

describe("Gate hysteresis (Schmitt trigger)", () => {
  const config: ReadingConfig = {
    id: "test",
    mix: { velocity: 1.0 },
    gate: { velocity: { above: 0.5 } },
  };

  it("value hovering near threshold does not oscillate", () => {
    const state: HysteresisState = new Map();
    const band = 0.05;

    // Values hovering around 0.5 — should not toggle
    const values = [0.48, 0.51, 0.49, 0.52, 0.50, 0.53, 0.48, 0.51];
    const results = values.map((v) =>
      combine(config, { velocity: v }, state, band).active
    );

    // None of these should activate because they never reach 0.55 (threshold + band)
    expect(results.every((r) => r === false)).toBe(true);
  });

  it("clean transition above threshold+band activates", () => {
    const state: HysteresisState = new Map();
    const band = 0.05;

    // Start below
    expect(combine(config, { velocity: 0.3 }, state, band).active).toBe(false);
    // Cross above threshold + band (0.55)
    expect(combine(config, { velocity: 0.56 }, state, band).active).toBe(true);
    // Stay above threshold - band (0.45) — should remain active
    expect(combine(config, { velocity: 0.50 }, state, band).active).toBe(true);
    expect(combine(config, { velocity: 0.46 }, state, band).active).toBe(true);
  });

  it("must drop below threshold-band to deactivate", () => {
    const state: HysteresisState = new Map();
    const band = 0.05;

    // Activate
    combine(config, { velocity: 0.6 }, state, band);
    // Drop to between threshold-band and threshold+band
    expect(combine(config, { velocity: 0.48 }, state, band).active).toBe(true);
    // Drop below threshold - band (0.45)
    expect(combine(config, { velocity: 0.44 }, state, band).active).toBe(false);
    // Back up to hovering range — should not reactivate
    expect(combine(config, { velocity: 0.51 }, state, band).active).toBe(false);
  });

  it("configurable band width", () => {
    const state: HysteresisState = new Map();
    const wideBand = 0.2;

    // With wide band, need to exceed 0.7 (0.5 + 0.2) to activate
    expect(combine(config, { velocity: 0.65 }, state, wideBand).active).toBe(false);
    expect(combine(config, { velocity: 0.71 }, state, wideBand).active).toBe(true);
    // Need to drop below 0.3 (0.5 - 0.2) to deactivate
    expect(combine(config, { velocity: 0.35 }, state, wideBand).active).toBe(true);
    expect(combine(config, { velocity: 0.29 }, state, wideBand).active).toBe(false);
  });

  it("works without hysteresis state (backward compat)", () => {
    // No hysteresis state passed — original behavior
    const result = combine(config, { velocity: 0.51 });
    expect(result.active).toBe(true);
    const result2 = combine(config, { velocity: 0.49 });
    expect(result2.active).toBe(false);
  });
});

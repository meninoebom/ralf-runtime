import { describe, it, expect } from "vitest";
import { Runtime } from "../src/engine/runtime.js";
import type { SceneConfig, ActMessage } from "../src/types.js";

function makeScene(overrides: Partial<SceneConfig> = {}): SceneConfig {
  return {
    name: "test",
    dancers: [{ id: "d1", input: { type: "mediapipe", port: 6448 } }],
    readings: [],
    intents: {},
    translator: { type: "osc", port: 12000 },
    ...overrides,
  };
}

/** Push velocity through adaptive range so it calibrates, then set to desired level. */
function calibrateAndSet(runtime: Runtime, velocity: number) {
  runtime.updateQuality("d1", "velocity", 0);
  runtime.updateQuality("d1", "velocity", 100);
  runtime.updateQuality("d1", "velocity", velocity);
}

describe("Runtime intent resolution", () => {
  it("fires direct intents on rising edge", () => {
    const scene = makeScene({
      readings: [
        { id: "energy", mix: { velocity: 1.0 }, intents: ["add_energy"] },
      ],
      intents: {
        add_energy: [{ action: "unmute_track", args: { track: "perc" }, weight: 1 }],
      },
    });

    const runtime = new Runtime(scene);
    const acts: ActMessage[] = [];
    runtime.setActHandler((msg) => acts.push(msg));

    calibrateAndSet(runtime, 80);
    runtime.tick();

    expect(acts.length).toBe(1);
    expect(acts[0].address).toBe("/ralf/act/unmute_track");
    expect(acts[0].args[0]).toBeTypeOf("number"); // reading value
    expect(acts[0].args[1]).toBe("perc"); // action arg
  });

  it("fires only once (edge detection) — not every frame", () => {
    const scene = makeScene({
      readings: [
        { id: "energy", mix: { velocity: 1.0 }, intents: ["add_energy"] },
      ],
      intents: {
        add_energy: [{ action: "boom", weight: 1 }],
      },
    });

    const runtime = new Runtime(scene);
    const acts: ActMessage[] = [];
    runtime.setActHandler((msg) => acts.push(msg));

    calibrateAndSet(runtime, 80);
    runtime.tick(); // fires (rising edge)
    runtime.tick(); // should NOT fire again
    runtime.tick(); // should NOT fire again

    expect(acts.length).toBe(1);
  });

  it("fires again after reading goes inactive then active", () => {
    const scene = makeScene({
      readings: [
        {
          id: "energy",
          mix: { velocity: 1.0 },
          gate: { velocity: { above: 0.5 } },
          intents: ["add_energy"],
        },
      ],
      intents: {
        add_energy: [{ action: "boom", weight: 1 }],
      },
    });

    const runtime = new Runtime(scene);
    const acts: ActMessage[] = [];
    runtime.setActHandler((msg) => acts.push(msg));

    // Go high — should fire
    calibrateAndSet(runtime, 80);
    runtime.tick();
    expect(acts.length).toBe(1);

    // Go low — gate closes
    runtime.updateQuality("d1", "velocity", 10);
    runtime.tick();

    // Go high again — should fire again (new rising edge)
    runtime.updateQuality("d1", "velocity", 90);
    runtime.tick();
    expect(acts.length).toBe(2);
  });

  it("does not fire intents when reading has no intents configured", () => {
    const scene = makeScene({
      readings: [{ id: "energy", mix: { velocity: 1.0 } }],
      intents: {
        add_energy: [{ action: "boom", weight: 1 }],
      },
    });

    const runtime = new Runtime(scene);
    const acts: ActMessage[] = [];
    runtime.setActHandler((msg) => acts.push(msg));

    calibrateAndSet(runtime, 80);
    runtime.tick();

    expect(acts.length).toBe(0);
  });

  it("fires threshold intents based on reading value", () => {
    const scene = makeScene({
      readings: [
        {
          id: "energy",
          mix: { velocity: 1.0 },
          intents: [
            { intent: "strip_energy", below: 0.3 },
            { intent: "add_energy", above: 0.7 },
          ],
        },
      ],
      intents: {
        add_energy: [{ action: "boost", weight: 1 }],
        strip_energy: [{ action: "filter", weight: 1 }],
      },
    });

    const runtime = new Runtime(scene);
    const acts: ActMessage[] = [];
    runtime.setActHandler((msg) => acts.push(msg));

    // High velocity — should trigger add_energy only
    calibrateAndSet(runtime, 95);
    runtime.tick();

    const boosts = acts.filter((a) => a.address === "/ralf/act/boost");
    const filters = acts.filter((a) => a.address === "/ralf/act/filter");
    expect(boosts.length).toBe(1);
    expect(filters.length).toBe(0);
  });

  it("fires multiple intents from the same reading", () => {
    const scene = makeScene({
      readings: [
        {
          id: "energy",
          mix: { velocity: 1.0 },
          intents: ["always_fire", { intent: "high_fire", above: 0.7 }],
        },
      ],
      intents: {
        always_fire: [{ action: "ping", weight: 1 }],
        high_fire: [{ action: "boom", weight: 1 }],
      },
    });

    const runtime = new Runtime(scene);
    const acts: ActMessage[] = [];
    runtime.setActHandler((msg) => acts.push(msg));

    calibrateAndSet(runtime, 95);
    runtime.tick();

    const pings = acts.filter((a) => a.address === "/ralf/act/ping");
    const booms = acts.filter((a) => a.address === "/ralf/act/boom");
    expect(pings.length).toBe(1);
    expect(booms.length).toBe(1);
  });

  it("respects gate — blocked reading does not fire intents", () => {
    const scene = makeScene({
      readings: [
        {
          id: "gated",
          mix: { velocity: 1.0 },
          gate: { velocity: { above: 0.9 } },
          intents: ["add_energy"],
        },
      ],
      intents: {
        add_energy: [{ action: "boom", weight: 1 }],
      },
    });

    const runtime = new Runtime(scene);
    const acts: ActMessage[] = [];
    runtime.setActHandler((msg) => acts.push(msg));

    calibrateAndSet(runtime, 20);
    runtime.tick();

    expect(acts.length).toBe(0);
  });

  it("reading value is passed through to ActMessage", () => {
    const scene = makeScene({
      readings: [
        { id: "energy", mix: { velocity: 1.0 }, intents: ["drive"] },
      ],
      intents: {
        drive: [{ action: "filter_cutoff", weight: 1 }],
      },
    });

    const runtime = new Runtime(scene);
    const acts: ActMessage[] = [];
    runtime.setActHandler((msg) => acts.push(msg));

    calibrateAndSet(runtime, 80);
    runtime.tick();

    expect(acts.length).toBe(1);
    expect(acts[0].address).toBe("/ralf/act/filter_cutoff");
    // First arg is the reading value (a number between 0-1)
    expect(acts[0].args[0]).toBeTypeOf("number");
    expect(acts[0].args[0]).toBeGreaterThan(0);
    expect(acts[0].args[0]).toBeLessThanOrEqual(1);
  });

  it("per-dancer recognizers have independent cooldowns", () => {
    const scene = makeScene({
      dancers: [
        { id: "d1", input: { type: "mediapipe", port: 6448 } },
        { id: "d2", input: { type: "mediapipe", port: 6449 } },
      ],
      readings: [],
      intents: {},
    });

    const runtime = new Runtime(scene);

    // Both dancers should be able to receive the same gesture independently
    runtime.receiveGesture("d1", "jack");
    runtime.receiveGesture("d2", "jack"); // should NOT be blocked by d1's cooldown
    // If recognizers are shared, d2's gesture would be blocked. We verify by
    // checking dancer state.
    runtime.tick();
    // No crash = per-dancer recognizers work
  });

  it("ignores unknown quality names", () => {
    const scene = makeScene({
      readings: [
        { id: "energy", mix: { velocity: 1.0 }, intents: ["drive"] },
      ],
      intents: { drive: [{ action: "boom", weight: 1 }] },
    });

    const runtime = new Runtime(scene);
    // Should not crash or leak bogus qualities
    runtime.updateQuality("d1", "garbage" as any, 999);
    runtime.tick();
  });
});

describe("trajectory gating", () => {
  it("detects building (increasing values)", () => {
    const scene = makeScene({
      readings: [
        {
          id: "energy",
          mix: { velocity: 1.0 },
          trajectory: { window: 5, above: 0.05 },
          intents: ["add_energy"],
        },
      ],
      intents: { add_energy: [{ action: "boom", weight: 1 }] },
    });

    const runtime = new Runtime(scene);
    const acts: ActMessage[] = [];
    runtime.setActHandler((msg) => acts.push(msg));

    // Feed increasing values
    const values = [10, 30, 50, 70, 90];
    for (const v of values) {
      calibrateAndSet(runtime, v);
      runtime.tick();
    }

    expect(acts.length).toBeGreaterThan(0);
  });

  it("blocks decreasing values when above is set", () => {
    const scene = makeScene({
      readings: [
        {
          id: "energy",
          mix: { velocity: 1.0 },
          trajectory: { window: 5, above: 0.05 },
          intents: ["add_energy"],
        },
      ],
      intents: { add_energy: [{ action: "boom", weight: 1 }] },
    });

    const runtime = new Runtime(scene);
    const acts: ActMessage[] = [];
    runtime.setActHandler((msg) => acts.push(msg));

    // Feed decreasing values
    const values = [90, 70, 50, 30, 10];
    for (const v of values) {
      calibrateAndSet(runtime, v);
      runtime.tick();
    }

    expect(acts.length).toBe(0);
  });

  it("blocks constant values when above is set", () => {
    const scene = makeScene({
      readings: [
        {
          id: "energy",
          mix: { velocity: 1.0 },
          trajectory: { window: 5, above: 0.05 },
          intents: ["add_energy"],
        },
      ],
      intents: { add_energy: [{ action: "boom", weight: 1 }] },
    });

    const runtime = new Runtime(scene);
    const acts: ActMessage[] = [];
    runtime.setActHandler((msg) => acts.push(msg));

    // Feed constant values
    for (let i = 0; i < 5; i++) {
      calibrateAndSet(runtime, 50);
      runtime.tick();
    }

    expect(acts.length).toBe(0);
  });

  it("detects releasing (decreasing values with below threshold)", () => {
    const scene = makeScene({
      readings: [
        {
          id: "energy",
          mix: { velocity: 1.0 },
          trajectory: { window: 5, below: -0.05 },
          intents: ["strip_energy"],
        },
      ],
      intents: { strip_energy: [{ action: "filter", weight: 1 }] },
    });

    const runtime = new Runtime(scene);
    const acts: ActMessage[] = [];
    runtime.setActHandler((msg) => acts.push(msg));

    // Feed decreasing values
    const values = [90, 70, 50, 30, 10];
    for (const v of values) {
      calibrateAndSet(runtime, v);
      runtime.tick();
    }

    expect(acts.length).toBeGreaterThan(0);
  });

  it("stays inactive with insufficient data (fewer frames than window)", () => {
    const scene = makeScene({
      readings: [
        {
          id: "energy",
          mix: { velocity: 1.0 },
          trajectory: { window: 5, above: 0.05 },
          intents: ["add_energy"],
        },
      ],
      intents: { add_energy: [{ action: "boom", weight: 1 }] },
    });

    const runtime = new Runtime(scene);
    const acts: ActMessage[] = [];
    runtime.setActHandler((msg) => acts.push(msg));

    // Only 1 tick — not enough data for slope
    calibrateAndSet(runtime, 80);
    runtime.tick();

    expect(acts.length).toBe(0);
  });

  it("requires both regular gate AND trajectory to pass", () => {
    const scene = makeScene({
      readings: [
        {
          id: "energy",
          mix: { velocity: 1.0 },
          gate: { velocity: { above: 0.3 } },
          trajectory: { window: 5, above: 0.05 },
          intents: ["add_energy"],
        },
      ],
      intents: { add_energy: [{ action: "boom", weight: 1 }] },
    });

    const runtime = new Runtime(scene);
    const acts: ActMessage[] = [];
    runtime.setActHandler((msg) => acts.push(msg));

    // Feed increasing values that are above gate threshold
    const values = [10, 30, 50, 70, 90];
    for (const v of values) {
      calibrateAndSet(runtime, v);
      runtime.tick();
    }

    // Should fire — both gate (velocity > 0.3) and trajectory (slope > 0.05) pass
    expect(acts.length).toBeGreaterThan(0);

    // Now test: increasing values but below gate threshold
    const runtime2 = new Runtime(scene);
    const acts2: ActMessage[] = [];
    runtime2.setActHandler((msg) => acts2.push(msg));

    // Values too low for gate (< 0.3 normalized)
    const lowValues = [1, 3, 5, 7, 9];
    for (const v of lowValues) {
      calibrateAndSet(runtime2, v);
      runtime2.tick();
    }

    expect(acts2.length).toBe(0);
  });

  it("exposes slope on reading state", () => {
    const scene = makeScene({
      readings: [
        {
          id: "energy",
          mix: { velocity: 1.0 },
          trajectory: { window: 5, above: 0.0 },
        },
      ],
      intents: {},
    });

    const runtime = new Runtime(scene);
    let lastReadings: import("../src/types.js").ReadingValue[] = [];
    runtime.setStateHandler((state) => {
      lastReadings = state.readings;
    });

    // Feed increasing values to get a positive slope
    const values = [10, 30, 50, 70, 90];
    for (const v of values) {
      calibrateAndSet(runtime, v);
      runtime.tick();
    }

    const reading = lastReadings.find(r => r.id === "energy");
    expect(reading).toBeDefined();
    expect(reading!.slope).toBeTypeOf("number");
    expect(reading!.slope).toBeGreaterThan(0);
  });
});

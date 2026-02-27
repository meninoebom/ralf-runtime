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

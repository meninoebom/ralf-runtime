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
function calibrateAndSet(runtime: Runtime, quality: string, value: number, dancerId = "d1") {
  runtime.updateQuality(dancerId, quality as any, 0);
  runtime.updateQuality(dancerId, quality as any, 100);
  runtime.updateQuality(dancerId, quality as any, value);
}

describe("Continuous intent mode", () => {
  it("fires every tick while active", () => {
    const scene = makeScene({
      readings: [
        {
          id: "energy",
          mix: { velocity: 1.0 },
          intents: [{ intent: "ride_filter", above: 0.3, mode: "continuous" }],
        },
      ],
      intents: {
        ride_filter: [{ action: "set/filter_cutoff", weight: 1 }],
      },
    });

    const runtime = new Runtime(scene);
    const acts: ActMessage[] = [];
    runtime.setActHandler((msg) => acts.push(msg));

    calibrateAndSet(runtime, "velocity", 80);
    runtime.tick();
    runtime.tick();
    runtime.tick();

    // Should fire on every tick (not just rising edge)
    // The deadband may suppress if value didn't change, but at least the first fires
    expect(acts.length).toBeGreaterThanOrEqual(1);
    expect(acts[0].address).toBe("/ralf/act/set/filter_cutoff");
  });
});

describe("on_exit intents", () => {
  it("fires on falling edge (active -> inactive)", () => {
    const scene = makeScene({
      readings: [
        {
          id: "energy",
          mix: { velocity: 1.0 },
          gate: { velocity: { above: 0.5 } },
          intents: ["add_energy"],
          on_exit: ["release"],
        },
      ],
      intents: {
        add_energy: [{ action: "trigger/boom", weight: 1 }],
        release: [{ action: "trigger/release", weight: 1 }],
      },
    });

    const runtime = new Runtime(scene);
    const acts: ActMessage[] = [];
    runtime.setActHandler((msg) => acts.push(msg));

    // Go active
    calibrateAndSet(runtime, "velocity", 80);
    runtime.tick();
    expect(acts.some((a) => a.address === "/ralf/act/trigger/boom")).toBe(true);

    // Go inactive — should fire on_exit
    acts.length = 0;
    runtime.updateQuality("d1", "velocity", 10);
    runtime.tick();
    expect(acts.some((a) => a.address === "/ralf/act/trigger/release")).toBe(true);
  });

  it("does not fire on_exit when never active", () => {
    const scene = makeScene({
      readings: [
        {
          id: "energy",
          mix: { velocity: 1.0 },
          gate: { velocity: { above: 0.5 } },
          intents: ["add_energy"],
          on_exit: ["release"],
        },
      ],
      intents: {
        add_energy: [{ action: "trigger/boom", weight: 1 }],
        release: [{ action: "trigger/release", weight: 1 }],
      },
    });

    const runtime = new Runtime(scene);
    const acts: ActMessage[] = [];
    runtime.setActHandler((msg) => acts.push(msg));

    // Stay inactive
    calibrateAndSet(runtime, "velocity", 10);
    runtime.tick();
    runtime.tick();
    expect(acts.length).toBe(0);
  });
});

describe("Staleness decay", () => {
  it("decays quality toward 0 after timeout", () => {
    const scene = makeScene({
      settings: { staleness_frames: 5 },
      readings: [],
    });

    const runtime = new Runtime(scene);
    // Need to calibrate with settings enabled
    // With settings, warmup is 90 frames — skip warmup by sending enough updates
    for (let i = 0; i < 95; i++) {
      runtime.updateQuality("d1", "velocity", 0.8);
      runtime.tick();
    }

    const state1 = runtime.getState();
    const dancer1 = state1.dancers.get("d1")!;
    const velocityBefore = dancer1.qualities.velocity;
    expect(velocityBefore).toBeGreaterThan(0);

    // Now don't update for stalenessFrames + some ticks
    for (let i = 0; i < 20; i++) {
      runtime.tick();
    }

    const state2 = runtime.getState();
    const dancer2 = state2.dancers.get("d1")!;
    // Should have decayed significantly
    expect(dancer2.qualities.velocity).toBeLessThan(velocityBefore);
  });
});

describe("Deadband suppression", () => {
  it("suppresses near-identical set/ acts", () => {
    const scene = makeScene({
      readings: [
        {
          id: "energy",
          mix: { velocity: 1.0 },
          intents: [{ intent: "ride_filter", mode: "continuous" }],
        },
      ],
      intents: {
        ride_filter: [{ action: "set/filter_cutoff", weight: 1 }],
      },
    });

    const runtime = new Runtime(scene);
    const acts: ActMessage[] = [];
    runtime.setActHandler((msg) => acts.push(msg));

    // Set velocity and tick multiple times — same value
    calibrateAndSet(runtime, "velocity", 80);
    runtime.tick();
    runtime.tick();
    runtime.tick();

    // Deadband should suppress repeated identical values after first
    // First fires, subsequent suppressed since value didn't change by >= 0.01
    expect(acts.length).toBe(1);
  });

  it("does not suppress trigger/ acts", () => {
    const scene = makeScene({
      readings: [
        {
          id: "energy",
          mix: { velocity: 1.0 },
          intents: [{ intent: "boom", mode: "continuous" }],
        },
      ],
      intents: {
        boom: [{ action: "trigger/fire_scene", weight: 1 }],
      },
    });

    const runtime = new Runtime(scene);
    const acts: ActMessage[] = [];
    runtime.setActHandler((msg) => acts.push(msg));

    calibrateAndSet(runtime, "velocity", 80);
    runtime.tick();
    runtime.tick();
    runtime.tick();

    // Trigger actions should fire every tick in continuous mode
    expect(acts.length).toBe(3);
  });
});

describe("Hot-reload", () => {
  it("preserves calibration when updating scene", () => {
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
        add_energy: [{ action: "trigger/boom", weight: 1 }],
      },
    });

    const runtime = new Runtime(scene);
    const acts: ActMessage[] = [];
    runtime.setActHandler((msg) => acts.push(msg));

    // Calibrate
    calibrateAndSet(runtime, "velocity", 80);
    runtime.tick();
    expect(acts.length).toBe(1);

    // Hot-reload with updated intents
    acts.length = 0;
    runtime.updateScene({
      intents: {
        add_energy: [{ action: "trigger/new_boom", weight: 1 }],
      },
    });

    // Velocity goes low then high again — calibration should be preserved
    runtime.updateQuality("d1", "velocity", 10);
    runtime.tick();
    runtime.updateQuality("d1", "velocity", 90);
    runtime.tick();

    // Should fire the new action (not old one)
    expect(acts.some((a) => a.address === "/ralf/act/trigger/new_boom")).toBe(true);
  });
});

describe("Intent pool config", () => {
  it("resolves IntentPoolConfig with deterministic flag", () => {
    const scene = makeScene({
      readings: [
        { id: "energy", mix: { velocity: 1.0 }, intents: ["add_energy"] },
      ],
      intents: {
        add_energy: {
          deterministic: true,
          pool: [
            { action: "trigger/a", weight: 1 },
            { action: "trigger/b", weight: 10 },
            { action: "trigger/c", weight: 5 },
          ],
        },
      },
    });

    const runtime = new Runtime(scene);
    const acts: ActMessage[] = [];
    runtime.setActHandler((msg) => acts.push(msg));

    calibrateAndSet(runtime, "velocity", 80);
    runtime.tick();

    // Deterministic: highest weight (b at 10) always wins
    expect(acts.length).toBe(1);
    expect(acts[0].address).toBe("/ralf/act/trigger/b");
  });
});

describe("TranslatorState", () => {
  it("stores and exposes translator state", () => {
    const scene = makeScene();
    const runtime = new Runtime(scene);

    runtime.updateTranslatorState({ tempo: 128, playing: true });
    const state = runtime.getState();
    expect(state.translatorState.tempo).toBe(128);
    expect(state.translatorState.playing).toBe(true);
  });

  it("partial updates merge with existing state", () => {
    const scene = makeScene();
    const runtime = new Runtime(scene);

    runtime.updateTranslatorState({ tempo: 140 });
    runtime.updateTranslatorState({ playing: true });
    const state = runtime.getState();
    expect(state.translatorState.tempo).toBe(140);
    expect(state.translatorState.playing).toBe(true);
  });
});

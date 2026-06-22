import { describe, it, expect } from "vitest";
import { Runtime } from "../src/engine/runtime.js";
import type { SceneConfig, ActMessage } from "../src/types.js";

function makeMultiScene(overrides: Partial<SceneConfig> = {}): SceneConfig {
  return {
    name: "test-scope",
    settings: { hysteresis_band: 0.05, staleness_frames: 90 },
    dancers: [
      { id: "d1" },
      { id: "d2" },
      { id: "_crowd" },
    ],
    readings: [],
    intents: {
      fire: [{ action: "trigger/test", weight: 1 }],
    },
    translator: { type: "tonejs", port: 12000 },
    ...overrides,
  };
}

function feedHistory(runtime: Runtime, id: string, values: number[]) {
  // Prime adaptive range then set history
  runtime.updateQuality(id, "velocity", 0);
  runtime.updateQuality(id, "velocity", 1);
  for (const v of values) {
    runtime.updateQuality(id, "velocity", v);
    runtime.tick();
  }
}

describe("scope routing", () => {
  it("per_dancer (default) skips _crowd and evaluates real dancers", () => {
    const scene = makeMultiScene({
      readings: [
        // no scope → per_dancer by default
        { id: "vel-read", mix: { velocity: 1.0 }, gate: { velocity: { above: 0.3 } }, intents: ["fire"] },
      ],
    });
    const runtime = new Runtime(scene);
    const acts: ActMessage[] = [];
    runtime.setActHandler(msg => acts.push(msg));

    // Give d1 a high velocity, nothing to d2
    runtime.updateQuality("d1", "velocity", 0);
    runtime.updateQuality("d1", "velocity", 1);
    runtime.updateQuality("d1", "velocity", 0.9);
    runtime.tick();

    // Should fire for d1 (real dancer)
    expect(acts.length).toBeGreaterThan(0);
    // Should NOT fire a second time for _crowd (scope skips it)
    expect(acts.length).toBe(1);
  });

  it("scope: crowd fires once (from _crowd), not once per real dancer", () => {
    // Use field_intensity — this IS populated on _crowd (it's the mean velocity).
    // With 2 real dancers, a per_dancer reading would fire up to 2 times;
    // a crowd reading should fire at most once per tick.
    const scene = makeMultiScene({
      readings: [
        {
          id: "crowd-field",
          scope: "crowd",
          mix: { field_intensity: 1.0 },
          gate: { field_intensity: { above: 0.01 } },
          intents: [{ intent: "fire", mode: "continuous" }],
        },
      ],
    });
    const runtime = new Runtime(scene);
    const acts: ActMessage[] = [];
    runtime.setActHandler(msg => acts.push(msg));

    // Calibrate both dancers and set high velocity
    runtime.updateQuality("d1", "velocity", 0);
    runtime.updateQuality("d1", "velocity", 1);
    runtime.updateQuality("d2", "velocity", 0);
    runtime.updateQuality("d2", "velocity", 1);
    runtime.updateQuality("d1", "velocity", 0.9);
    runtime.updateQuality("d2", "velocity", 0.9);

    // Run enough ticks for velocity history to build so _crowd gets field_intensity > 0
    for (let i = 0; i < 25; i++) runtime.tick();

    const fireCount = acts.filter(a => a.address === "/ralf/act/trigger/test").length;
    // crowd scope: fired at most once per tick (not twice for d1 + d2)
    expect(fireCount).toBeLessThanOrEqual(25);
    // continuous mode: should fire on most ticks once field_intensity is established
    expect(fireCount).toBeGreaterThan(0);
  });

  it("scope: broadcast evaluates once against _crowd (not per real dancer)", () => {
    // Gate on cohesion above -2 (always true once _crowd exists) with continuous mode.
    // If broadcast evaluated per-dancer, we'd get 2 fires/tick. Should get at most 1.
    const scene = makeMultiScene({
      readings: [
        {
          id: "broadcast-read",
          scope: "broadcast",
          mix: { cohesion: 1.0 },
          gate: { cohesion: { above: -2 } }, // always true
          intents: [{ intent: "fire", mode: "continuous" }],
        },
      ],
    });
    const runtime = new Runtime(scene);
    const acts: ActMessage[] = [];
    runtime.setActHandler(msg => acts.push(msg));

    // Build at least 2 frames of velocity history so _crowd is created
    runtime.updateQuality("d1", "velocity", 0); runtime.updateQuality("d1", "velocity", 1);
    runtime.updateQuality("d2", "velocity", 0); runtime.updateQuality("d2", "velocity", 1);
    runtime.updateQuality("d1", "velocity", 0.5);
    runtime.updateQuality("d2", "velocity", 0.5);
    for (let i = 0; i < 5; i++) runtime.tick();

    const fires = acts.filter(a => a.address === "/ralf/act/trigger/test");
    // broadcast = one evaluation per tick, not one per dancer
    // 5 ticks of continuous fires → at most 5, not 10
    expect(fires.length).toBeLessThanOrEqual(5);
    expect(fires.length).toBeGreaterThan(0);
  });
});

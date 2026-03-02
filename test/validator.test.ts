import { describe, it, expect } from "vitest";
import { validateScene } from "../src/scenes/validator.js";
import type { SceneConfig, TranslatorManifest } from "../src/types.js";

function validScene(): SceneConfig {
  return {
    version: 1,
    name: "test",
    dancers: [{ id: "maya" }],
    readings: [
      {
        id: "energy",
        mix: { velocity: 0.5, jerkiness: 0.5 },
        gate: { velocity: { above: 0.2 } },
        intents: ["add_energy"],
      },
    ],
    intents: {
      add_energy: [{ action: "trigger/boom", weight: 1 }],
    },
    translator: { type: "osc", port: 12000 },
  };
}

describe("Scene validator", () => {
  it("valid scene passes with no errors", () => {
    expect(validateScene(validScene())).toEqual([]);
  });

  it("catches typo in quality name in mix", () => {
    const scene = validScene();
    scene.readings[0].mix = { velocty: 0.5, jerkiness: 0.5 };
    const errors = validateScene(scene);
    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain("velocty");
  });

  it("catches typo in quality name in gate", () => {
    const scene = validScene();
    scene.readings[0].gate = { jerkyness: { above: 0.2 } };
    const errors = validateScene(scene);
    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain("jerkyness");
  });

  it("catches missing intent reference", () => {
    const scene = validScene();
    scene.readings[0].intents = ["nonexistent_intent"];
    const errors = validateScene(scene);
    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain("nonexistent_intent");
  });

  it("catches missing on_exit intent reference", () => {
    const scene = validScene();
    scene.readings[0].on_exit = ["missing_exit"];
    const errors = validateScene(scene);
    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain("missing_exit");
  });

  it("catches duplicate dancer ID", () => {
    const scene = validScene();
    scene.dancers = [{ id: "maya" }, { id: "maya" }];
    const errors = validateScene(scene);
    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain("Duplicate");
  });

  it("catches unrecognized version", () => {
    const scene = validScene();
    scene.version = 99;
    const errors = validateScene(scene);
    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain("99");
  });

  it("accepts scene without version (undefined)", () => {
    const scene = validScene();
    delete scene.version;
    expect(validateScene(scene)).toEqual([]);
  });
});

const testManifest: TranslatorManifest = {
  name: "test",
  description: "Test translator",
  actions: [
    { name: "trigger/boom", type: "trigger", description: "Boom" },
    {
      name: "trigger/unmute_track",
      type: "trigger",
      description: "Unmute",
      args: { track: { type: "enum", values: ["pad", "bass", "perc", "texture"], required: true } },
    },
    { name: "set/filter_cutoff", type: "set", description: "Filter" },
  ],
};

describe("Manifest-aware validation", () => {
  it("passes when all actions exist in manifest", () => {
    const scene = validScene();
    scene.intents = { add_energy: [{ action: "trigger/boom", weight: 1 }] };
    expect(validateScene(scene, testManifest)).toEqual([]);
  });

  it("catches unknown action name", () => {
    const scene = validScene();
    scene.intents = { add_energy: [{ action: "trigger/nope", weight: 1 }] };
    const errors = validateScene(scene, testManifest);
    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain("trigger/nope");
    expect(errors[0].message).toContain("not found in translator manifest");
  });

  it("catches missing required arg", () => {
    const scene = validScene();
    scene.intents = { add_energy: [{ action: "trigger/unmute_track", weight: 1 }] };
    const errors = validateScene(scene, testManifest);
    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain("Required arg");
    expect(errors[0].message).toContain("track");
  });

  it("catches invalid enum value", () => {
    const scene = validScene();
    scene.intents = {
      add_energy: [{ action: "trigger/unmute_track", args: { track: "drums" }, weight: 1 }],
    };
    const errors = validateScene(scene, testManifest);
    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain("drums");
    expect(errors[0].message).toContain("pad, bass, perc, texture");
  });

  it("accepts valid enum value", () => {
    const scene = validScene();
    scene.intents = {
      add_energy: [{ action: "trigger/unmute_track", args: { track: "perc" }, weight: 1 }],
    };
    expect(validateScene(scene, testManifest)).toEqual([]);
  });

  it("validates trajectory window must be integer >= 2", () => {
    const scene = validScene();
    scene.readings[0].trajectory = { window: 1, above: 0.05 };
    const errors = validateScene(scene);
    expect(errors.length).toBe(1);
    expect(errors[0].path).toContain("trajectory.window");
  });

  it("validates trajectory window rejects non-integer", () => {
    const scene = validScene();
    scene.readings[0].trajectory = { window: 3.5, above: 0.05 };
    const errors = validateScene(scene);
    expect(errors.length).toBe(1);
    expect(errors[0].path).toContain("trajectory.window");
  });

  it("warns when trajectory has neither above nor below", () => {
    const scene = validScene();
    scene.readings[0].trajectory = { window: 5 };
    const errors = validateScene(scene);
    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain("no effect");
  });

  it("accepts valid trajectory config", () => {
    const scene = validScene();
    scene.readings[0].trajectory = { window: 5, above: 0.05 };
    expect(validateScene(scene)).toEqual([]);
  });

  it("accepts trajectory with below only", () => {
    const scene = validScene();
    scene.readings[0].trajectory = { window: 5, below: -0.05 };
    expect(validateScene(scene)).toEqual([]);
  });

  it("skips manifest validation when no manifest provided", () => {
    const scene = validScene();
    scene.intents = { add_energy: [{ action: "trigger/anything", weight: 1 }] };
    expect(validateScene(scene)).toEqual([]);
  });

  it("validates IntentPoolConfig format", () => {
    const scene = validScene();
    scene.intents = {
      add_energy: { pool: [{ action: "trigger/nope", weight: 1 }], deterministic: true },
    };
    const errors = validateScene(scene, testManifest);
    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain("trigger/nope");
  });
});

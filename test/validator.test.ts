import { describe, it, expect } from "vitest";
import { validateScene } from "../src/scenes/validator.js";
import type { SceneConfig } from "../src/types.js";

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

import { describe, it, expect } from "vitest";
import { validateScene, assertSceneValid, SceneValidationError } from "../src/scenes/validator.js";
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

  it("warns when field_intensity is the only mix quality (anti-domination lint)", () => {
    const scene = validScene();
    // crowd-scoped so the relational-quality S4 warning does not also fire. This
    // test isolates the field_intensity monotonic lint.
    scene.readings[0].scope = "crowd";
    scene.readings[0].mix = { field_intensity: 1.0 };
    const errors = validateScene(scene);
    expect(errors.length).toBe(1);
    expect(errors[0].severity).toBe("warning");
    expect(errors[0].message).toContain("monotonic");
  });

  it("does not warn when field_intensity is mixed with a non-monotonic quality", () => {
    const scene = validScene();
    scene.readings[0].scope = "crowd";
    scene.readings[0].mix = { field_intensity: 0.5, cohesion: 0.5 };
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

describe("Action prefix check (S1, manifest-independent)", () => {
  it("rejects an action with no trigger/ or set/ prefix, even without a manifest", () => {
    const scene = validScene();
    scene.intents = { add_energy: [{ action: "unmute_track", weight: 1 }] };
    const errors = validateScene(scene);
    expect(errors.length).toBe(1);
    expect(errors[0].path).toBe("intents.add_energy[0].action");
    expect(errors[0].message).toContain("must start with");
  });

  it("accepts trigger/ and set/ prefixed actions without a manifest", () => {
    const scene = validScene();
    scene.intents = {
      add_energy: [
        { action: "trigger/boom", weight: 1 },
        { action: "set/filter_cutoff", weight: 1 },
      ],
    };
    expect(validateScene(scene)).toEqual([]);
  });

  it("flags the prefix even inside an IntentPoolConfig", () => {
    const scene = validScene();
    scene.intents = { add_energy: { pool: [{ action: "boom", weight: 1 }] } };
    const errors = validateScene(scene);
    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain("must start with");
  });
});

describe("assertSceneValid (the load gate)", () => {
  it("returns no warnings for a clean scene", () => {
    expect(assertSceneValid(validScene()).warnings).toEqual([]);
  });

  it("throws SceneValidationError on a blocking finding", () => {
    const scene = validScene();
    scene.readings[0].mix = { velocty: 1 };
    expect(() => assertSceneValid(scene)).toThrow(SceneValidationError);
  });

  it("carries the blocking findings on the thrown error", () => {
    const scene = validScene();
    scene.intents = { add_energy: [{ action: "no_prefix", weight: 1 }] };
    try {
      assertSceneValid(scene);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SceneValidationError);
      expect((err as SceneValidationError).errors.length).toBe(1);
    }
  });

  it("does NOT throw on warning-only findings, and returns them", () => {
    const scene = validScene();
    scene.readings[0].scope = "crowd";
    scene.readings[0].mix = { field_intensity: 1 }; // anti-domination lint → warning
    const { warnings } = assertSceneValid(scene);
    expect(warnings.length).toBe(1);
    expect(warnings[0].severity).toBe("warning");
  });

  it("returns the parsed scene on success", () => {
    const result = assertSceneValid(validScene());
    expect(result.scene.name).toBe("test");
  });
});

// ─── Layer 1: structural schema (zod) ──────────────────────────────────────────
// These go through assertSceneValid because that is where SceneSchema.parse runs.
// Each is a category-C type/shape failure the semantic validator cannot see.
describe("Structural schema (Layer 1)", () => {
  // raw(): an untyped scene we can deliberately malform without TS complaining.
  function raw(): any {
    return JSON.parse(
      JSON.stringify({
        name: "test",
        dancers: [{ id: "maya" }],
        readings: [
          { id: "energy", mix: { velocity: 1 }, gate: { velocity: { above: 0.2 } }, intents: ["go"] },
        ],
        intents: { go: [{ action: "trigger/boom", weight: 1 }] },
        translator: { type: "osc", port: 12000 },
      }),
    );
  }

  it("C1: rejects gate written as an array instead of a record", () => {
    const scene = raw();
    scene.readings[0].gate = [{ quality: "velocity", above: 0.2 }];
    expect(() => assertSceneValid(scene)).toThrow(SceneValidationError);
  });

  it("C2: rejects a mix weight written as a string", () => {
    const scene = raw();
    scene.readings[0].mix = { velocity: "0.6" };
    expect(() => assertSceneValid(scene)).toThrow(SceneValidationError);
  });

  it("C3: rejects an intents entry that is neither array nor { pool }", () => {
    const scene = raw();
    scene.intents = { go: { actions: [{ action: "trigger/boom", weight: 1 }] } };
    expect(() => assertSceneValid(scene)).toThrow(SceneValidationError);
  });

  it("C5: rejects an intent option missing its weight", () => {
    const scene = raw();
    scene.intents = { go: [{ action: "trigger/boom" }] };
    expect(() => assertSceneValid(scene)).toThrow(SceneValidationError);
  });

  it("C7: rejects a dancer missing its id", () => {
    const scene = raw();
    scene.dancers = [{ adapter: "imu" }];
    expect(() => assertSceneValid(scene)).toThrow(SceneValidationError);
  });

  it("strict keys: rejects a typo'd settings key", () => {
    const scene = raw();
    scene.settings = { hystersis_band: 0.1 };
    expect(() => assertSceneValid(scene)).toThrow(SceneValidationError);
  });

  it("strict keys: rejects a typo'd / stray key on a threshold intent (C4)", () => {
    const scene = raw();
    scene.readings[0].intents = [{ intent: "go", range: [0.3, 0.7] }];
    expect(() => assertSceneValid(scene)).toThrow(SceneValidationError);
  });

  it("maps zod issues into findings with a path", () => {
    const scene = raw();
    scene.readings[0].mix = { velocity: "0.6" };
    try {
      assertSceneValid(scene);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SceneValidationError);
      const e = err as SceneValidationError;
      expect(e.errors.length).toBeGreaterThan(0);
      expect(e.errors[0].path).toContain("readings");
    }
  });
});

// ─── Layer 2: new semantic warnings S2–S5 ──────────────────────────────────────
describe("Semantic warnings S2–S5", () => {
  it("S2: warns on prefix/type mismatch against the manifest", () => {
    const scene = validScene();
    // set/filter_cutoff is type "set" in the manifest; calling it as trigger/ mismatches.
    scene.intents = { add_energy: [{ action: "trigger/filter_cutoff", weight: 1 }] };
    const manifest: TranslatorManifest = {
      name: "t",
      description: "",
      actions: [{ name: "trigger/filter_cutoff", type: "set", description: "" }],
    };
    const errors = validateScene(scene, manifest);
    const s2 = errors.filter((e) => e.message.includes("prefix/type mismatch"));
    expect(s2.length).toBe(1);
    expect(s2[0].severity).toBe("warning");
  });

  it("S3: warns when a threshold-form intent has neither above nor below", () => {
    const scene = validScene();
    scene.readings[0].intents = [{ intent: "add_energy" } as any];
    const errors = validateScene(scene);
    const s3 = errors.filter((e) => e.message.includes("fires unconditionally"));
    expect(s3.length).toBe(1);
    expect(s3[0].severity).toBe("warning");
  });

  it("S4: warns when a per_dancer reading references a relational-only quality", () => {
    const scene = validScene();
    scene.readings[0].mix = { cohesion: 1 }; // default scope per_dancer
    const errors = validateScene(scene);
    const s4 = errors.filter((e) => e.message.includes('Add scope: "crowd"'));
    expect(s4.length).toBe(1);
    expect(s4[0].severity).toBe("warning");
  });

  it("S4: does not warn when the relational quality is crowd-scoped", () => {
    const scene = validScene();
    scene.readings[0].scope = "crowd";
    scene.readings[0].mix = { cohesion: 1 };
    expect(validateScene(scene)).toEqual([]);
  });

  it("S5: warns on a gate threshold far outside [0,1]", () => {
    const scene = validScene();
    scene.readings[0].gate = { velocity: { above: 5 } };
    const errors = validateScene(scene);
    const s5 = errors.filter((e) => e.message.includes("normalized [0,1]"));
    expect(s5.length).toBe(1);
    expect(s5[0].severity).toBe("warning");
  });

  it("S5: warns on a negative mix weight", () => {
    const scene = validScene();
    scene.readings[0].mix = { velocity: -0.5, jerkiness: 0.5 };
    const errors = validateScene(scene);
    const s5 = errors.filter((e) => e.message.includes("Negative mix weight"));
    expect(s5.length).toBe(1);
    expect(s5[0].severity).toBe("warning");
  });

  it("S5: warns on an intent pool whose weights sum to 0", () => {
    const scene = validScene();
    scene.intents = { add_energy: [{ action: "trigger/boom", weight: 0 }] };
    const errors = validateScene(scene);
    const s5 = errors.filter((e) => e.message.includes("no positive weight"));
    expect(s5.length).toBe(1);
    expect(s5[0].severity).toBe("warning");
  });
});

// Drift guard: the validator keeps two quality lists (VALID_QUALITIES and the
// relational-only subset used by S4). Neither set is exported, so we guard the
// "relational-only ⊆ valid" invariant behaviorally: each relational quality must
// be recognized (no "Unknown quality name") AND must trip the S4 per_dancer warning.
// If a name drops out of either list, the matching case below fails.
describe("Relational quality lists stay in sync (S4 drift guard)", () => {
  const RELATIONAL_ONLY = [
    "cohesion", "dissent", "unison", "fragmentation",
    "energy_spread", "field_intensity", "convergence",
    "lead_strength", "contrast", "aggregate_energy",
  ];

  for (const quality of RELATIONAL_ONLY) {
    it(`"${quality}" is a recognized quality and trips S4 when per_dancer-scoped`, () => {
      const scene = validScene();
      scene.readings[0].mix = { [quality]: 1 };
      const errors = validateScene(scene);
      expect(errors.some((e) => e.message.includes("Unknown quality name"))).toBe(false);
      const s4 = errors.filter((e) => e.message.includes('Add scope: "crowd"'));
      expect(s4.length).toBe(1);
    });
  }
});

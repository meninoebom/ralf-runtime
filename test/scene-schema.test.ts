import { describe, it, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { SceneSchema } from "../src/scenes/scene-schema.js";

const SCENES_DIR = join(process.cwd(), "scenes");

/**
 * The drift guard. If `types.ts` and `scene-schema.ts` diverge, a real scene file
 * stops parsing and this fails. This is the single test that keeps the
 * hand-written schema honest.
 */
describe("SceneSchema round-trips real scene files", () => {
  it("parses every scene in scenes/*.json", async () => {
    const files = (await readdir(SCENES_DIR)).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const raw = JSON.parse(await readFile(join(SCENES_DIR, file), "utf-8"));
      const result = SceneSchema.safeParse(raw);
      if (!result.success) {
        throw new Error(`${file} failed schema:\n${JSON.stringify(result.error.issues, null, 2)}`);
      }
    }
  });

  it("parses the default scene shape from index.ts", () => {
    const defaultScene = {
      name: "default",
      dancers: [{ id: "dancer1", input: { type: "mediapipe", port: 6448 } }],
      readings: [
        {
          id: "energy",
          mix: { velocity: 0.5, jerkiness: 0.5 },
          gate: { velocity: { above: 0.2 } },
          intents: ["add_energy"],
        },
      ],
      intents: {
        add_energy: [
          { action: "set/filter_cutoff", weight: 3 },
          { action: "trigger/unmute_track", args: { track: "perc" }, weight: 2 },
        ],
      },
      translator: { type: "osc", port: 12000 },
    };
    expect(SceneSchema.safeParse(defaultScene).success).toBe(true);
  });
});

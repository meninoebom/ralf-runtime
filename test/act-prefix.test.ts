import { describe, it, expect } from "vitest";
import { act } from "../src/primitives/act.js";

describe("Act trigger/set prefix", () => {
  it("trigger prefix produces correct address", () => {
    const msg = act({ action: "trigger/fire_next_scene", weight: 1 }, 0.91);
    expect(msg.address).toBe("/ralf/act/trigger/fire_next_scene");
    expect(msg.args[0]).toBe(0.91);
  });

  it("set prefix produces correct address", () => {
    const msg = act({ action: "set/filter_cutoff", weight: 1 }, 0.73);
    expect(msg.address).toBe("/ralf/act/set/filter_cutoff");
    expect(msg.args[0]).toBe(0.73);
  });

  it("backward compat — no prefix still works", () => {
    const msg = act({ action: "filter_cutoff", weight: 1 }, 0.5);
    expect(msg.address).toBe("/ralf/act/filter_cutoff");
  });

  it("args are passed through with prefix", () => {
    const msg = act(
      { action: "trigger/unmute_track", args: { track: "perc" }, weight: 1 },
      0.85
    );
    expect(msg.address).toBe("/ralf/act/trigger/unmute_track");
    expect(msg.args).toEqual([0.85, "perc"]);
  });
});

import { describe, it, expect } from "vitest";
import { AdaptiveRange } from "../src/primitives/adaptive-range.js";
import { Sense } from "../src/primitives/sense.js";
import { Recognize } from "../src/primitives/recognize.js";
import { Accumulate } from "../src/primitives/accumulate.js";
import { combine } from "../src/primitives/combine.js";
import { draw } from "../src/primitives/draw.js";
import { evaluateGate } from "../src/primitives/gate.js";
import { act } from "../src/primitives/act.js";

describe("AdaptiveRange", () => {
  it("normalizes values to 0-1", () => {
    const ar = new AdaptiveRange(0, 0, 0);
    ar.update(0);
    ar.update(100);
    const mid = ar.update(50);
    expect(mid).toBeCloseTo(0.5, 1);
  });

  it("returns 0.5 when range is zero", () => {
    const ar = new AdaptiveRange(0, 0, 0);
    expect(ar.update(5)).toBe(0.5);
  });
});

describe("Sense", () => {
  it("creates adaptive ranges per quality", () => {
    const sense = new Sense();
    sense.update("velocity", 0);
    sense.update("velocity", 100);
    const v = sense.update("velocity", 50);
    expect(v).toBeCloseTo(0.5, 1);
  });
});

describe("Recognize", () => {
  it("fires a gesture and enforces cooldown", () => {
    const rec = new Recognize(500);
    expect(rec.receive("jack", 1000)).toBe("jack");
    expect(rec.receive("jack", 1200)).toBeNull(); // too soon
    expect(rec.receive("jack", 1600)).toBe("jack"); // after cooldown
  });
});

describe("Accumulate", () => {
  it("counts in windowed mode", () => {
    const acc = new Accumulate("windowed", 1); // 1 second window
    acc.record(1000);
    acc.record(1500);
    acc.record(1800);
    expect(acc.value(1900)).toBe(3);
    expect(acc.value(2500)).toBe(2); // first one expired (1000 < 1500 cutoff)
  });

  it("counts total in counting mode", () => {
    const acc = new Accumulate("counting");
    acc.record(0);
    acc.record(0);
    acc.record(0);
    expect(acc.value(0)).toBe(3);
  });
});

describe("Combine", () => {
  it("produces weighted mix of qualities", () => {
    const result = combine(
      { id: "test", mix: { velocity: 0.6, jerkiness: 0.4 } },
      { velocity: 1.0, jerkiness: 0.5 }
    );
    expect(result.value).toBeCloseTo(0.8, 2);
    expect(result.active).toBe(true);
  });

  it("gates based on conditions", () => {
    const result = combine(
      {
        id: "test",
        mix: { velocity: 1.0 },
        gate: { velocity: { above: 0.5 } },
      },
      { velocity: 0.3 }
    );
    expect(result.active).toBe(false);
  });
});

describe("Roll", () => {
  it("picks from weighted options", () => {
    const options = [
      { action: "a", weight: 100 },
      { action: "b", weight: 0 },
    ];
    const result = draw(options);
    expect(result?.action).toBe("a");
  });

  it("returns null for empty pool", () => {
    expect(draw([])).toBeNull();
  });

  it("returns null when all weights are zero", () => {
    expect(draw([{ action: "a", weight: 0 }])).toBeNull();
  });

  it("ignores negative weights", () => {
    const result = draw([
      { action: "a", weight: -5 },
      { action: "b", weight: 10 },
    ]);
    expect(result?.action).toBe("b");
  });
});

describe("Gate", () => {
  it("evaluates AND conditions", () => {
    const result = evaluateGate(
      [
        { source: "velocity", above: 0.5 },
        { source: "jerkiness", above: 0.3 },
      ],
      "and",
      { velocity: 0.7, jerkiness: 0.4 },
      0,
      1000
    );
    expect(result).toBe(true);
  });

  it("respects cooldown", () => {
    const result = evaluateGate(
      [{ source: "velocity", above: 0.1, cooldown: 5 }],
      "and",
      { velocity: 0.5 },
      998, // last pass 2ms ago
      1000
    );
    expect(result).toBe(false);
  });
});

describe("Act", () => {
  it("creates /ralf/act/ messages", () => {
    const msg = act({ action: "filter_cutoff", weight: 1 });
    expect(msg.address).toBe("/ralf/act/filter_cutoff");
  });

  it("includes reading value and args", () => {
    const msg = act(
      { action: "mute_track", args: { track: "perc" }, weight: 1 },
      0.7
    );
    expect(msg.args).toEqual([0.7, "perc"]);
  });

  it("passes reading value without args", () => {
    const msg = act({ action: "boom", weight: 1 }, 0.42);
    expect(msg.args).toEqual([0.42]);
  });
});

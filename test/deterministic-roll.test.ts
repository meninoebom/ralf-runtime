import { describe, it, expect } from "vitest";
import { roll } from "../src/primitives/roll.js";

describe("Roll deterministic mode", () => {
  it("always picks highest weight", () => {
    const options = [
      { action: "a", weight: 1 },
      { action: "b", weight: 5 },
      { action: "c", weight: 3 },
    ];
    for (let i = 0; i < 20; i++) {
      expect(roll(options, true)?.action).toBe("b");
    }
  });

  it("ties pick first occurrence", () => {
    const options = [
      { action: "first", weight: 5 },
      { action: "second", weight: 5 },
    ];
    for (let i = 0; i < 20; i++) {
      expect(roll(options, true)?.action).toBe("first");
    }
  });

  it("non-deterministic mode still works", () => {
    const options = [
      { action: "a", weight: 100 },
      { action: "b", weight: 0 },
    ];
    expect(roll(options, false)?.action).toBe("a");
  });

  it("returns null for empty pool in deterministic mode", () => {
    expect(roll([], true)).toBeNull();
  });

  it("returns null when all weights zero in deterministic mode", () => {
    expect(roll([{ action: "a", weight: 0 }], true)).toBeNull();
  });
});

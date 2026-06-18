import { describe, it, expect } from "vitest";
import { computeRelational } from "../src/engine/relational.js";
import type { DancerState, QualityName } from "../src/types.js";

const QUALITY_NAMES: QualityName[] = [
  "velocity", "acceleration", "jerkiness", "energy", "spatial_extent",
  "contraction", "symmetry", "coherence", "verticality", "heading",
  "stillness", "periodicity", "groundedness", "synchrony", "contrast",
  "aggregate_velocity",
];

function makeDancer(id: string, overrides: Partial<Record<QualityName, number>> = {}): DancerState {
  const qualities = Object.fromEntries(QUALITY_NAMES.map((q) => [q, 0])) as Record<QualityName, number>;
  Object.assign(qualities, overrides);
  return { id, qualities, lastGesture: null, lastGestureTime: 0 };
}

describe("computeRelational — synchrony divisor (audit finding 6)", () => {
  it("synchrony is not diluted by pairs that lack history", () => {
    // A and B have identical histories (Pearson = 1). C has no history, so the
    // pairs (A,C) and (B,C) cannot be evaluated and must enter neither the
    // numerator nor the denominator.
    const dancers = new Map<string, DancerState>([
      ["A", makeDancer("A")],
      ["B", makeDancer("B")],
      ["C", makeDancer("C")],
    ]);
    const histories = new Map<string, number[]>([
      ["A", [1, 2, 3, 4, 5]],
      ["B", [1, 2, 3, 4, 5]],
      // C: intentionally absent
    ]);

    const { synchrony } = computeRelational(dancers, histories);

    // Only the (A,B) pair contributes: synchrony == its correlation (1.0).
    // The old code divided by all 3 pairs and would have returned ~0.33.
    expect(synchrony).toBeCloseTo(1, 5);
  });

  it("returns 0 synchrony when no pair has enough history", () => {
    const dancers = new Map<string, DancerState>([
      ["A", makeDancer("A")],
      ["B", makeDancer("B")],
    ]);
    const histories = new Map<string, number[]>(); // neither has history
    expect(computeRelational(dancers, histories).synchrony).toBe(0);
  });
});

describe("computeRelational — aggregate_velocity (audit finding 7)", () => {
  it("aggregates the velocity quality and exposes it as aggregate_velocity", () => {
    const dancers = new Map<string, DancerState>([
      ["A", makeDancer("A", { velocity: 0.4 })],
      ["B", makeDancer("B", { velocity: 0.6 })],
    ]);
    const result = computeRelational(dancers, new Map());

    expect(result).toHaveProperty("aggregate_velocity");
    expect(result).not.toHaveProperty("aggregate_energy");
    expect(result.aggregate_velocity).toBeCloseTo(0.5, 5);
  });

  it("ignores virtual dancers (ids starting with _) and returns zeros below 2 dancers", () => {
    const dancers = new Map<string, DancerState>([["A", makeDancer("A", { velocity: 0.9 })]]);
    expect(computeRelational(dancers, new Map())).toEqual({
      synchrony: 0,
      contrast: 0,
      aggregate_velocity: 0,
    });
  });
});

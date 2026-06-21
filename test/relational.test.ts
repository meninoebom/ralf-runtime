import { describe, it, expect } from "vitest";
import { computeRelational } from "../src/engine/relational.js";
import type { DancerState } from "../src/types.js";

function makeDancer(id: string): DancerState {
  return {
    id,
    qualities: {
      velocity: 0.5, acceleration: 0, jerkiness: 0, energy: 0,
      spatial_extent: 0, contraction: 0, symmetry: 0, coherence: 0,
      verticality: 0, heading: 0, stillness: 0, periodicity: 0,
      groundedness: 0, cohesion: 0, synchrony: 0, contrast: 0, aggregate_energy: 0,
    },
    lastUpdate: 0,
    stale: false,
  };
}

function makeHistory(values: number[]): number[] {
  return values;
}

describe("computeRelational — cohesion", () => {
  it("returns positive cohesion when dancers move together", () => {
    const dancers = new Map([
      ["d1", makeDancer("d1")],
      ["d2", makeDancer("d2")],
    ]);
    const rising = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    const histories = new Map([
      ["d1", makeHistory(rising)],
      ["d2", makeHistory(rising)],
    ]);
    const result = computeRelational(dancers, histories);
    expect(result.cohesion).toBeCloseTo(1.0, 2);
    expect(result.synchrony).toBeCloseTo(1.0, 2); // deprecated alias matches
  });

  it("returns negative cohesion for anti-correlated dancers (the key behavior change)", () => {
    const dancers = new Map([
      ["d1", makeDancer("d1")],
      ["d2", makeDancer("d2")],
    ]);
    const rising  = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    const falling = [1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1];
    const histories = new Map([
      ["d1", makeHistory(rising)],
      ["d2", makeHistory(falling)],
    ]);
    const result = computeRelational(dancers, histories);
    expect(result.cohesion).toBeLessThan(0); // anti-synchrony is preserved
    expect(result.cohesion).toBeCloseTo(-1.0, 2);
  });

  it("synchrony deprecated alias clamps cohesion to 0..1", () => {
    const dancers = new Map([
      ["d1", makeDancer("d1")],
      ["d2", makeDancer("d2")],
    ]);
    const rising  = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    const falling = [1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1];
    const histories = new Map([
      ["d1", makeHistory(rising)],
      ["d2", makeHistory(falling)],
    ]);
    const result = computeRelational(dancers, histories);
    expect(result.synchrony).toBe(0); // clamped — existing scenes see 0, not negative
    expect(result.cohesion).toBeLessThan(0); // but cohesion shows the real sign
  });

  it("returns zero cohesion for unrelated movement", () => {
    const dancers = new Map([
      ["d1", makeDancer("d1")],
      ["d2", makeDancer("d2")],
    ]);
    // Identical constant histories — Pearson returns 0 when there is no variance
    const flat = [0.5, 0.5, 0.5, 0.5, 0.5];
    const histories = new Map([
      ["d1", makeHistory(flat)],
      ["d2", makeHistory(flat)],
    ]);
    const result = computeRelational(dancers, histories);
    expect(result.cohesion).toBe(0);
  });

  it("returns zero when fewer than 2 dancers", () => {
    const dancers = new Map([["d1", makeDancer("d1")]]);
    const histories = new Map([["d1", [0.5, 0.6, 0.7]]]);
    const result = computeRelational(dancers, histories);
    expect(result.cohesion).toBe(0);
    expect(result.synchrony).toBe(0);
  });
});

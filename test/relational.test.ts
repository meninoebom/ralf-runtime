import { describe, it, expect } from "vitest";
import { computeRelational } from "../src/engine/relational.js";
import type { DancerState, QualityName } from "../src/types.js";

function makeDancer(id: string, velocity = 0.5): DancerState {
  return {
    id,
    qualities: {
      velocity, acceleration: 0, jerkiness: 0, energy: 0,
      spatial_extent: 0, contraction: 0, symmetry: 0, coherence: 0,
      verticality: 0, heading: 0, stillness: 0, periodicity: 0,
      groundedness: 0, cohesion: 0, synchrony: 0, dissent: 0,
      unison: 0, fragmentation: 0, energy_spread: 0,
      field_intensity: 0, contrast: 0, aggregate_energy: 0,
    },
    lastGesture: null,
    lastGestureTime: 0,
    stale: false,
  };
}

const RISING  = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
const FALLING = [1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1];
const FLAT    = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];

// --- cohesion ---

describe("cohesion (mean-field, leave-one-out)", () => {
  it("is +1 when all dancers move together", () => {
    const dancers = new Map([["d1", makeDancer("d1")], ["d2", makeDancer("d2")]]);
    const histories = new Map([["d1", RISING], ["d2", RISING]]);
    const r = computeRelational(dancers, histories);
    expect(r.cohesion).toBeCloseTo(1.0, 2);
  });

  it("is negative when dancers are anti-correlated (the key step-1 change)", () => {
    const dancers = new Map([["d1", makeDancer("d1")], ["d2", makeDancer("d2")]]);
    const histories = new Map([["d1", RISING], ["d2", FALLING]]);
    const r = computeRelational(dancers, histories);
    expect(r.cohesion).toBeLessThan(0);
    expect(r.cohesion).toBeCloseTo(-1.0, 2);
  });

  it("is 0 when histories have no variance", () => {
    const dancers = new Map([["d1", makeDancer("d1")], ["d2", makeDancer("d2")]]);
    const histories = new Map([["d1", FLAT], ["d2", FLAT]]);
    const r = computeRelational(dancers, histories);
    expect(r.cohesion).toBe(0);
  });

  it("is 0 and synchrony is 0 when fewer than 2 dancers", () => {
    const dancers = new Map([["d1", makeDancer("d1")]]);
    const histories = new Map([["d1", RISING]]);
    const r = computeRelational(dancers, histories);
    expect(r.cohesion).toBe(0);
    expect(r.synchrony).toBe(0);
  });
});

// --- synchrony deprecated alias ---

describe("synchrony (deprecated clamped alias)", () => {
  it("matches cohesion for positive correlation", () => {
    const dancers = new Map([["d1", makeDancer("d1")], ["d2", makeDancer("d2")]]);
    const histories = new Map([["d1", RISING], ["d2", RISING]]);
    const r = computeRelational(dancers, histories);
    expect(r.synchrony).toBeCloseTo(r.cohesion, 5);
  });

  it("is 0 when cohesion is negative (anti-phase reads as 0 to old scenes)", () => {
    const dancers = new Map([["d1", makeDancer("d1")], ["d2", makeDancer("d2")]]);
    const histories = new Map([["d1", RISING], ["d2", FALLING]]);
    const r = computeRelational(dancers, histories);
    expect(r.synchrony).toBe(0);
    expect(r.cohesion).toBeLessThan(0);
  });
});

// --- dissent ---

describe("dissent", () => {
  it("is 0 when all dancers move together", () => {
    const dancers = new Map([["d1", makeDancer("d1")], ["d2", makeDancer("d2")]]);
    const histories = new Map([["d1", RISING], ["d2", RISING]]);
    const r = computeRelational(dancers, histories);
    expect(r.dissent).toBe(0);
  });

  it("rises when a dancer strongly anti-correlates with the field", () => {
    const d1 = makeDancer("d1"); const d2 = makeDancer("d2"); const d3 = makeDancer("d3");
    const dancers = new Map([["d1", d1], ["d2", d2], ["d3", d3]]);
    // d1 and d2 rise together, d3 falls against them
    const histories = new Map([["d1", RISING], ["d2", RISING], ["d3", FALLING]]);
    const r = computeRelational(dancers, histories);
    expect(r.dissent).toBeGreaterThan(0);
  });

  it("is 1 when every dancer is anti-correlated with the field (all going opposite ways)", () => {
    // With just 2 dancers perfectly anti-correlated, both read against each other's field
    const dancers = new Map([["d1", makeDancer("d1")], ["d2", makeDancer("d2")]]);
    const histories = new Map([["d1", RISING], ["d2", FALLING]]);
    const r = computeRelational(dancers, histories);
    expect(r.dissent).toBe(1.0);
  });
});

// --- unison ---

describe("unison", () => {
  it("is 1 when all dancers have identical quality vectors", () => {
    const d1 = makeDancer("d1", 0.6); const d2 = makeDancer("d2", 0.6);
    const dancers = new Map([["d1", d1], ["d2", d2]]);
    const histories = new Map([["d1", RISING], ["d2", RISING]]);
    const r = computeRelational(dancers, histories);
    expect(r.unison).toBeCloseTo(1.0, 5);
  });

  it("is less than 1 when quality vectors differ", () => {
    const d1 = makeDancer("d1", 0.1); const d2 = makeDancer("d2", 0.9);
    const dancers = new Map([["d1", d1], ["d2", d2]]);
    const histories = new Map([["d1", RISING], ["d2", RISING]]);
    const r = computeRelational(dancers, histories);
    expect(r.unison).toBeLessThan(1.0);
  });
});

// --- fragmentation ---

describe("fragmentation", () => {
  it("is 0 when all dancers have the same velocity", () => {
    const d1 = makeDancer("d1", 0.5); const d2 = makeDancer("d2", 0.5);
    const dancers = new Map([["d1", d1], ["d2", d2]]);
    const histories = new Map([["d1", RISING], ["d2", RISING]]);
    const r = computeRelational(dancers, histories);
    expect(r.fragmentation).toBe(0);
  });

  it("is 1 when two dancers are at opposite velocity extremes", () => {
    const d1 = makeDancer("d1", 0.0); const d2 = makeDancer("d2", 1.0);
    const dancers = new Map([["d1", d1], ["d2", d2]]);
    const histories = new Map([["d1", RISING], ["d2", RISING]]);
    const r = computeRelational(dancers, histories);
    expect(r.fragmentation).toBeCloseTo(1.0, 5);
  });

  it("detects the largest gap in a 3-dancer split", () => {
    // velocities: 0.1, 0.2, 0.9 — largest gap is 0.7 (between 0.2 and 0.9), range is 0.8
    const d1 = makeDancer("d1", 0.1); const d2 = makeDancer("d2", 0.2); const d3 = makeDancer("d3", 0.9);
    const dancers = new Map([["d1", d1], ["d2", d2], ["d3", d3]]);
    const histories = new Map([["d1", RISING], ["d2", RISING], ["d3", RISING]]);
    const r = computeRelational(dancers, histories);
    expect(r.fragmentation).toBeCloseTo(0.7 / 0.8, 5);
  });
});

// --- energy_spread and field_intensity ---

describe("energy_spread and field_intensity", () => {
  it("field_intensity is the mean velocity", () => {
    const d1 = makeDancer("d1", 0.2); const d2 = makeDancer("d2", 0.8);
    const dancers = new Map([["d1", d1], ["d2", d2]]);
    const histories = new Map([["d1", RISING], ["d2", RISING]]);
    const r = computeRelational(dancers, histories);
    expect(r.field_intensity).toBeCloseTo(0.5, 5);
  });

  it("energy_spread is 0 when all velocities are equal", () => {
    const d1 = makeDancer("d1", 0.5); const d2 = makeDancer("d2", 0.5);
    const dancers = new Map([["d1", d1], ["d2", d2]]);
    const histories = new Map([["d1", RISING], ["d2", RISING]]);
    const r = computeRelational(dancers, histories);
    expect(r.energy_spread).toBeCloseTo(0, 5);
  });

  it("energy_spread is greater when velocities differ more", () => {
    const d1near = makeDancer("d1", 0.4); const d2near = makeDancer("d2", 0.6);
    const d1far  = makeDancer("d3", 0.1); const d2far  = makeDancer("d4", 0.9);
    const near = new Map([["d1", d1near], ["d2", d2near]]);
    const far  = new Map([["d3", d1far],  ["d4", d2far]]);
    const h = new Map([["d1", RISING], ["d2", RISING], ["d3", RISING], ["d4", RISING]]);
    const rNear = computeRelational(near, h);
    const rFar  = computeRelational(far, h);
    expect(rFar.energy_spread).toBeGreaterThan(rNear.energy_spread);
  });
});

// --- aggregate_energy (mean for now, becomes min in step 5) ---

describe("aggregate_energy", () => {
  it("equals field_intensity (both are mean velocity in step 2)", () => {
    const d1 = makeDancer("d1", 0.3); const d2 = makeDancer("d2", 0.7);
    const dancers = new Map([["d1", d1], ["d2", d2]]);
    const histories = new Map([["d1", RISING], ["d2", RISING]]);
    const r = computeRelational(dancers, histories);
    expect(r.aggregate_energy).toBeCloseTo(r.field_intensity, 5);
  });
});

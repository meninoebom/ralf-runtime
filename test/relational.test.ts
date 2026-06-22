import { describe, it, expect } from "vitest";
import { computeRelational, linearRegressionSlope } from "../src/engine/relational.js";
import type { DancerState, QualityName } from "../src/types.js";

function makeDancer(id: string, velocity = 0.5): DancerState {
  return {
    id,
    qualities: {
      velocity, acceleration: 0, jerkiness: 0, energy: 0,
      spatial_extent: 0, contraction: 0, symmetry: 0, coherence: 0,
      verticality: 0, heading: 0, stillness: 0, periodicity: 0,
      groundedness: 0, cohesion: 0, dissent: 0,
      unison: 0, fragmentation: 0, energy_spread: 0,
      field_intensity: 0, convergence: 0.5, lead_strength: 0, contrast: 0, aggregate_energy: 0,
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
    const r = computeRelational(dancers, histories, []);
    expect(r.cohesion).toBeCloseTo(1.0, 2);
  });

  it("is negative when dancers are anti-correlated (the key step-1 change)", () => {
    const dancers = new Map([["d1", makeDancer("d1")], ["d2", makeDancer("d2")]]);
    const histories = new Map([["d1", RISING], ["d2", FALLING]]);
    const r = computeRelational(dancers, histories, []);
    expect(r.cohesion).toBeLessThan(0);
    expect(r.cohesion).toBeCloseTo(-1.0, 2);
  });

  it("is 0 when histories have no variance", () => {
    const dancers = new Map([["d1", makeDancer("d1")], ["d2", makeDancer("d2")]]);
    const histories = new Map([["d1", FLAT], ["d2", FLAT]]);
    const r = computeRelational(dancers, histories, []);
    expect(r.cohesion).toBe(0);
  });

  it("is 0 when fewer than 2 dancers", () => {
    const dancers = new Map([["d1", makeDancer("d1")]]);
    const histories = new Map([["d1", RISING]]);
    const r = computeRelational(dancers, histories, []);
    expect(r.cohesion).toBe(0);
  });
});

// --- dissent ---

describe("dissent", () => {
  it("is 0 when all dancers move together", () => {
    const dancers = new Map([["d1", makeDancer("d1")], ["d2", makeDancer("d2")]]);
    const histories = new Map([["d1", RISING], ["d2", RISING]]);
    const r = computeRelational(dancers, histories, []);
    expect(r.dissent).toBe(0);
  });

  it("rises when a dancer strongly anti-correlates with the field", () => {
    const d1 = makeDancer("d1"); const d2 = makeDancer("d2"); const d3 = makeDancer("d3");
    const dancers = new Map([["d1", d1], ["d2", d2], ["d3", d3]]);
    // d1 and d2 rise together, d3 falls against them
    const histories = new Map([["d1", RISING], ["d2", RISING], ["d3", FALLING]]);
    const r = computeRelational(dancers, histories, []);
    expect(r.dissent).toBeGreaterThan(0);
  });

  it("is 1 when every dancer is anti-correlated with the field (all going opposite ways)", () => {
    // With just 2 dancers perfectly anti-correlated, both read against each other's field
    const dancers = new Map([["d1", makeDancer("d1")], ["d2", makeDancer("d2")]]);
    const histories = new Map([["d1", RISING], ["d2", FALLING]]);
    const r = computeRelational(dancers, histories, []);
    expect(r.dissent).toBe(1.0);
  });
});

// --- unison ---

describe("unison", () => {
  it("is 1 when all dancers have identical quality vectors", () => {
    const d1 = makeDancer("d1", 0.6); const d2 = makeDancer("d2", 0.6);
    const dancers = new Map([["d1", d1], ["d2", d2]]);
    const histories = new Map([["d1", RISING], ["d2", RISING]]);
    const r = computeRelational(dancers, histories, []);
    expect(r.unison).toBeCloseTo(1.0, 5);
  });

  it("is less than 1 when quality vectors differ", () => {
    const d1 = makeDancer("d1", 0.1); const d2 = makeDancer("d2", 0.9);
    const dancers = new Map([["d1", d1], ["d2", d2]]);
    const histories = new Map([["d1", RISING], ["d2", RISING]]);
    const r = computeRelational(dancers, histories, []);
    expect(r.unison).toBeLessThan(1.0);
  });
});

// --- fragmentation ---

describe("fragmentation", () => {
  it("is 0 when all dancers have the same velocity", () => {
    const d1 = makeDancer("d1", 0.5); const d2 = makeDancer("d2", 0.5);
    const dancers = new Map([["d1", d1], ["d2", d2]]);
    const histories = new Map([["d1", RISING], ["d2", RISING]]);
    const r = computeRelational(dancers, histories, []);
    expect(r.fragmentation).toBe(0);
  });

  it("is 1 when two dancers are at opposite velocity extremes", () => {
    const d1 = makeDancer("d1", 0.0); const d2 = makeDancer("d2", 1.0);
    const dancers = new Map([["d1", d1], ["d2", d2]]);
    const histories = new Map([["d1", RISING], ["d2", RISING]]);
    const r = computeRelational(dancers, histories, []);
    expect(r.fragmentation).toBeCloseTo(1.0, 5);
  });

  it("detects the largest gap in a 3-dancer split", () => {
    // velocities: 0.1, 0.2, 0.9 — largest gap is 0.7 (between 0.2 and 0.9), range is 0.8
    const d1 = makeDancer("d1", 0.1); const d2 = makeDancer("d2", 0.2); const d3 = makeDancer("d3", 0.9);
    const dancers = new Map([["d1", d1], ["d2", d2], ["d3", d3]]);
    const histories = new Map([["d1", RISING], ["d2", RISING], ["d3", RISING]]);
    const r = computeRelational(dancers, histories, []);
    expect(r.fragmentation).toBeCloseTo(0.7 / 0.8, 5);
  });
});

// --- energy_spread and field_intensity ---

describe("energy_spread and field_intensity", () => {
  it("field_intensity is the mean velocity", () => {
    const d1 = makeDancer("d1", 0.2); const d2 = makeDancer("d2", 0.8);
    const dancers = new Map([["d1", d1], ["d2", d2]]);
    const histories = new Map([["d1", RISING], ["d2", RISING]]);
    const r = computeRelational(dancers, histories, []);
    expect(r.field_intensity).toBeCloseTo(0.5, 5);
  });

  it("energy_spread is 0 when all velocities are equal", () => {
    const d1 = makeDancer("d1", 0.5); const d2 = makeDancer("d2", 0.5);
    const dancers = new Map([["d1", d1], ["d2", d2]]);
    const histories = new Map([["d1", RISING], ["d2", RISING]]);
    const r = computeRelational(dancers, histories, []);
    expect(r.energy_spread).toBeCloseTo(0, 5);
  });

  it("energy_spread is greater when velocities differ more", () => {
    const d1near = makeDancer("d1", 0.4); const d2near = makeDancer("d2", 0.6);
    const d1far  = makeDancer("d3", 0.1); const d2far  = makeDancer("d4", 0.9);
    const near = new Map([["d1", d1near], ["d2", d2near]]);
    const far  = new Map([["d3", d1far],  ["d4", d2far]]);
    const h = new Map([["d1", RISING], ["d2", RISING], ["d3", RISING], ["d4", RISING]]);
    const rNear = computeRelational(near, h, []);
    const rFar  = computeRelational(far, h, []);
    expect(rFar.energy_spread).toBeGreaterThan(rNear.energy_spread);
  });
});

// --- aggregate_energy (min velocity — shared floor) ---

describe("aggregate_energy", () => {
  it("is the min velocity, not the mean", () => {
    const d1 = makeDancer("d1", 0.2); const d2 = makeDancer("d2", 0.8);
    const dancers = new Map([["d1", d1], ["d2", d2]]);
    const histories = new Map([["d1", RISING], ["d2", RISING]]);
    const r = computeRelational(dancers, histories, []);
    expect(r.aggregate_energy).toBeCloseTo(0.2, 5); // min, not 0.5 (mean)
    expect(r.aggregate_energy).toBeLessThan(r.field_intensity); // floor < average
  });

  it("cannot be raised by one dancer alone when the other is still", () => {
    const d1 = makeDancer("d1", 0.0); const d2 = makeDancer("d2", 1.0);
    const dancers = new Map([["d1", d1], ["d2", d2]]);
    const histories = new Map([["d1", RISING], ["d2", RISING]]);
    const r = computeRelational(dancers, histories, []);
    expect(r.aggregate_energy).toBeCloseTo(0.0, 5); // d1 still → floor is 0
  });
});

// --- linearRegressionSlope ---

describe("linearRegressionSlope", () => {
  it("returns positive slope for rising series", () => {
    expect(linearRegressionSlope([1, 2, 3, 4, 5])).toBeGreaterThan(0);
  });

  it("returns negative slope for falling series", () => {
    expect(linearRegressionSlope([5, 4, 3, 2, 1])).toBeLessThan(0);
  });

  it("returns 0 for flat series", () => {
    expect(linearRegressionSlope([3, 3, 3, 3, 3])).toBeCloseTo(0, 5);
  });

  it("returns 0 for fewer than 2 values", () => {
    expect(linearRegressionSlope([])).toBe(0);
    expect(linearRegressionSlope([1])).toBe(0);
  });
});

// --- convergence ---

describe("convergence", () => {
  it("returns 0.5 when fewer than 2 dancers (steady / no relationship yet)", () => {
    const dancers = new Map([["d1", makeDancer("d1")]]);
    const r = computeRelational(dancers, new Map([["d1", RISING]]), []);
    expect(r.convergence).toBe(0.5);
  });

  it("returns 0.5 when |cohesion| history is flat", () => {
    const dancers = new Map([["d1", makeDancer("d1")], ["d2", makeDancer("d2")]]);
    const histories = new Map([["d1", RISING], ["d2", RISING]]);
    // Seed the buffer with a flat history of |cohesion| ≈ 1
    const buf = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    const r = computeRelational(dancers, histories, buf);
    // Slope is ~0, so convergence should be near 0.5
    expect(r.convergence).toBeCloseTo(0.5, 1);
  });

  it("returns above 0.5 when |cohesion| has been rising (dancers coming together)", () => {
    const dancers = new Map([["d1", makeDancer("d1")], ["d2", makeDancer("d2")]]);
    const histories = new Map([["d1", RISING], ["d2", RISING]]);
    // Seed buffer with a rising series so the slope is clearly positive
    const buf = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
    const r = computeRelational(dancers, histories, buf);
    expect(r.convergence).toBeGreaterThan(0.5);
  });

  it("returns below 0.5 when |cohesion| has been falling (dancers separating)", () => {
    const dancers = new Map([["d1", makeDancer("d1")], ["d2", makeDancer("d2")]]);
    const histories = new Map([["d1", RISING], ["d2", FALLING]]);
    // Seed buffer with falling series so the slope is clearly negative
    const buf = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0.0];
    const r = computeRelational(dancers, histories, buf);
    expect(r.convergence).toBeLessThan(0.5);
  });

  it("stays in 0..1 even when slope is extreme", () => {
    const dancers = new Map([["d1", makeDancer("d1")], ["d2", makeDancer("d2")]]);
    const histories = new Map([["d1", RISING], ["d2", RISING]]);
    // Extreme rising slope
    const buf = [0, 0, 0, 0, 0, 0, 0, 0, 0, 100];
    const r = computeRelational(dancers, histories, buf);
    expect(r.convergence).toBeLessThanOrEqual(1.0);
    expect(r.convergence).toBeGreaterThanOrEqual(0.0);
  });
});

// --- lead_strength + leadId ---

describe("lead_strength and leadId", () => {
  it("detects the dancer whose history leads the field", () => {
    // d1 leads by 2 frames: d1[0..w-2] should correlate with meanField[2..w]
    // Build d1 as a rising ramp, d2 following it with a 2-frame lag
    const w = 15;
    const d1hist = Array.from({ length: w }, (_, i) => i / (w - 1));
    const d2hist = [d1hist[0], d1hist[0], ...d1hist.slice(0, w - 2)]; // d2 lags d1 by 2
    const dancers = new Map([["d1", makeDancer("d1")], ["d2", makeDancer("d2")]]);
    const histories = new Map([["d1", d1hist], ["d2", d2hist]]);
    const r = computeRelational(dancers, histories, []);
    // d1 leads d2: lead_strength should be > 0 and leadId should be "d1"
    expect(r.lead_strength).toBeGreaterThan(0);
    expect(r.leadId).toBe("d1");
  });

  it("lead_strength is 0 and leadId is null when fewer than 2 dancers", () => {
    const dancers = new Map([["d1", makeDancer("d1")]]);
    const r = computeRelational(dancers, new Map([["d1", RISING]]), []);
    expect(r.lead_strength).toBe(0);
    expect(r.leadId).toBeNull();
  });

  it("lead_strength stays in 0..1", () => {
    const dancers = new Map([["d1", makeDancer("d1")], ["d2", makeDancer("d2")]]);
    const r = computeRelational(dancers, new Map([["d1", RISING], ["d2", FALLING]]), []);
    expect(r.lead_strength).toBeGreaterThanOrEqual(0);
    expect(r.lead_strength).toBeLessThanOrEqual(1);
  });
});

// --- maxDissentId ---

describe("maxDissentId", () => {
  it("identifies the most anti-correlated dancer", () => {
    const d1 = makeDancer("d1"); const d2 = makeDancer("d2"); const d3 = makeDancer("d3");
    const dancers = new Map([["d1", d1], ["d2", d2], ["d3", d3]]);
    // d1 and d2 rise together, d3 falls hard against them
    const histories = new Map([["d1", RISING], ["d2", RISING], ["d3", FALLING]]);
    const r = computeRelational(dancers, histories, []);
    expect(r.maxDissentId).toBe("d3");
  });

  it("is null when all dancers are in sync", () => {
    const dancers = new Map([["d1", makeDancer("d1")], ["d2", makeDancer("d2")]]);
    const r = computeRelational(dancers, new Map([["d1", RISING], ["d2", RISING]]), []);
    expect(r.maxDissentId).toBeNull();
  });
});

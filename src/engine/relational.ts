import type { DancerState, QualityName } from "../types.js";

export interface RelationalQualities {
  cohesion: number;        // −1..1, mean-field velocity correlation (signed; negative = anti-phase)
  /** @deprecated Use `cohesion`. Clamped alias kept for one release so existing scenes still work. */
  synchrony: number;       // 0-1, max(0, cohesion)
  dissent: number;         // 0-1, fraction of dancers strongly anti-correlated with the field
  unison: number;          // 0-1, how tightly the group clusters in quality space (1 = all identical)
  fragmentation: number;   // 0-1, how strongly the group splits into two sub-groups
  energy_spread: number;   // 0-1, stddev of velocity across dancers (texture at equal mean)
  field_intensity: number; // 0-1, mean velocity across all dancers (room loudness — validator-restricted)
  convergence: number;     // 0-1, rate of change in |cohesion| (0.5 = steady, >0.5 = coming together)
  contrast: number;        // 0-1, mean pairwise quality distance (kept for backwards compat)
  aggregate_energy: number;// 0-1, mean velocity (will become min in step 5)
}

const EMPTY: RelationalQualities = {
  cohesion: 0, synchrony: 0, dissent: 0, unison: 1,
  fragmentation: 0, energy_spread: 0, field_intensity: 0,
  convergence: 0.5,  // 0.5 = steady (no relationship yet to converge toward)
  contrast: 0, aggregate_energy: 0,
};

// Windowed linear regression slope — shared with the runtime trajectory gate.
export function linearRegressionSlope(buf: number[]): number {
  const n = buf.length;
  if (n < 2) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += buf[i]; sumXY += i * buf[i]; sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
}

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  let sumA = 0, sumB = 0;
  for (let i = 0; i < n; i++) { sumA += a[i]; sumB += b[i]; }
  const meanA = sumA / n, meanB = sumB / n;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA, db = b[i] - meanB;
    num += da * db; denA += da * da; denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den === 0 ? 0 : num / den;
}

const SOLO_QUALITY_KEYS: QualityName[] = [
  "velocity", "acceleration", "jerkiness", "energy", "spatial_extent",
  "contraction", "symmetry", "coherence", "verticality", "heading",
  "stillness", "periodicity", "groundedness",
];

// Slope → convergence scaling constant. At 30fps a slope of 0.05/frame
// (|cohesion| rising by 1.0 in 20 frames) maps to convergence = 1.0.
const CONVERGENCE_K = 10;

export function computeRelational(
  dancers: Map<string, DancerState>,
  velocityHistories: Map<string, number[]>,
  cohesionHistory: number[],  // mutable ring buffer owned by caller; persists between ticks
  windowSize: number = 20,
): RelationalQualities {
  const ids = [...dancers.keys()].filter(id => !id.startsWith("_"));
  if (ids.length < 2) return EMPTY;

  const n = ids.length;

  // --- Build windowed velocity history for each dancer ---
  const histories: (number[] | null)[] = ids.map(id => {
    const h = velocityHistories.get(id);
    return (h && h.length >= 2) ? h.slice(-windowSize) : null;
  });

  // Window length = shortest available history across all dancers
  const validHistories = histories.filter((h): h is number[] => h !== null);
  if (validHistories.length < 2) return EMPTY;
  const w = Math.min(...validHistories.map(h => h.length));

  // --- Leave-one-out cohesion ---
  // For each dancer d, correlate d's history against the mean of all OTHER dancers.
  // This removes self-correlation bias and makes duet (n=2) give the same result
  // as any other n without a special-case branch.
  const corrPerDancer: number[] = [];
  for (let i = 0; i < n; i++) {
    const h = histories[i];
    if (!h) continue;

    // Build leave-one-out field: mean of everyone except i
    const fieldForI: number[] = new Array(w).fill(0);
    let fieldCount = 0;
    for (let j = 0; j < n; j++) {
      const hj = histories[j];
      if (j === i || !hj) continue;
      for (let t = 0; t < w; t++) fieldForI[t] += hj[t] ?? 0;
      fieldCount++;
    }
    if (fieldCount === 0) continue;
    for (let t = 0; t < w; t++) fieldForI[t] /= fieldCount;

    corrPerDancer.push(pearson(h.slice(0, w), fieldForI));
  }

  const cohesion = corrPerDancer.length > 0
    ? corrPerDancer.reduce((a, b) => a + b, 0) / corrPerDancer.length
    : 0;
  const synchrony = Math.max(0, cohesion);
  const dissent = corrPerDancer.filter(c => c < -0.3).length / n;

  // Convergence: slope of |cohesion| over time, mapped to 0..1 (0.5 = steady)
  cohesionHistory.push(Math.abs(cohesion));
  if (cohesionHistory.length > windowSize) cohesionHistory.splice(0, cohesionHistory.length - windowSize);
  const slope = linearRegressionSlope(cohesionHistory);
  const convergence = 0.5 + Math.max(-0.5, Math.min(0.5, slope * CONVERGENCE_K));

  // --- Unison: how tightly the group clusters in 13-D quality space ---
  const centroid: Record<string, number> = {};
  for (const q of SOLO_QUALITY_KEYS) {
    let sum = 0;
    for (const id of ids) sum += dancers.get(id)!.qualities[q];
    centroid[q] = sum / n;
  }
  let dispersionSum = 0;
  for (const id of ids) {
    const q = dancers.get(id)!.qualities;
    let dist2 = 0;
    for (const key of SOLO_QUALITY_KEYS) {
      const d = q[key] - centroid[key];
      dist2 += d * d;
    }
    dispersionSum += Math.sqrt(dist2) / Math.sqrt(SOLO_QUALITY_KEYS.length);
  }
  const unison = 1 - Math.min(1, dispersionSum / n);

  // --- Fragmentation: largest gap in sorted velocity projections ---
  const vels = ids.map(id => dancers.get(id)!.qualities.velocity).sort((a, b) => a - b);
  const velRange = vels[vels.length - 1] - vels[0];
  let maxGap = 0;
  if (velRange > 0) {
    for (let i = 1; i < vels.length; i++) maxGap = Math.max(maxGap, vels[i] - vels[i - 1]);
  }
  const fragmentation = velRange > 0 ? maxGap / velRange : 0;

  // --- Energy spread + field intensity ---
  const field_intensity = vels.reduce((a, b) => a + b, 0) / n;
  let varianceSum = 0;
  for (const v of vels) varianceSum += (v - field_intensity) ** 2;
  const energy_spread = Math.sqrt(varianceSum / n); // already 0-1 since velocities are 0-1

  // --- Contrast: kept for backwards compat (pairwise L2, O(n²)) ---
  let contrastSum = 0, contrastCount = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const qi = dancers.get(ids[i])!.qualities;
      const qj = dancers.get(ids[j])!.qualities;
      let dist2 = 0;
      for (const q of SOLO_QUALITY_KEYS) { const d = qi[q] - qj[q]; dist2 += d * d; }
      contrastSum += Math.sqrt(dist2) / Math.sqrt(SOLO_QUALITY_KEYS.length);
      contrastCount++;
    }
  }
  const contrast = contrastCount > 0 ? contrastSum / contrastCount : 0;

  // --- Aggregate energy: mean velocity (will become min in step 5) ---
  const aggregate_energy = field_intensity;

  return { cohesion, synchrony, dissent, unison, fragmentation, energy_spread, field_intensity, convergence, contrast, aggregate_energy };
}

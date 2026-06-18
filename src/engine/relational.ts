import type { DancerState, QualityName } from "../types.js";

export interface RelationalQualities {
  synchrony: number;          // 0-1, mean pairwise velocity correlation
  contrast: number;           // 0-1, mean pairwise quality distance
  aggregate_velocity: number; // 0-1, mean velocity across all dancers
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
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den === 0 ? 0 : num / den;
}

const QUALITY_KEYS: QualityName[] = [
  "velocity", "acceleration", "jerkiness", "energy", "spatial_extent",
  "contraction", "symmetry", "coherence", "verticality", "heading",
  "stillness", "periodicity", "groundedness",
];

export function computeRelational(
  dancers: Map<string, DancerState>,
  velocityHistories: Map<string, number[]>,
  windowSize: number = 20,
): RelationalQualities {
  const ids = [...dancers.keys()].filter(id => !id.startsWith("_"));
  if (ids.length < 2) return { synchrony: 0, contrast: 0, aggregate_velocity: 0 };

  // Synchrony: mean pairwise Pearson correlation of velocity histories
  let syncSum = 0, syncCount = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const ha = velocityHistories.get(ids[i]);
      const hb = velocityHistories.get(ids[j]);
      if (ha && hb && ha.length >= 2 && hb.length >= 2) {
        const a = ha.slice(-windowSize);
        const b = hb.slice(-windowSize);
        syncSum += Math.max(0, pearson(a, b));
        // Count only pairs that contributed, so the divisor matches the
        // numerator. Pairs lacking history enter neither (audit finding 6).
        syncCount++;
      }
    }
  }
  const synchrony = syncCount > 0 ? syncSum / syncCount : 0;

  // Contrast: mean pairwise L2 distance of quality vectors
  let contrastSum = 0, contrastCount = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const qi = dancers.get(ids[i])!.qualities;
      const qj = dancers.get(ids[j])!.qualities;
      let dist2 = 0;
      for (const q of QUALITY_KEYS) {
        const d = qi[q] - qj[q];
        dist2 += d * d;
      }
      contrastSum += Math.sqrt(dist2) / Math.sqrt(QUALITY_KEYS.length);
      contrastCount++;
    }
  }
  const contrast = contrastCount > 0 ? contrastSum / contrastCount : 0;

  // Aggregate velocity: mean of each dancer's velocity quality. (Named
  // aggregate_velocity, not aggregate_energy: it aggregates the velocity
  // quality, and `energy` is a distinct quality — audit finding 7.)
  let velocitySum = 0;
  for (const id of ids) {
    velocitySum += dancers.get(id)!.qualities.velocity;
  }
  const aggregate_velocity = velocitySum / ids.length;

  return { synchrony, contrast, aggregate_velocity };
}

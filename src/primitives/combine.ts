import type { ReadingConfig, ReadingValue } from "../types.js";

/**
 * Combine: mixes multiple quality values with weights to produce a Reading.
 *
 * Applies optional gates — a quality must be above/below a threshold
 * for the reading to be active.
 */
export function combine(
  config: ReadingConfig,
  qualities: Record<string, number>
): ReadingValue {
  // Check gates
  let active = true;
  if (config.gate) {
    for (const [quality, condition] of Object.entries(config.gate)) {
      const val = qualities[quality] ?? 0;
      if (condition.above !== undefined && val < condition.above) active = false;
      if (condition.below !== undefined && val > condition.below) active = false;
    }
  }

  // Weighted mix
  let value = 0;
  let totalWeight = 0;
  for (const [quality, weight] of Object.entries(config.mix)) {
    value += (qualities[quality] ?? 0) * weight;
    totalWeight += weight;
  }
  if (totalWeight > 0) value /= totalWeight;

  return { id: config.id, value, active };
}

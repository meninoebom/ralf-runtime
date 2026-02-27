import type { ReadingConfig, ReadingValue, HysteresisState } from "../types.js";

/**
 * Combine: mixes multiple quality values with weights to produce a Reading.
 *
 * Applies optional gates — a quality must be above/below a threshold
 * for the reading to be active. Supports hysteresis (Schmitt trigger)
 * to prevent oscillation near threshold boundaries.
 */
export function combine(
  config: ReadingConfig,
  qualities: Record<string, number>,
  hysteresisState?: HysteresisState,
  hysteresisBand = 0.05
): ReadingValue {
  // Check gates (with optional hysteresis)
  let active = true;
  if (config.gate) {
    for (const [quality, condition] of Object.entries(config.gate)) {
      const val = qualities[quality] ?? 0;
      const gateKey = `${config.id}:${quality}`;

      if (hysteresisState) {
        const wasActive = hysteresisState.get(gateKey) ?? false;

        let gateActive: boolean;
        if (wasActive) {
          // To exit active, value must drop below threshold - band
          gateActive = true;
          if (condition.above !== undefined && val < condition.above - hysteresisBand)
            gateActive = false;
          if (condition.below !== undefined && val > condition.below + hysteresisBand)
            gateActive = false;
        } else {
          // To enter active, value must cross threshold + band
          gateActive = true;
          if (condition.above !== undefined && val < condition.above + hysteresisBand)
            gateActive = false;
          if (condition.below !== undefined && val > condition.below - hysteresisBand)
            gateActive = false;
        }

        hysteresisState.set(gateKey, gateActive);
        if (!gateActive) active = false;
      } else {
        // No hysteresis — original behavior
        if (condition.above !== undefined && val < condition.above) active = false;
        if (condition.below !== undefined && val > condition.below) active = false;
      }
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

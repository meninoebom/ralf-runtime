import type { GateCondition } from "../types.js";

/**
 * Gate: passes or blocks based on conditions.
 *
 * Evaluates a set of conditions against current values.
 * Supports "and" (all must pass) and "or" (any must pass) logic.
 */
export function evaluateGate(
  conditions: GateCondition[],
  logic: "and" | "or",
  values: Record<string, number>,
  lastPassTime: number,
  now: number
): boolean {
  const results = conditions.map((c) => {
    const val = values[c.source] ?? 0;
    if (c.above !== undefined && val < c.above) return false;
    if (c.below !== undefined && val > c.below) return false;
    if (c.cooldown !== undefined) {
      const elapsed = (now - lastPassTime) / 1000;
      if (elapsed < c.cooldown) return false;
    }
    return true;
  });

  return logic === "and" ? results.every(Boolean) : results.some(Boolean);
}

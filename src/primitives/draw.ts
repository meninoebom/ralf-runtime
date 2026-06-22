import type { IntentOption } from "../types.js";

/**
 * Draw: weighted random selection from an intent's action pool.
 *
 * Like drawing from a deck — the tendencies (weights) stack the deck,
 * but which card you draw still varies. This is what makes Ralf feel
 * like a conversation, not a remote control.
 *
 * When deterministic=true (learning mode), always picks the highest-weight
 * option. Ties go to the first occurrence.
 *
 * Returns null if the pool is empty or all weights are zero.
 */
export function draw(options: IntentOption[], deterministic = false): IntentOption | null {
  if (options.length === 0) return null;

  const totalWeight = options.reduce((sum, opt) => sum + Math.max(0, opt.weight), 0);
  if (totalWeight === 0) return null;

  if (deterministic) {
    let best: IntentOption | null = null;
    for (const option of options) {
      if (option.weight <= 0) continue;
      if (!best || option.weight > best.weight) {
        best = option;
      }
    }
    return best;
  }

  let r = Math.random() * totalWeight;

  for (const option of options) {
    if (option.weight <= 0) continue;
    r -= option.weight;
    if (r <= 0) return option;
  }

  return options[options.length - 1];
}

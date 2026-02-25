import type { IntentOption } from "../types.js";

/**
 * Roll: weighted random selection from an intent's action pool.
 *
 * This is what makes Ralf feel like a conversation, not a remote control.
 * Same intent, different outcome each time — shaped by tendencies.
 *
 * Returns null if the pool is empty or all weights are zero.
 */
export function roll(options: IntentOption[]): IntentOption | null {
  if (options.length === 0) return null;

  const totalWeight = options.reduce((sum, opt) => sum + Math.max(0, opt.weight), 0);
  if (totalWeight === 0) return null;

  let r = Math.random() * totalWeight;

  for (const option of options) {
    if (option.weight <= 0) continue;
    r -= option.weight;
    if (r <= 0) return option;
  }

  return options[options.length - 1];
}

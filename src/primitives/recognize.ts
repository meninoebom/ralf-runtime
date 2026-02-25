/**
 * Recognize: receives discrete gesture events and emits them
 * with deduplication/cooldown.
 *
 * Actual DTW recognition happens externally (Gesture Studio).
 * This node receives "/gesture/jack" OSC messages and gates them.
 */
export class Recognize {
  private lastFired = new Map<string, number>();
  private cooldownMs: number;

  constructor(cooldownMs = 500) {
    this.cooldownMs = cooldownMs;
  }

  /** Returns the gesture name if it passes cooldown, null otherwise. */
  receive(gesture: string, now: number): string | null {
    const last = this.lastFired.get(gesture) ?? 0;
    if (now - last < this.cooldownMs) return null;
    this.lastFired.set(gesture, now);
    return gesture;
  }
}

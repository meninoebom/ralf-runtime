/**
 * Accumulate: tracks events over time.
 *
 * Two modes:
 * - "windowed": how many events in the last N seconds
 * - "counting": total count since reset
 */
export class Accumulate {
  private timestamps: number[] = [];
  private count = 0;
  private readonly mode: "windowed" | "counting";
  private readonly windowMs: number;

  constructor(mode: "windowed" | "counting", windowSeconds = 5) {
    this.mode = mode;
    this.windowMs = windowSeconds * 1000;
  }

  record(now: number) {
    this.count++;
    if (this.mode === "windowed") {
      this.timestamps.push(now);
    }
  }

  value(now: number): number {
    if (this.mode === "counting") return this.count;

    // Prune expired timestamps
    const cutoff = now - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0] < cutoff) {
      this.timestamps.shift();
    }
    return this.timestamps.length;
  }

  reset() {
    this.timestamps = [];
    this.count = 0;
  }
}

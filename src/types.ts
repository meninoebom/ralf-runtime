// ─── Scene Config (the JSON users author) ───────────────────────────────────

export interface SceneConfig {
  name: string;
  dancers: DancerConfig[];
  readings: ReadingConfig[];
  intents: Record<string, IntentOption[]>;
  sonic_world: SonicWorldConfig;
}

export interface DancerConfig {
  id: string;
  input: { type: string; port: number };
}

export interface ReadingConfig {
  id: string;
  mix: Record<string, number>; // quality -> weight
  gate?: Record<string, { above?: number; below?: number }>;
  intents?: ReadingIntent[];
}

/**
 * Maps a reading to an intent. Two forms:
 *
 * Direct: "add_energy" — fires whenever the reading is gated
 * Threshold: { intent: "add_energy", above: 0.7 } — fires when reading value is in range
 */
export type ReadingIntent = string | ReadingIntentWithThreshold;

export interface ReadingIntentWithThreshold {
  intent: string;
  above?: number;
  below?: number;
}

export interface IntentOption {
  action: string;
  args?: Record<string, string | number>;
  weight: number;
}

export interface SonicWorldConfig {
  type: "ableton" | "tonejs" | "osc";
  port?: number;
  samples?: string;
}

// ─── Runtime state ──────────────────────────────────────────────────────────

export type QualityName =
  | "velocity"
  | "jerkiness"
  | "contraction"
  | "verticality"
  | "symmetry"
  | "coherence";

export interface DancerState {
  id: string;
  qualities: Record<QualityName, number>;
  lastGesture: string | null;
  lastGestureTime: number;
}

export interface ReadingValue {
  id: string;
  value: number;
  active: boolean; // true = gate passed, reading is live
}

export interface ActMessage {
  address: string;
  args: (string | number)[];
}

// ─── Runtime state (shared across engine + transport) ───────────────────────

export interface RuntimeState {
  dancers: Map<string, DancerState>;
  readings: ReadingValue[];
  tick: number;
}

// ─── Accumulator ────────────────────────────────────────────────────────────

export interface AccumulatorConfig {
  id: string;
  mode: "windowed" | "counting";
  event: string; // gesture or reading id to track
  window?: number; // seconds (for windowed mode)
}

// ─── Gate ────────────────────────────────────────────────────────────────────

export interface GateConfig {
  id: string;
  conditions: GateCondition[];
  logic: "and" | "or";
}

export interface GateCondition {
  source: string; // quality, reading, or accumulator id
  above?: number;
  below?: number;
  cooldown?: number; // seconds since last pass
}

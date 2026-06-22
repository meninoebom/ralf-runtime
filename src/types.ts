// ─── Scene Config (the JSON users author) ───────────────────────────────────

export interface SceneSettings {
  adaptive_range_decay?: number;   // default 0.001
  hysteresis_band?: number;        // default 0.05
  staleness_frames?: number;       // default 90
  smoothing_min_cutoff?: number;   // default 1.0
  smoothing_beta?: number;         // default 0.007
}

export interface SceneConfig {
  version?: number;
  name: string;
  settings?: SceneSettings;
  dancers: DancerConfig[];
  readings: ReadingConfig[];
  intents: Record<string, IntentOption[] | IntentPoolConfig>;
  translator: TranslatorConfig;
  _manifest?: TranslatorManifest;
  /** @deprecated Use `translator` instead */
  sonic_world?: SonicWorldConfig;
}

export interface IntentPoolConfig {
  deterministic?: boolean;  // learning mode — highest weight wins
  pool: IntentOption[];
}

export interface DancerConfig {
  id: string;
  input?: { type: string; port: number };
  adapter?: string;
  port?: number;
}

export interface ReadingConfig {
  id: string;
  mix: Record<string, number>; // quality -> weight
  gate?: Record<string, { above?: number; below?: number }>;
  intents?: ReadingIntent[];
  on_exit?: string[];          // intent names to fire on falling edge
  trajectory?: { window: number; above?: number; below?: number };
  scope?: "per_dancer" | "crowd" | "broadcast"; // default "per_dancer" (real dancers only, skips _crowd)
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
  mode?: "edge" | "continuous";  // default "edge"
}

export interface IntentOption {
  action: string;
  args?: Record<string, string | number>;
  weight: number;
}

export interface TranslatorConfig {
  type: string;
  port?: number;
}

export interface SonicWorldConfig {
  type: "ableton" | "tonejs" | "osc";
  port?: number;
  samples?: string;
}

// ─── Translator Manifest ────────────────────────────────────────────────────

export interface ManifestArgSchema {
  type: "enum" | "number" | "string";
  values?: string[];
  required?: boolean;
}

export interface ManifestAction {
  name: string;
  type: "trigger" | "set";
  description: string;
  args?: Record<string, ManifestArgSchema>;
}

export interface TranslatorManifest {
  name: string;
  description: string;
  actions: ManifestAction[];
}

// ─── Runtime state ──────────────────────────────────────────────────────────

export type QualityName =
  | "velocity"
  | "acceleration"
  | "jerkiness"
  | "energy"
  | "spatial_extent"
  | "contraction"
  | "symmetry"
  | "coherence"
  | "verticality"
  | "heading"
  | "stillness"
  | "periodicity"
  | "groundedness"
  | "cohesion"
  | "dissent"
  | "unison"
  | "fragmentation"
  | "energy_spread"
  | "field_intensity"
  | "convergence"
  | "lead_strength"
  | "contrast"
  | "aggregate_energy";

export interface DancerState {
  id: string;
  qualities: Record<QualityName, number>;
  meta?: Record<string, string>; // non-numeric state (e.g. lead_id, max_dissent_id) for broadcast routing
  lastGesture: string | null;
  lastGestureTime: number;
  stale?: boolean;
}

export interface ReadingValue {
  id: string;
  value: number;
  active: boolean; // true = gate passed, reading is live
  slope?: number;  // trajectory slope (windowed linear regression)
}

export interface ActMessage {
  address: string;
  args: (string | number)[];
}

export interface TranslatorState {
  tempo: number;
  playing: boolean;
  scene: number;
}

// ─── Runtime state (shared across engine + transport) ───────────────────────

export interface RuntimeState {
  dancers: Map<string, DancerState>;
  readings: ReadingValue[];
  tick: number;
  translatorState: TranslatorState;
}

// ─── Hysteresis state for gates ─────────────────────────────────────────────

export type HysteresisState = Map<string, boolean>; // gate key -> currently active

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

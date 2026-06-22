import { ZodError } from "zod";
import { SceneSchema } from "./scene-schema.js";
import type { SceneConfig, IntentPoolConfig, TranslatorManifest, ManifestAction } from "../types.js";

export interface ValidationError {
  path: string;
  message: string;
  severity?: "error" | "warning"; // defaults to "error" when absent
}

/** Thrown by `assertSceneValid` when a scene has any blocking (error-severity) finding. */
export class SceneValidationError extends Error {
  constructor(public readonly errors: ValidationError[]) {
    super(
      `Scene validation failed with ${errors.length} blocking error(s):\n` +
        errors.map((e) => `  ${e.path}: ${e.message}`).join("\n"),
    );
    this.name = "SceneValidationError";
  }
}

const isBlocking = (e: ValidationError): boolean => (e.severity ?? "error") === "error";

const VALID_QUALITIES = new Set([
  "velocity", "acceleration", "jerkiness", "energy", "spatial_extent",
  "contraction", "symmetry", "coherence", "verticality", "heading",
  "stillness", "periodicity", "groundedness",
  "cohesion", "dissent", "unison", "fragmentation",
  "energy_spread", "field_intensity", "convergence", "lead_strength", "contrast", "aggregate_energy",
]);

// Qualities only ever populated on the virtual `_crowd` dancer (relational pass,
// runtime.ts). A per_dancer reading that mixes or gates one of these reads 0
// forever, almost always a missing `scope: "crowd"` (S4 / D3).
const RELATIONAL_ONLY_QUALITIES = new Set([
  "cohesion", "dissent", "unison", "fragmentation",
  "energy_spread", "field_intensity", "convergence",
  "lead_strength", "contrast", "aggregate_energy",
]);

function getPool(entry: unknown): { pool: unknown[]; deterministic?: boolean } | null {
  if (Array.isArray(entry)) return { pool: entry };
  if (entry && typeof entry === "object" && "pool" in entry) {
    const e = entry as IntentPoolConfig;
    return { pool: e.pool, deterministic: e.deterministic };
  }
  return null;
}

export function validateScene(scene: SceneConfig, manifest?: TranslatorManifest): ValidationError[] {
  const errors: ValidationError[] = [];

  // Check version
  if (scene.version !== undefined && scene.version !== 1) {
    errors.push({ path: "version", message: `Unrecognized version: ${scene.version}` });
  }

  // Check dancer IDs are unique
  const dancerIds = new Set<string>();
  for (let i = 0; i < scene.dancers.length; i++) {
    const id = scene.dancers[i].id;
    if (dancerIds.has(id)) {
      errors.push({ path: `dancers[${i}].id`, message: `Duplicate dancer ID: "${id}"` });
    }
    dancerIds.add(id);
  }

  // Collect defined intent names
  const definedIntents = new Set(Object.keys(scene.intents));

  // Check readings
  for (let i = 0; i < scene.readings.length; i++) {
    const reading = scene.readings[i];
    const prefix = `readings[${i}]`;

    // Check mix quality names
    for (const quality of Object.keys(reading.mix)) {
      if (!VALID_QUALITIES.has(quality)) {
        errors.push({ path: `${prefix}.mix.${quality}`, message: `Unknown quality name: "${quality}"` });
      }
    }

    // Anti-domination lint: field_intensity is monotonic — a single dominant dancer can raise it alone.
    // Warn when it is the only quality in the mix (no non-monotonic signal to balance it).
    const mixKeys = Object.keys(reading.mix);
    if (mixKeys.length === 1 && mixKeys[0] === "field_intensity") {
      errors.push({
        path: `${prefix}.mix`,
        message: `Reading mixes only field_intensity, which is monotonic — one dancer can trigger it alone. Add a non-monotonic quality (cohesion, dissent, unison, etc.) to the mix or gate.`,
        severity: "warning",
      });
    }

    // Check gate quality names
    if (reading.gate) {
      for (const quality of Object.keys(reading.gate)) {
        if (!VALID_QUALITIES.has(quality)) {
          errors.push({ path: `${prefix}.gate.${quality}`, message: `Unknown quality name: "${quality}"` });
        }
      }
    }

    // S4: crowd-scope coherence (D2/D3). A per_dancer reading that references a
    // relational-only quality reads 0 forever, almost certainly a missing
    // `scope: "crowd"`. Warning, since the quality name itself is valid.
    const scope = reading.scope ?? "per_dancer";
    if (scope === "per_dancer") {
      const gateKeys = reading.gate ? Object.keys(reading.gate) : [];
      for (const quality of [...Object.keys(reading.mix), ...gateKeys]) {
        if (RELATIONAL_ONLY_QUALITIES.has(quality)) {
          errors.push({
            path: `${prefix}`,
            message: `Reading references relational-only quality "${quality}" but scope is per_dancer, so it reads 0 forever. Add scope: "crowd".`,
            severity: "warning",
          });
        }
      }
    }

    // S5 (mix half): negative mix weights are usually a typo (subtractive mix is
    // rare and can push values out of [0,1] or flip the sign). Warning.
    for (const [quality, weight] of Object.entries(reading.mix)) {
      if (weight < 0) {
        errors.push({
          path: `${prefix}.mix.${quality}`,
          message: `Negative mix weight (${weight}). Usually a typo; it can push the reading outside [0,1].`,
          severity: "warning",
        });
      }
    }

    // S5 (gate half): thresholds far outside the normalized [0,1] range can never
    // open/close. Warning, not error: a >1 sentinel may be deliberate.
    if (reading.gate) {
      for (const [quality, cond] of Object.entries(reading.gate)) {
        for (const bound of ["above", "below"] as const) {
          const v = cond[bound];
          if (v !== undefined && (v < -0.5 || v > 1.5)) {
            errors.push({
              path: `${prefix}.gate.${quality}.${bound}`,
              message: `Gate threshold ${v} is far outside the normalized [0,1] range, so it may never trigger.`,
              severity: "warning",
            });
          }
        }
      }
    }

    // S3: a threshold-form reading intent must have at least one of above/below;
    // otherwise it fires unconditionally (the author thinks they scoped it to a
    // band but didn't). Mirrors the trajectory "no effect" warning.
    if (reading.intents) {
      for (let j = 0; j < reading.intents.length; j++) {
        const entry = reading.intents[j];
        if (typeof entry !== "string" && entry.above === undefined && entry.below === undefined) {
          errors.push({
            path: `${prefix}.intents[${j}]`,
            message: `Threshold-form intent "${entry.intent}" has neither above nor below, so it fires unconditionally. Use a direct string intent if that is intended.`,
            severity: "warning",
          });
        }
      }
    }

    // Check trajectory config. The schema (Layer 1) already guarantees window/above/below
    // are numbers; these are the semantic checks it can't make.
    if (reading.trajectory) {
      const traj = reading.trajectory;
      if (!Number.isInteger(traj.window) || traj.window < 2) {
        errors.push({ path: `${prefix}.trajectory.window`, message: `Trajectory window must be a positive integer ≥ 2, got ${traj.window}` });
      }
      if (traj.above === undefined && traj.below === undefined) {
        errors.push({ path: `${prefix}.trajectory`, message: `Trajectory has neither above nor below — it will have no effect` });
      }
    }

    // Check intent references
    if (reading.intents) {
      for (let j = 0; j < reading.intents.length; j++) {
        const entry = reading.intents[j];
        const intentName = typeof entry === "string" ? entry : entry.intent;
        if (!definedIntents.has(intentName)) {
          errors.push({
            path: `${prefix}.intents[${j}]`,
            message: `Intent "${intentName}" is not defined in scene.intents`,
          });
        }
      }
    }

    // Check on_exit intent references
    if (reading.on_exit) {
      for (let j = 0; j < reading.on_exit.length; j++) {
        const intentName = reading.on_exit[j];
        if (!definedIntents.has(intentName)) {
          errors.push({
            path: `${prefix}.on_exit[${j}]`,
            message: `Intent "${intentName}" is not defined in scene.intents`,
          });
        }
      }
    }
  }

  // Validate intent action options.
  // The prefix check (S1) is a translator-wide hard rule and runs ALWAYS, even with no
  // manifest loaded: a bare action like "unmute_track" is silently dropped downstream.
  // The name/arg checks below additionally require a manifest.
  const actionMap = new Map<string, ManifestAction>();
  if (manifest) {
    for (const action of manifest.actions) {
      actionMap.set(action.name, action);
    }
  }

  for (const [intentName, entry] of Object.entries(scene.intents)) {
    const poolData = getPool(entry);
    if (!poolData) continue;

    // S5 (pool half): a pool whose weights all sum to ≤ 0 never draws an action.
    const weightSum = poolData.pool.reduce(
      (sum: number, opt) => sum + Math.max(0, (opt as { weight?: number }).weight ?? 0),
      0,
    );
    if (weightSum === 0) {
      errors.push({
        path: `intents.${intentName}`,
        message: `Intent pool has no positive weight (sum is 0), so it never produces an action.`,
        severity: "warning",
      });
    }

    for (let i = 0; i < poolData.pool.length; i++) {
      const option = poolData.pool[i] as { action: string; args?: Record<string, string | number> };
      const prefix = `intents.${intentName}[${i}]`;

      // S1: every action must carry a trigger/ or set/ prefix (manifest-independent).
      if (!option.action.startsWith("trigger/") && !option.action.startsWith("set/")) {
        errors.push({
          path: `${prefix}.action`,
          message: `Action "${option.action}" must start with "trigger/" or "set/"; translators silently drop unprefixed actions`,
        });
      }

      if (!manifest) continue;

      const manifestAction = actionMap.get(option.action);
      if (!manifestAction) {
        errors.push({ path: prefix, message: `Action "${option.action}" not found in translator manifest` });
        continue;
      }

      // S2: the action's prefix must agree with the manifest's declared type.
      // A discrete `trigger` mislabeled `set/` gets value-deduplicated (deadband);
      // a continuous `set` mislabeled `trigger/` floods. Warning only: downstream is
      // tolerant, but behavior is subtly wrong.
      const usedPrefix = option.action.startsWith("set/") ? "set" : "trigger";
      if (usedPrefix !== manifestAction.type) {
        errors.push({
          path: `${prefix}.action`,
          message: `Action "${option.action}" uses "${usedPrefix}/" but the manifest declares type "${manifestAction.type}": prefix/type mismatch (deadband or flood risk).`,
          severity: "warning",
        });
      }

      if (manifestAction.args) {
        for (const [argName, schema] of Object.entries(manifestAction.args)) {
          const value = option.args?.[argName];

          if (schema.required && value === undefined) {
            errors.push({ path: `${prefix}.args.${argName}`, message: `Required arg "${argName}" missing for action "${option.action}"` });
            continue;
          }

          if (value !== undefined && schema.type === "enum" && schema.values) {
            if (!schema.values.includes(String(value))) {
              errors.push({ path: `${prefix}.args.${argName}`, message: `Invalid value "${value}" for arg "${argName}", expected one of: ${schema.values.join(", ")}` });
            }
          }
        }
      }
    }
  }

  return errors;
}

/** Map a ZodError into our flat ValidationError findings (all blocking). */
function zodIssuesToFindings(err: ZodError): ValidationError[] {
  return err.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join(".") : "(root)",
    message: issue.message,
  }));
}

/** Result of the load gate: the proven-well-formed scene plus any non-blocking warnings. */
export interface SceneGateResult {
  scene: SceneConfig;
  warnings: ValidationError[];
}

/**
 * The load gate over untrusted input. Two layers behind one narrow interface:
 *
 *   1. SceneSchema.parse: structural / type gate (Layer 1, zod). Catches the
 *      category-C wrong-shape failures and typo'd keys before they reach the
 *      semantic checks. This is what validates the untrusted `msg.scene` JSON
 *      arriving over the WebSocket.
 *   2. validateScene: semantic / referential checks (Layer 2).
 *
 * Throws `SceneValidationError` if either layer produces a blocking finding;
 * otherwise returns the parsed scene and the non-blocking warnings. Callers see
 * exactly one thing: a valid SceneConfig comes back, or it throws loudly.
 *
 * Accepts `unknown` so it can be the gate for raw JSON (loader output is already
 * typed, but the WS path hands in untrusted client data).
 */
export function assertSceneValid(input: unknown, manifest?: TranslatorManifest): SceneGateResult {
  let scene: SceneConfig;
  try {
    scene = SceneSchema.parse(input) as SceneConfig;
  } catch (err) {
    if (err instanceof ZodError) throw new SceneValidationError(zodIssuesToFindings(err));
    throw err;
  }

  const findings = validateScene(scene, manifest);
  const blocking = findings.filter(isBlocking);
  if (blocking.length > 0) throw new SceneValidationError(blocking);
  return { scene, warnings: findings.filter((e) => !isBlocking(e)) };
}

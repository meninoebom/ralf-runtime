import type { SceneConfig, IntentPoolConfig, TranslatorManifest, ManifestAction } from "../types.js";

export interface ValidationError {
  path: string;
  message: string;
}

const VALID_QUALITIES = new Set([
  "velocity", "acceleration", "jerkiness", "energy", "spatial_extent",
  "contraction", "symmetry", "coherence", "verticality", "heading",
  "stillness", "periodicity", "groundedness",
  "synchrony", "contrast", "aggregate_energy",
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

    // Check gate quality names
    if (reading.gate) {
      for (const quality of Object.keys(reading.gate)) {
        if (!VALID_QUALITIES.has(quality)) {
          errors.push({ path: `${prefix}.gate.${quality}`, message: `Unknown quality name: "${quality}"` });
        }
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

  // Validate intent actions against manifest
  if (manifest) {
    const actionMap = new Map<string, ManifestAction>();
    for (const action of manifest.actions) {
      actionMap.set(action.name, action);
    }

    for (const [intentName, entry] of Object.entries(scene.intents)) {
      const poolData = getPool(entry);
      if (!poolData) continue;

      for (let i = 0; i < poolData.pool.length; i++) {
        const option = poolData.pool[i] as { action: string; args?: Record<string, string | number> };
        const prefix = `intents.${intentName}[${i}]`;
        const manifestAction = actionMap.get(option.action);

        if (!manifestAction) {
          errors.push({ path: prefix, message: `Action "${option.action}" not found in translator manifest` });
          continue;
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
                errors.push({ path: `${prefix}.args.${argName}`, message: `Invalid value "${value}" for arg "${argName}" — expected one of: ${schema.values.join(", ")}` });
              }
            }
          }
        }
      }
    }
  }

  return errors;
}

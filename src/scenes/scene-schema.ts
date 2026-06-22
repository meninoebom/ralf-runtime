import { z } from "zod";
import type { SceneConfig } from "../types.js";

/**
 * Structural schema for a scene (Layer 1 of validation).
 *
 * This is a direct transcription of the `SceneConfig` family in `types.ts`,
 * with no codegen and no ts-to-zod step. It catches the category-C "wrong shape / wrong
 * type" failures that the semantic validator cannot see, because JSON.parse
 * happily accepts them and TS types do not run at load time:
 *
 *   C1  gate is a record of condition objects, not an array
 *   C2  mix weights are numbers, not strings
 *   C3  an intents entry is an array or a { pool } object, nothing else
 *   C5  an intent option's `weight` is a required number
 *   C6  settings values are the right type
 *   C7  a dancer requires `id: string`
 *
 * Fixed-shape objects (settings, intent options, threshold readings) use
 * `.strict()` so a typo'd / unknown key (A5, A6) is rejected rather than
 * silently ignored. No `.passthrough()`, no `.catch()`, no defaults. Loud
 * failure beats clever recovery.
 *
 * The single round-trip test (`scene-schema.test.ts`) is the guard that this
 * schema never drifts from `types.ts`: it parses every real scene file plus the
 * default scene shape.
 */

// SceneSettings: all optional, each a specific numeric type. .strict() catches A5.
const SettingsSchema = z
  .object({
    adaptive_range_decay: z.number().optional(),
    hysteresis_band: z.number().optional(),
    staleness_frames: z.number().optional(),
    smoothing_min_cutoff: z.number().optional(),
    smoothing_beta: z.number().optional(),
  })
  .strict();

// DancerConfig: `id` is the only required field (C7).
const DancerSchema = z.object({
  id: z.string(),
  input: z.object({ type: z.string(), port: z.number() }).optional(),
  adapter: z.string().optional(),
  port: z.number().optional(),
});

// gate is a record of condition objects, NOT an array (C1).
const GateConditionSchema = z
  .object({
    above: z.number().optional(),
    below: z.number().optional(),
  })
  .strict();

// ReadingIntent = string | { intent, above?, below?, mode? }. The object form is
// strict so a stray key like `range` (C4) is rejected rather than ignored.
const ReadingIntentSchema = z.union([
  z.string(),
  z
    .object({
      intent: z.string(),
      above: z.number().optional(),
      below: z.number().optional(),
      mode: z.enum(["edge", "continuous"]).optional(),
    })
    .strict(),
]);

const ReadingSchema = z.object({
  id: z.string(),
  mix: z.record(z.string(), z.number()), // weights are numbers, not strings (C2)
  gate: z.record(z.string(), GateConditionSchema).optional(),
  intents: z.array(ReadingIntentSchema).optional(),
  on_exit: z.array(z.string()).optional(),
  trajectory: z
    .object({
      window: z.number(),
      above: z.number().optional(),
      below: z.number().optional(),
    })
    .optional(),
  scope: z.enum(["per_dancer", "crowd", "broadcast"]).optional(),
});

// IntentOption: `weight` is a required number (C5). `args` values are string|number.
const IntentOptionSchema = z
  .object({
    action: z.string(),
    args: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    weight: z.number(),
  })
  .strict();

const IntentPoolSchema = z
  .object({
    deterministic: z.boolean().optional(),
    pool: z.array(IntentOptionSchema),
  })
  .strict();

// An intents entry is an array of options OR a { pool } object, nothing else (C3).
const IntentEntrySchema = z.union([z.array(IntentOptionSchema), IntentPoolSchema]);

const TranslatorSchema = z.object({ type: z.string(), port: z.number().optional() });

/**
 * Parses `unknown -> SceneConfig`.
 *
 * `translator` is required, faithful to `types.ts`. The top-level object is NOT
 * strict, so scenes may carry `_manifest` and other forward-compatible top-level
 * metadata. The strictness that matters (typo'd keys) lives on the small
 * fixed-shape sub-objects above.
 */
export const SceneSchema = z.object({
  version: z.number().optional(),
  name: z.string(),
  settings: SettingsSchema.optional(),
  dancers: z.array(DancerSchema),
  readings: z.array(ReadingSchema),
  intents: z.record(z.string(), IntentEntrySchema),
  translator: TranslatorSchema,
});

// Compile-time guard that the schema output stays assignable to SceneConfig:
// if the two drift, this line stops compiling.
type SchemaOutput = z.infer<typeof SceneSchema>;
const _typecheck: (s: SchemaOutput) => SceneConfig = (s) => s;
void _typecheck;

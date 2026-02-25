import type { ActMessage, IntentOption } from "../types.js";

/**
 * Act: converts a chosen action into a generic /ralf/act/* message.
 *
 * The translator downstream converts this to whatever the audio engine needs.
 * The reading value is passed through so continuous qualities can shape sound.
 */
export function act(
  option: IntentOption,
  readingValue?: number
): ActMessage {
  const args: (string | number)[] = [];

  // Pass the reading value first — this is the continuous signal
  if (readingValue !== undefined) args.push(readingValue);

  // Then any action-specific args
  if (option.args) {
    for (const v of Object.values(option.args)) {
      args.push(v);
    }
  }

  return {
    address: `/ralf/act/${option.action}`,
    args,
  };
}

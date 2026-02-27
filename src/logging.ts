import { appendFile } from "node:fs/promises";

type LogCategory = "act" | "scene" | "connect" | "disconnect" | "staleness" | "error";

let logFilePath: string | null = null;

/**
 * Set the file path for log output. If null, only stdout is used.
 */
export function setLogFile(path: string | null) {
  logFilePath = path;
}

/**
 * Simple timestamped logger that writes to stdout and optionally to a file.
 */
export function log(
  category: LogCategory,
  message: string,
  data?: Record<string, unknown>
): void {
  const timestamp = new Date().toISOString();
  const dataStr = data ? " " + JSON.stringify(data) : "";
  const line = `[${timestamp}] [${category}] ${message}${dataStr}`;

  console.log(line);

  if (logFilePath) {
    appendFile(logFilePath, line + "\n").catch(() => {
      // Silently ignore file write errors — don't crash the runtime over logging
    });
  }
}

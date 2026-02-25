import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { SceneConfig } from "../types.js";

const SCENES_DIR = join(process.cwd(), "scenes");

export async function loadScene(name: string): Promise<SceneConfig> {
  const path = join(SCENES_DIR, `${name}.json`);
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as SceneConfig;
}

export async function saveScene(scene: SceneConfig): Promise<void> {
  const path = join(SCENES_DIR, `${scene.name}.json`);
  await writeFile(path, JSON.stringify(scene, null, 2));
}

export async function listScenes(): Promise<string[]> {
  try {
    const files = await readdir(SCENES_DIR);
    return files
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(".json", ""));
  } catch {
    return [];
  }
}

import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { SceneConfig, TranslatorManifest } from "../types.js";

const SCENES_DIR = join(process.cwd(), "scenes");

export async function loadScene(name: string): Promise<SceneConfig> {
  const path = join(SCENES_DIR, `${name}.json`);
  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as SceneConfig;
}

export async function saveScene(scene: SceneConfig, manifest?: TranslatorManifest | null): Promise<void> {
  const toSave = { ...scene, version: 1 };
  if (manifest) {
    toSave._manifest = manifest;
  }
  const path = join(SCENES_DIR, `${toSave.name}.json`);
  await writeFile(path, JSON.stringify(toSave, null, 2));
}

export async function listScenes(): Promise<string[]> {
  try {
    const files = await readdir(SCENES_DIR);
    return files
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(".json", ""))
      .sort();
  } catch {
    return [];
  }
}

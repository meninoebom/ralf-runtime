import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { Runtime } from "./engine/runtime.js";
import { OscServer } from "./transport/osc-server.js";
import { WsServer } from "./transport/ws-server.js";
import { loadScene, listScenes, saveScene } from "./scenes/loader.js";
import { assertSceneValid, SceneValidationError, type ValidationError } from "./scenes/validator.js";
import { log, setLogFile } from "./logging.js";
import type { SceneConfig, QualityName, TranslatorManifest } from "./types.js";

const OSC_IN_PORT = parseInt(process.env.RALF_OSC_IN_PORT ?? "6449", 10);
const OSC_OUT_PORT = parseInt(process.env.RALF_OSC_OUT_PORT ?? "12000", 10);
const WS_PORT = parseInt(process.env.RALF_WS_PORT ?? "8765", 10);
const CONSOLE_PORT = parseInt(process.env.RALF_CONSOLE_PORT ?? "3300", 10);

function logSceneWarnings(warnings: ValidationError[]) {
  for (const w of warnings) log("scene", `Scene warning: ${w.path}: ${w.message}`);
}

async function main() {
  const startTime = new Date().toISOString();
  log("scene", `Ralf runtime starting at ${startTime}`);

  // Optional log file
  const logFile = process.env.RALF_LOG_FILE;
  if (logFile) {
    setLogFile(logFile);
    log("scene", `Logging to file: ${logFile}`);
  }

  // Load translator manifest if available
  let manifest: TranslatorManifest | null = null;

  // Load a scene — use first available or a default
  let scene: SceneConfig;
  const scenes = await listScenes();

  if (scenes.length > 0) {
    scene = await loadScene(scenes[0]);
    log("scene", `Loaded scene: ${scene.name}`);

    // Load manifest based on translator type
    const translatorType = scene.translator?.type;
    if (translatorType) {
      const manifestPath = join(process.cwd(), "..", "translators", translatorType, "manifest.json");
      try {
        manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as TranslatorManifest;
        log("scene", `Loaded translator manifest: ${translatorType}`);
      } catch {
        log("scene", `No translator manifest found for: ${translatorType}`);
      }
    }

    // Validate the scene and enforce the verdict: refuse to start on a blocking error
    // rather than running a silently-wrong scene. Warnings are logged but allow startup.
    try {
      const gate = assertSceneValid(scene, manifest ?? undefined);
      scene = gate.scene;
      logSceneWarnings(gate.warnings);
    } catch (err) {
      if (err instanceof SceneValidationError) {
        for (const e of err.errors) log("error", `Scene rejected: ${e.path}: ${e.message}`);
        log("error", `Refusing to start: scene "${scene.name}" has ${err.errors.length} blocking error(s). Fix the scene and restart.`);
        process.exit(1);
      }
      throw err;
    }
  } else {
    // Default scene for quick start
    scene = {
      name: "default",
      dancers: [{ id: "dancer1", input: { type: "mediapipe", port: 6448 } }],
      readings: [
        {
          id: "energy",
          mix: { velocity: 0.5, jerkiness: 0.5 },
          gate: { velocity: { above: 0.2 } },
          intents: ["add_energy"],
        },
      ],
      intents: {
        add_energy: [
          { action: "set/filter_cutoff", weight: 3 },
          { action: "trigger/unmute_track", args: { track: "perc" }, weight: 2 },
        ],
      },
      translator: { type: "osc", port: OSC_OUT_PORT },
    };
    log("scene", "No scenes found, using default");
  }

  const runtime = new Runtime(scene);

  // OSC transport
  const osc = new OscServer(OSC_IN_PORT, OSC_OUT_PORT);
  osc.setQualityHandler((dancerId, quality, value) => {
    runtime.updateQuality(dancerId, quality as QualityName, value);
  });
  osc.setGestureHandler((dancerId, gesture) => {
    runtime.receiveGesture(dancerId, gesture);
  });
  osc.setStateHandler((key, value) => {
    switch (key) {
      case "tempo":
        runtime.updateTranslatorState({ tempo: value });
        break;
      case "playing":
        runtime.updateTranslatorState({ playing: value !== 0 });
        break;
      case "scene":
        runtime.updateTranslatorState({ scene: value });
        break;
    }
  });
  osc.setPingHandler((processName) => {
    log("connect", `Ping from ${processName}`);
  });

  // WebSocket transport
  const ws = new WsServer(WS_PORT);
  ws.setLoadSceneHandler((newScene) => {
    // `newScene` is untrusted client JSON. The schema (Layer 1) validates its shape
    // before anything is loaded. Throws SceneValidationError on a blocking finding;
    // the WS layer reports it to the client and the running scene is left untouched.
    const gate = assertSceneValid(newScene, manifest ?? undefined);
    logSceneWarnings(gate.warnings);
    runtime.loadScene(gate.scene);
    runtime.start();
    log("scene", `Scene loaded via WebSocket: ${gate.scene.name}`);
  });
  ws.setGetStateHandler(() => runtime.getState());
  ws.setTranslatorStateHandler((update) => {
    runtime.updateTranslatorState(update);
  });
  ws.setUpdateSceneHandler((patch) => {
    runtime.updateScene(patch);
    log("scene", `Scene updated via WebSocket`);
  });
  ws.setSaveSceneHandler(async () => {
    await saveScene(runtime.getScene(), manifest);
    log("scene", `Scene saved to disk: ${runtime.getScene().name}`);
  });
  ws.setGetSceneHandler(() => runtime.getScene());

  ws.setReloadSceneHandler(async () => {
    const name = runtime.getScene().name;
    const reloaded = await loadScene(name);
    const gate = assertSceneValid(reloaded, manifest ?? undefined);
    logSceneWarnings(gate.warnings);
    runtime.loadScene(gate.scene);
    log("scene", `Scene reloaded from disk: ${name}`);
    return gate.scene;
  });

  ws.setGetManifestHandler(() => manifest);

  ws.setListScenesHandler(() => listScenes());

  ws.setSaveSceneAsHandler(async (name: string) => {
    const current = runtime.getScene();
    const clone = { ...current, name };
    await saveScene(clone, manifest);
    runtime.loadScene(clone);
    log("scene", `Scene saved as: ${name}`);
  });

  ws.setSwitchSceneHandler(async (name: string) => {
    const loaded = await loadScene(name);
    const gate = assertSceneValid(loaded, manifest ?? undefined);
    logSceneWarnings(gate.warnings);
    runtime.loadScene(gate.scene);
    log("scene", `Switched to scene: ${name}`);
    return gate.scene;
  });

  // Wire outputs
  runtime.setActHandler((msg) => {
    osc.send(msg);
    ws.broadcastAct(msg);
    log("act", msg.address, { args: msg.args });
  });

  // Broadcast state to WebSocket clients at ~10fps (not every tick)
  let frameCount = 0;
  runtime.setStateHandler((state) => {
    frameCount++;
    if (frameCount % 3 === 0) {
      ws.broadcastState(state);
    }
  });

  // Start everything
  try {
    osc.start();
  } catch (err) {
    log("error", `Failed to start OSC server on port ${OSC_IN_PORT}: ${err}`);
    process.exit(1);
  }

  try {
    ws.start();
  } catch (err) {
    log("error", `Failed to start WebSocket server on port ${WS_PORT}: ${err}`);
    process.exit(1);
  }

  runtime.start(30);

  // HTTP server for console static files
  const CONTENT_TYPES: Record<string, string> = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
  };

  const consoleDir = join(process.cwd(), "console");
  try {
  Bun.serve({
    port: CONSOLE_PORT,
    async fetch(req) {
      const url = new URL(req.url);
      const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
      const ext = pathname.slice(pathname.lastIndexOf("."));
      const contentType = CONTENT_TYPES[ext];
      if (!contentType) {
        return new Response("Not Found", { status: 404 });
      }
      const file = Bun.file(join(consoleDir, pathname));
      if (!(await file.exists())) {
        return new Response("Not Found", { status: 404 });
      }
      return new Response(file, { headers: { "Content-Type": contentType } });
    },
  });
  } catch (err) {
    log("error", `Failed to start console HTTP server on port ${CONSOLE_PORT}: ${err}`);
    process.exit(1);
  }

  console.log(`
┌─────────────────────────────────────┐
│         RALF RUNTIME SERVER         │
│                                     │
│  OSC in:     localhost:${OSC_IN_PORT}        │
│  OSC out:    localhost:${OSC_OUT_PORT}       │
│  WebSocket:  localhost:${WS_PORT}        │
│  Console:    localhost:${String(CONSOLE_PORT).padEnd(13)}│
│  Scene:      ${scene.name.padEnd(22)}│
│  Started:    ${startTime.slice(11, 19).padEnd(22)}│
│                                     │
│  The brain is running.              │
└─────────────────────────────────────┘
`);

  // Graceful shutdown
  const shutdown = (code: number) => {
    log("scene", "Shutting down...");
    runtime.stop();
    osc.stop();
    ws.stop();
    process.exit(code);
  };

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));

  process.on("uncaughtException", (err) => {
    console.error("[runtime] uncaughtException:", err);
    try { runtime.stop(); osc.stop(); ws.stop(); } catch {}
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    console.error("[runtime] unhandledRejection:", reason);
    try { runtime.stop(); osc.stop(); ws.stop(); } catch {}
    process.exit(1);
  });
}

main().catch((err) => {
  log("error", `Fatal: ${err.message}`);
  console.error(err);
  process.exit(1);
});

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { Runtime } from "./engine/runtime.js";
import { OscServer } from "./transport/osc-server.js";
import { WsServer } from "./transport/ws-server.js";
import { loadScene, listScenes, saveScene } from "./scenes/loader.js";
import { validateScene } from "./scenes/validator.js";
import { log, setLogFile } from "./logging.js";
import type { SceneConfig, QualityName, TranslatorManifest } from "./types.js";

const OSC_IN_PORT = parseInt(process.env.RALF_OSC_IN_PORT ?? "6449", 10);
const OSC_OUT_PORT = parseInt(process.env.RALF_OSC_OUT_PORT ?? "12000", 10);
const WS_PORT = parseInt(process.env.RALF_WS_PORT ?? "8765", 10);
const CONSOLE_PORT = parseInt(process.env.RALF_CONSOLE_PORT ?? "3300", 10);

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

    // Validate scene (with manifest if available)
    const errors = validateScene(scene, manifest ?? undefined);
    if (errors.length > 0) {
      for (const err of errors) {
        log("error", `Scene validation: ${err.path} — ${err.message}`);
      }
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
    runtime.loadScene(newScene);
    runtime.start();
    log("scene", `Scene loaded via WebSocket: ${newScene.name}`);
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
    await saveScene(runtime.getScene());
    log("scene", `Scene saved to disk: ${runtime.getScene().name}`);
  });
  ws.setGetSceneHandler(() => runtime.getScene());

  ws.setGetManifestHandler(() => manifest);

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
  osc.start();
  ws.start();
  runtime.start(30);

  // HTTP server for console static files
  const CONTENT_TYPES: Record<string, string> = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
  };

  const consoleDir = join(process.cwd(), "console");
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
  process.on("SIGINT", () => {
    log("scene", "Shutting down...");
    runtime.stop();
    osc.stop();
    ws.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  log("error", `Fatal: ${err.message}`);
  console.error(err);
  process.exit(1);
});

import { Runtime } from "./engine/runtime.js";
import { OscServer } from "./transport/osc-server.js";
import { WsServer } from "./transport/ws-server.js";
import { loadScene, listScenes } from "./scenes/loader.js";
import type { SceneConfig, QualityName } from "./types.js";

const OSC_IN_PORT = 6449;
const OSC_OUT_PORT = 12000;
const WS_PORT = 8765;

async function main() {
  // Load a scene — use first available or a default
  let scene: SceneConfig;
  const scenes = await listScenes();

  if (scenes.length > 0) {
    scene = await loadScene(scenes[0]);
    console.log(`Loaded scene: ${scene.name}`);
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
          { action: "filter_cutoff", weight: 3 },
          { action: "unmute_track", args: { track: "perc" }, weight: 2 },
        ],
      },
      sonic_world: { type: "osc", port: OSC_OUT_PORT },
    };
    console.log("No scenes found, using default");
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

  // WebSocket transport
  const ws = new WsServer(WS_PORT);
  ws.setLoadSceneHandler((newScene) => {
    runtime.loadScene(newScene);
    runtime.start();
    console.log(`Scene loaded: ${newScene.name}`);
  });
  ws.setGetStateHandler(() => runtime.getState());

  // Wire outputs
  runtime.setActHandler((msg) => {
    osc.send(msg);
    ws.broadcastAct(msg);
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

  console.log(`
┌─────────────────────────────────────┐
│         RALF RUNTIME SERVER         │
│                                     │
│  OSC in:     localhost:${OSC_IN_PORT}        │
│  OSC out:    localhost:${OSC_OUT_PORT}       │
│  WebSocket:  localhost:${WS_PORT}        │
│  Scene:      ${scene.name.padEnd(22)}│
│                                     │
│  The brain is running.              │
└─────────────────────────────────────┘
`);

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    runtime.stop();
    osc.stop();
    ws.stop();
    process.exit(0);
  });
}

main().catch(console.error);

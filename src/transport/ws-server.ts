import { WebSocketServer, WebSocket } from "ws";
import type { RuntimeState, ActMessage, SceneConfig, TranslatorState } from "../types.js";

/**
 * WebSocket server for the Performance Console.
 *
 * Broadcasts runtime state to all connected clients.
 * Accepts commands: loadScene, getState, updateState.
 */
export class WsServer {
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();
  private lastPong = new Map<WebSocket, number>();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private onLoadScene: ((scene: unknown) => void) | null = null;
  private onGetState: (() => RuntimeState) | null = null;
  private onTranslatorState: ((update: Partial<TranslatorState>) => void) | null = null;
  private onUpdateScene: ((patch: Partial<SceneConfig>) => void) | null = null;
  private onSaveScene: (() => Promise<void>) | null = null;
  private onGetScene: (() => SceneConfig) | null = null;
  private onGetManifest: (() => unknown | null) | null = null;
  private onReloadScene: (() => Promise<SceneConfig | null>) | null = null;
  private onListScenes: (() => Promise<string[]>) | null = null;
  private onSaveSceneAs: ((name: string) => Promise<void>) | null = null;
  private onSwitchScene: ((name: string) => Promise<SceneConfig | null>) | null = null;

  constructor(private port: number) {}

  setLoadSceneHandler(handler: (scene: unknown) => void) {
    this.onLoadScene = handler;
  }

  setGetStateHandler(handler: () => RuntimeState) {
    this.onGetState = handler;
  }

  setTranslatorStateHandler(handler: (update: Partial<TranslatorState>) => void) {
    this.onTranslatorState = handler;
  }

  setUpdateSceneHandler(handler: (patch: Partial<SceneConfig>) => void) {
    this.onUpdateScene = handler;
  }

  setSaveSceneHandler(handler: () => Promise<void>) {
    this.onSaveScene = handler;
  }

  setGetSceneHandler(handler: () => SceneConfig) {
    this.onGetScene = handler;
  }

  setReloadSceneHandler(handler: () => Promise<SceneConfig | null>) {
    this.onReloadScene = handler;
  }

  setGetManifestHandler(handler: () => unknown | null) {
    this.onGetManifest = handler;
  }

  setListScenesHandler(handler: () => Promise<string[]>) {
    this.onListScenes = handler;
  }

  setSaveSceneAsHandler(handler: (name: string) => Promise<void>) {
    this.onSaveSceneAs = handler;
  }

  setSwitchSceneHandler(handler: (name: string) => Promise<SceneConfig | null>) {
    this.onSwitchScene = handler;
  }

  start() {
    this.wss = new WebSocketServer({ port: this.port });

    this.wss.on("connection", (ws) => {
      this.clients.add(ws);
      this.lastPong.set(ws, Date.now());

      ws.on("pong", () => {
        this.lastPong.set(ws, Date.now());
      });

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleMessage(ws, msg);
        } catch {
          // ignore malformed messages
        }
      });

      ws.on("close", () => {
        this.clients.delete(ws);
        this.lastPong.delete(ws);
      });
    });

    // Heartbeat: ping clients every 10s, terminate if no pong in 15s
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      for (const client of this.clients) {
        const last = this.lastPong.get(client) ?? 0;
        if (now - last > 15_000) {
          client.terminate();
          this.clients.delete(client);
          this.lastPong.delete(client);
          continue;
        }
        client.ping();
      }
    }, 10_000);
  }

  broadcastState(state: RuntimeState) {
    const payload = this.serializeState(state);
    this.broadcast(payload);
  }

  broadcastAct(msg: ActMessage) {
    this.broadcast(JSON.stringify({ type: "act", ...msg }));
  }

  stop() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this.wss?.close();
  }

  private broadcast(payload: string) {
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  private serializeState(state: RuntimeState): string {
    return JSON.stringify({
      type: "state",
      dancers: Object.fromEntries(state.dancers),
      readings: state.readings,
      tick: state.tick,
      translatorState: state.translatorState,
    });
  }

  private handleMessage(ws: WebSocket, msg: { type: string; [k: string]: unknown }) {
    switch (msg.type) {
      case "loadScene":
        try {
          // msg.scene is untrusted; the load handler runs it through the schema gate.
          this.onLoadScene?.(msg.scene);
          ws.send(JSON.stringify({ type: "sceneLoaded" }));
        } catch (err) {
          // Validation rejected the scene; report it. The running scene is untouched.
          ws.send(JSON.stringify({ type: "error", message: (err as Error).message }));
        }
        break;
      case "getState": {
        const state = this.onGetState?.();
        if (state) {
          ws.send(this.serializeState(state));
        }
        break;
      }
      case "updateState": {
        // Bridge translator state from WebSocket clients
        const update = msg.state as Partial<TranslatorState>;
        if (update) {
          this.onTranslatorState?.(update);
        }
        break;
      }
      case "updateScene": {
        this.onUpdateScene?.(msg.patch as Partial<SceneConfig>);
        ws.send(JSON.stringify({ type: "sceneUpdated" }));
        break;
      }
      case "saveScene": {
        this.onSaveScene?.().then(() => {
          ws.send(JSON.stringify({ type: "sceneSaved" }));
        }).catch((err) => {
          ws.send(JSON.stringify({ type: "error", message: (err as Error).message }));
        });
        break;
      }
      case "getScene": {
        const scene = this.onGetScene?.();
        if (scene) {
          ws.send(JSON.stringify({ type: "scene", scene }));
        }
        break;
      }
      case "reloadScene": {
        this.onReloadScene?.().then((reloaded) => {
          if (reloaded) {
            this.broadcast(JSON.stringify({ type: "scene", scene: reloaded }));
          }
        }).catch((err) => {
          ws.send(JSON.stringify({ type: "error", message: (err as Error).message }));
        });
        break;
      }
      case "getManifest": {
        const manifest = this.onGetManifest?.();
        if (manifest) {
          ws.send(JSON.stringify({ type: "manifest", manifest }));
        }
        break;
      }
      case "switchScene": {
        const name = msg.name as string;
        if (!name) break;
        this.onSwitchScene?.(name).then((switched) => {
          if (switched) {
            this.broadcast(JSON.stringify({ type: "scene", scene: switched }));
          }
        }).catch((err) => {
          ws.send(JSON.stringify({ type: "error", message: (err as Error).message }));
        });
        break;
      }
      case "listScenes": {
        this.onListScenes?.().then((names) => {
          ws.send(JSON.stringify({ type: "sceneList", scenes: names }));
        });
        break;
      }
      case "saveSceneAs": {
        const name = msg.name as string;
        if (!name) break;
        this.onSaveSceneAs?.(name).then(() => {
          ws.send(JSON.stringify({ type: "sceneSaved" }));
          // Broadcast updated scene list to all clients
          this.onListScenes?.().then((names) => {
            this.broadcast(JSON.stringify({ type: "sceneList", scenes: names }));
          });
        }).catch((err) => {
          ws.send(JSON.stringify({ type: "error", message: (err as Error).message }));
        });
        break;
      }
      case "ping": {
        ws.send(JSON.stringify({ type: "pong" }));
        break;
      }
    }
  }
}

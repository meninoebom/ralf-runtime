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
  private onLoadScene: ((scene: SceneConfig) => void) | null = null;
  private onGetState: (() => RuntimeState) | null = null;
  private onTranslatorState: ((update: Partial<TranslatorState>) => void) | null = null;
  private onUpdateScene: ((patch: Partial<SceneConfig>) => void) | null = null;
  private onSaveScene: (() => Promise<void>) | null = null;
  private onGetScene: (() => SceneConfig) | null = null;

  constructor(private port: number) {}

  setLoadSceneHandler(handler: (scene: SceneConfig) => void) {
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

  start() {
    this.wss = new WebSocketServer({ port: this.port });

    this.wss.on("connection", (ws) => {
      this.clients.add(ws);

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
      });
    });
  }

  broadcastState(state: RuntimeState) {
    const payload = this.serializeState(state);
    this.broadcast(payload);
  }

  broadcastAct(msg: ActMessage) {
    this.broadcast(JSON.stringify({ type: "act", ...msg }));
  }

  stop() {
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
        this.onLoadScene?.(msg.scene as SceneConfig);
        ws.send(JSON.stringify({ type: "sceneLoaded" }));
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
      case "ping": {
        ws.send(JSON.stringify({ type: "pong" }));
        break;
      }
    }
  }
}

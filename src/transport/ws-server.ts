import { WebSocketServer, WebSocket } from "ws";
import type { RuntimeState, ActMessage, SceneConfig } from "../types.js";

/**
 * WebSocket server for the Performance Console.
 *
 * Broadcasts runtime state to all connected clients.
 * Accepts commands: loadScene, getState.
 */
export class WsServer {
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();
  private onLoadScene: ((scene: SceneConfig) => void) | null = null;
  private onGetState: (() => RuntimeState) | null = null;

  constructor(private port: number) {}

  setLoadSceneHandler(handler: (scene: SceneConfig) => void) {
    this.onLoadScene = handler;
  }

  setGetStateHandler(handler: () => RuntimeState) {
    this.onGetState = handler;
  }

  start() {
    this.wss = new WebSocketServer({ port: this.port });

    this.wss.on("connection", (ws) => {
      this.clients.add(ws);
      console.log(
        `WebSocket client connected (${this.clients.size} total)`
      );

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

    console.log(`WebSocket server on port ${this.port}`);
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
    }
  }
}

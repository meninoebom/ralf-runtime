import type {
  SceneConfig,
  DancerState,
  QualityName,
  ReadingConfig,
  ReadingValue,
  ActMessage,
  RuntimeState,
} from "../types.js";
import { Sense } from "../primitives/sense.js";
import { Recognize } from "../primitives/recognize.js";
import { combine } from "../primitives/combine.js";
import { roll } from "../primitives/roll.js";
import { act } from "../primitives/act.js";

const QUALITIES: QualityName[] = [
  "velocity",
  "jerkiness",
  "contraction",
  "verticality",
  "symmetry",
  "coherence",
];

const VALID_QUALITIES = new Set<string>(QUALITIES);

export type ActHandler = (msg: ActMessage) => void;
export type StateHandler = (state: RuntimeState) => void;

/**
 * Edge state key: "dancerId:readingId:intentName"
 * Tracks whether each reading-intent pair was active last frame.
 * Intents only fire on rising edge (transition from inactive to active).
 */
type EdgeState = Map<string, boolean>;

/**
 * The Runtime is the brain — it ticks at 30fps, evaluating the
 * scene's dataflow graph each frame.
 */
export class Runtime {
  private scene: SceneConfig;
  private dancers = new Map<string, DancerState>();
  private senses = new Map<string, Sense>();
  private recognizers = new Map<string, Recognize>();
  private edgeState: EdgeState = new Map();
  private interval: ReturnType<typeof setInterval> | null = null;
  private _tick = 0;

  private onAct: ActHandler | null = null;
  private onState: StateHandler | null = null;

  constructor(scene: SceneConfig) {
    this.scene = scene;
    this.initDancers(scene);
  }

  setActHandler(handler: ActHandler) {
    this.onAct = handler;
  }

  setStateHandler(handler: StateHandler) {
    this.onState = handler;
  }

  /** Feed raw quality data from OSC input. */
  updateQuality(dancerId: string, quality: QualityName, raw: number) {
    if (!VALID_QUALITIES.has(quality)) return;
    const dancer = this.dancers.get(dancerId);
    const sense = this.senses.get(dancerId);
    if (!dancer || !sense) return;
    dancer.qualities[quality] = sense.update(quality, raw);
  }

  /** Feed a gesture event from OSC input. */
  receiveGesture(dancerId: string, gesture: string) {
    const now = Date.now();
    const recognizer = this.recognizers.get(dancerId);
    if (!recognizer) return;

    const accepted = recognizer.receive(gesture, now);
    if (!accepted) return;

    const dancer = this.dancers.get(dancerId);
    if (dancer) {
      dancer.lastGesture = gesture;
      dancer.lastGestureTime = now;
    }
  }

  /** Advance one frame. Public so tests can drive the loop deterministically. */
  tick() {
    this._tick++;

    const allReadings: ReadingValue[] = [];

    for (const dancer of this.dancers.values()) {
      for (const readingConfig of this.scene.readings) {
        const reading = combine(readingConfig, dancer.qualities);
        allReadings.push(reading);

        if (reading.active) {
          this.resolveIntents(dancer.id, readingConfig, reading);
        } else {
          // Mark all intent edges as inactive for this reading
          this.clearEdges(dancer.id, readingConfig);
        }
      }
    }

    this.onState?.({
      dancers: this.dancers,
      readings: allReadings,
      tick: this._tick,
    });
  }

  private resolveIntents(
    dancerId: string,
    config: ReadingConfig,
    reading: ReadingValue
  ) {
    if (!config.intents) return;

    for (const entry of config.intents) {
      let intentName: string;
      let inRange: boolean;

      if (typeof entry === "string") {
        intentName = entry;
        inRange = true; // direct intents are always in range when active
      } else {
        intentName = entry.intent;
        inRange = true;
        if (entry.above !== undefined && reading.value < entry.above)
          inRange = false;
        if (entry.below !== undefined && reading.value > entry.below)
          inRange = false;
      }

      const edgeKey = `${dancerId}:${config.id}:${intentName}`;
      const wasActive = this.edgeState.get(edgeKey) ?? false;
      this.edgeState.set(edgeKey, inRange);

      // Rising edge: fire only on transition from inactive to active
      if (!inRange || wasActive) continue;

      const pool = this.scene.intents[intentName];
      if (!pool || pool.length === 0) continue;

      const chosen = roll(pool);
      if (!chosen) continue;

      const msg = act(chosen, reading.value);
      this.onAct?.(msg);
    }
  }

  private clearEdges(dancerId: string, config: ReadingConfig) {
    if (!config.intents) return;
    for (const entry of config.intents) {
      const intentName = typeof entry === "string" ? entry : entry.intent;
      this.edgeState.set(`${dancerId}:${config.id}:${intentName}`, false);
    }
  }

  start(fps = 30) {
    if (this.interval) return;
    const ms = Math.round(1000 / fps);
    this.interval = setInterval(() => this.tick(), ms);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  getState(): RuntimeState {
    return {
      dancers: new Map(this.dancers),
      readings: this.scene.readings.flatMap((r) =>
        [...this.dancers.values()].map((d) => combine(r, d.qualities))
      ),
      tick: this._tick,
    };
  }

  loadScene(scene: SceneConfig) {
    this.stop();
    this.scene = scene;
    this.dancers.clear();
    this.senses.clear();
    this.recognizers.clear();
    this.edgeState.clear();
    this.initDancers(scene);
  }

  private initDancers(scene: SceneConfig) {
    for (const d of scene.dancers) {
      this.dancers.set(d.id, {
        id: d.id,
        qualities: Object.fromEntries(
          QUALITIES.map((q) => [q, 0])
        ) as Record<QualityName, number>,
        lastGesture: null,
        lastGestureTime: 0,
      });
      this.senses.set(d.id, new Sense());
      this.recognizers.set(d.id, new Recognize());
    }
  }
}

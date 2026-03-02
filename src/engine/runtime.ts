import type {
  SceneConfig,
  DancerState,
  QualityName,
  ReadingConfig,
  ReadingValue,
  ActMessage,
  RuntimeState,
  TranslatorState,
  HysteresisState,
  IntentOption,
  IntentPoolConfig,
  ReadingIntentWithThreshold,
  SceneSettings,
} from "../types.js";
import { Sense } from "../primitives/sense.js";
import { Smooth } from "../primitives/smooth.js";
import { Recognize } from "../primitives/recognize.js";
import { combine } from "../primitives/combine.js";
import { roll } from "../primitives/roll.js";
import { act } from "../primitives/act.js";
import { computeRelational } from "./relational.js";

const ALL_QUALITIES: QualityName[] = [
  "velocity", "acceleration", "jerkiness", "energy", "spatial_extent",
  "contraction", "symmetry", "coherence", "verticality", "heading",
  "stillness", "periodicity", "groundedness",
  "synchrony", "contrast", "aggregate_energy",
];

const VALID_QUALITIES = new Set<string>(ALL_QUALITIES);

export type ActHandler = (msg: ActMessage) => void;
export type StateHandler = (state: RuntimeState) => void;

/**
 * Edge state key: "dancerId:readingId:intentName"
 * Tracks whether each reading-intent pair was active last frame.
 */
type EdgeState = Map<string, boolean>;

/** Per-dancer per-quality staleness tracking */
interface DancerMeta {
  lastUpdateFrame: Record<string, number>;   // quality -> last frame updated
  trajectoryBuffers: Map<string, number[]>;  // readingId -> recent values
}

/**
 * The Runtime is the brain — it ticks at 30fps, evaluating the
 * scene's dataflow graph each frame.
 */
export class Runtime {
  private scene: SceneConfig;
  private dancers = new Map<string, DancerState>();
  private senses = new Map<string, Sense>();
  private smoothers = new Map<string, Smooth>();
  private recognizers = new Map<string, Recognize>();
  private edgeState: EdgeState = new Map();
  private hysteresisState: Map<string, HysteresisState> = new Map(); // dancerId -> state
  private dancerMeta = new Map<string, DancerMeta>();
  private lastEmitted = new Map<string, number>(); // act address -> last value (for deadband)
  private velocityHistories = new Map<string, number[]>();
  private readonly RELATIONAL_WINDOW = 20;
  private interval: ReturnType<typeof setInterval> | null = null;
  private _tick = 0;
  private _translatorState: TranslatorState = { tempo: 120, playing: false, scene: 0 };

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
    const smoother = this.smoothers.get(dancerId);
    const meta = this.dancerMeta.get(dancerId);
    if (!dancer || !sense) return;

    // Sense -> Smooth pipeline
    let value = sense.update(quality, raw);
    if (smoother && this.scene.settings) {
      value = smoother.filter(quality, value);
    }
    dancer.qualities[quality] = value;

    // Track staleness
    if (meta) {
      meta.lastUpdateFrame[quality] = this._tick;
    }
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

  /** Update translator state from /ralf/state/* messages */
  updateTranslatorState(update: Partial<TranslatorState>) {
    Object.assign(this._translatorState, update);
  }

  /** Advance one frame. Public so tests can drive the loop deterministically. */
  tick() {
    this._tick++;
    try {
    const settings = this.scene.settings;
    const stalenessFrames = settings?.staleness_frames ?? 90;
    const hysteresisBand = settings?.hysteresis_band ?? 0.05;

    // Staleness decay
    for (const [dancerId, dancer] of this.dancers) {
      const meta = this.dancerMeta.get(dancerId);
      if (!meta) continue;
      for (const quality of ALL_QUALITIES) {
        const lastUpdate = meta.lastUpdateFrame[quality] ?? 0;
        if (this._tick - lastUpdate > stalenessFrames && lastUpdate > 0) {
          dancer.qualities[quality] = Math.max(0, dancer.qualities[quality] - 0.02);
        }
      }
    }

    // Update velocity histories for relational computation
    for (const [dancerId, dancer] of this.dancers) {
      if (dancerId.startsWith("_")) continue;
      let history = this.velocityHistories.get(dancerId);
      if (!history) {
        history = [];
        this.velocityHistories.set(dancerId, history);
      }
      history.push(dancer.qualities.velocity);
      if (history.length > this.RELATIONAL_WINDOW) {
        history.splice(0, history.length - this.RELATIONAL_WINDOW);
      }
    }

    // Compute relational qualities and inject into _crowd virtual dancer
    const activeDancers = [...this.dancers.keys()].filter(id => !id.startsWith("_"));
    if (activeDancers.length > 1) {
      const relational = computeRelational(
        this.dancers,
        this.velocityHistories,
        this.RELATIONAL_WINDOW,
      );

      let crowd = this.dancers.get("_crowd");
      if (!crowd) {
        crowd = {
          id: "_crowd",
          qualities: Object.fromEntries(ALL_QUALITIES.map(q => [q, 0])) as Record<QualityName, number>,
          lastGesture: null,
          lastGestureTime: 0,
        };
        this.dancers.set("_crowd", crowd);
      }
      crowd.qualities.synchrony = relational.synchrony;
      crowd.qualities.contrast = relational.contrast;
      crowd.qualities.aggregate_energy = relational.aggregate_energy;
    } else {
      this.dancers.delete("_crowd");
    }

    const allReadings: ReadingValue[] = [];

    for (const dancer of this.dancers.values()) {
      const hState = this.hysteresisState.get(dancer.id) ?? new Map();
      this.hysteresisState.set(dancer.id, hState);

      for (const readingConfig of this.scene.readings) {
        const reading = combine(readingConfig, dancer.qualities, hState, hysteresisBand);

        // Trajectory gating
        if (readingConfig.trajectory) {
          const trajKey = readingConfig.id;
          const meta = this.dancerMeta.get(dancer.id);
          if (meta) {
            let buf = meta.trajectoryBuffers.get(trajKey);
            if (!buf) {
              buf = [];
              meta.trajectoryBuffers.set(trajKey, buf);
            }
            buf.push(reading.value);
            const window = readingConfig.trajectory.window;
            if (buf.length > window) buf.splice(0, buf.length - window);

            if (buf.length >= 2) {
              // Linear regression slope
              const n = buf.length;
              let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
              for (let i = 0; i < n; i++) {
                sumX += i;
                sumY += buf[i];
                sumXY += i * buf[i];
                sumX2 += i * i;
              }
              const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

              // Apply trajectory gate
              let trajActive = true;
              if (readingConfig.trajectory.above !== undefined && slope < readingConfig.trajectory.above)
                trajActive = false;
              if (readingConfig.trajectory.below !== undefined && slope > readingConfig.trajectory.below)
                trajActive = false;

              if (!trajActive) reading.active = false;
            } else {
              reading.active = false; // not enough data yet
            }
          }
        }

        allReadings.push(reading);

        const readingActiveKey = `${dancer.id}:${readingConfig.id}:__active__`;
        const readingWasActive = this.edgeState.get(readingActiveKey) ?? false;
        this.edgeState.set(readingActiveKey, reading.active);

        if (reading.active) {
          this.resolveIntents(dancer.id, readingConfig, reading);
        } else {
          // Fire on_exit intents on falling edge (active -> inactive)
          if (readingWasActive && readingConfig.on_exit) {
            for (const intentName of readingConfig.on_exit) {
              this.fireIntent(intentName, reading);
            }
          }
          // Mark all intent edges as inactive for this reading
          this.clearEdges(dancer.id, readingConfig);
        }
      }
    }

    // Mark stale dancers
    for (const [dancerId, dancer] of this.dancers) {
      const meta = this.dancerMeta.get(dancerId);
      if (!meta) continue;
      const updatedQualities = Object.entries(meta.lastUpdateFrame).filter(([, frame]) => frame > 0);
      dancer.stale = updatedQualities.length > 0 &&
        updatedQualities.every(([, frame]) => this._tick - frame > stalenessFrames);
    }

    this.onState?.({
      dancers: this.dancers,
      readings: allReadings,
      tick: this._tick,
      translatorState: { ...this._translatorState },
    });
    } catch (err) {
      console.error("[runtime] tick error:", err);
      return;
    }
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
      let mode: "edge" | "continuous" = "edge";

      if (typeof entry === "string") {
        intentName = entry;
        inRange = true;
      } else {
        intentName = entry.intent;
        mode = entry.mode ?? "edge";
        inRange = true;
        if (entry.above !== undefined && reading.value < entry.above)
          inRange = false;
        if (entry.below !== undefined && reading.value > entry.below)
          inRange = false;
      }

      const edgeKey = `${dancerId}:${config.id}:${intentName}`;
      const wasActive = this.edgeState.get(edgeKey) ?? false;
      this.edgeState.set(edgeKey, inRange);

      if (!inRange) continue;

      // Continuous mode: fire every tick while active
      if (mode === "continuous") {
        this.fireIntent(intentName, reading);
        continue;
      }

      // Edge mode: fire only on rising edge
      if (wasActive) continue;
      this.fireIntent(intentName, reading);
    }
  }

  private fireIntent(intentName: string, reading: ReadingValue) {
    const intentEntry = this.scene.intents[intentName];
    if (!intentEntry) return;

    let pool: IntentOption[];
    let deterministic = false;

    if (Array.isArray(intentEntry)) {
      pool = intentEntry;
    } else {
      pool = intentEntry.pool;
      deterministic = intentEntry.deterministic ?? false;
    }

    if (pool.length === 0) return;

    const chosen = roll(pool, deterministic);
    if (!chosen) return;

    const msg = act(chosen, reading.value);

    // Deadband: only emit set/ actions if value changed enough
    if (chosen.action.startsWith("set/")) {
      const lastVal = this.lastEmitted.get(msg.address);
      if (lastVal !== undefined && Math.abs(reading.value - lastVal) < 0.01) {
        return; // suppress near-identical value
      }
      this.lastEmitted.set(msg.address, reading.value);
    }

    this.onAct?.(msg);
  }

  private clearEdges(dancerId: string, config: ReadingConfig) {
    if (config.intents) {
      for (const entry of config.intents) {
        const intentName = typeof entry === "string" ? entry : entry.intent;
        this.edgeState.set(`${dancerId}:${config.id}:${intentName}`, false);
      }
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
    const settings = this.scene.settings;
    const stalenessFrames = settings?.staleness_frames ?? 90;

    // Compute stale flags for on-demand state requests
    for (const [dancerId, dancer] of this.dancers) {
      const meta = this.dancerMeta.get(dancerId);
      if (!meta) continue;
      const updatedQualities = Object.entries(meta.lastUpdateFrame).filter(([, frame]) => frame > 0);
      dancer.stale = updatedQualities.length > 0 &&
        updatedQualities.every(([, frame]) => this._tick - frame > stalenessFrames);
    }

    return {
      dancers: new Map(this.dancers),
      readings: this.scene.readings.flatMap((r) =>
        [...this.dancers.values()].map((d) => combine(r, d.qualities))
      ),
      tick: this._tick,
      translatorState: { ...this._translatorState },
    };
  }

  /** Full reset: clears all state */
  loadScene(scene: SceneConfig) {
    this.stop();
    this.scene = scene;
    this.dancers.clear();
    this.senses.clear();
    this.smoothers.clear();
    this.recognizers.clear();
    this.edgeState.clear();
    this.hysteresisState.clear();
    this.dancerMeta.clear();
    this.lastEmitted.clear();
    this.velocityHistories.clear();
    this._tick = 0;
    this.initDancers(scene);
  }

  getScene(): SceneConfig {
    return this.scene;
  }

  /** Hot-reload: updates scene config WITHOUT clearing dancers, senses, smoothers, or edge state */
  updateScene(patch: Partial<SceneConfig>) {
    if (patch.readings !== undefined) this.scene.readings = patch.readings;
    if (patch.intents !== undefined) this.scene.intents = patch.intents;
    if (patch.settings !== undefined) this.scene.settings = { ...this.scene.settings, ...patch.settings };
    if (patch.name !== undefined) this.scene.name = patch.name;
    if (patch.translator !== undefined) this.scene.translator = patch.translator;
    // Note: dancers are NOT updated — adding/removing dancers requires loadScene()
  }

  private initDancers(scene: SceneConfig) {
    const settings = scene.settings;
    const decay = settings?.adaptive_range_decay ?? 0.001;
    // Only enable warm-up/min-range when scene provides settings
    const warmup = settings ? 90 : 0;
    const minRange = settings ? 0.05 : 0;
    const smoothMinCutoff = settings?.smoothing_min_cutoff ?? 1.0;
    const smoothBeta = settings?.smoothing_beta ?? 0.007;

    for (const d of scene.dancers) {
      this.dancers.set(d.id, {
        id: d.id,
        qualities: Object.fromEntries(
          ALL_QUALITIES.map((q) => [q, 0])
        ) as Record<QualityName, number>,
        lastGesture: null,
        lastGestureTime: 0,
      });
      this.senses.set(d.id, new Sense(decay, warmup, minRange));
      this.smoothers.set(d.id, new Smooth(smoothMinCutoff, smoothBeta));
      this.recognizers.set(d.id, new Recognize());
      this.dancerMeta.set(d.id, {
        lastUpdateFrame: {},
        trajectoryBuffers: new Map(),
      });
    }
  }
}

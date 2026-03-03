# Ralf Runtime Server

The "brain" of Ralf — a TypeScript server that runs the 11 primitives at 30fps, processing dancer movement into sound responses.

See `../docs/architecture-v2-proposal.md` for the full system architecture and vocabulary.

## Architecture

```
src/
├── types.ts              # All shared types (SceneConfig, ReadingValue, ActMessage, etc.)
├── index.ts              # Entry point — wires OSC, WebSocket, and Runtime together
├── engine/
│   ├── runtime.ts        # The tick loop: evaluates readings, resolves intents with edge detection
│   └── relational.ts     # Cross-dancer qualities: synchrony, contrast, aggregate_energy
├── primitives/
│   ├── adaptive-range.ts # Self-calibrating 0-1 normalizer (ported from States of Being)
│   ├── sense.ts          # Wraps AdaptiveRange per quality per dancer
│   ├── smooth.ts         # One-euro filter: low latency during fast movement, strong smoothing during stillness
│   ├── recognize.ts      # Gesture cooldown/deduplication (per-dancer instances)
│   ├── accumulate.ts     # Windowed rate, total count, or duration tracking
│   ├── combine.ts        # Weighted quality mix + gate → ReadingValue
│   ├── roll.ts           # Weighted random selection from intent pool (deterministic in learning mode)
│   ├── gate.ts           # Condition evaluation with hysteresis (Schmitt trigger)
│   ├── act.ts            # Converts IntentOption → /ralf/act/trigger/* or /ralf/act/set/* OSC message
│   ├── delay.ts          # Time-offsets a signal (post-Burn)
│   ├── map.ts            # Transfer function / response curve (post-Burn)
│   ├── latch.ts          # Sample-and-hold at event time (post-Burn)
│   └── index.ts          # Barrel export
├── transport/
│   ├── osc-server.ts     # UDP OSC input/output with hand-rolled parser
│   └── ws-server.ts      # WebSocket for Performance Console (state broadcast + commands)
├── scenes/
│   ├── loader.ts         # Load/save/list JSON scene configs from scenes/ directory
│   └── validator.ts      # Validate scene config on load (quality names, intent refs, gates)
console/
└── index.html            # Performance Console — live dashboard + scene editor (served on :3300)
```

## Key Design Decisions

### Edge-detected AND continuous intent firing
Intents support two modes:
- **Edge** (default): fires on rising edge only — when a reading transitions from inactive to active. Prevents flooding the audio engine with 30 messages/second. Also supports **on_exit** intents (falling edge).
- **Continuous**: fires every tick while active, passing the reading value. For sustained parameter shaping (filter sweeps, volume rides).

Edge state is tracked per `dancerId:readingId:intentName` triple.

### Reading value pass-through
The reading's continuous 0-1 value is passed as the first arg in every ActMessage.
This means `/ralf/act/set/filter_cutoff 0.73 ...` — the dancer's body shapes the parameter,
not just triggers a preset.

### Trigger vs Set act messages
Act messages are prefixed to tell translators how to apply them:
- `/ralf/act/trigger/*` — execute immediately (fire scene, unmute track)
- `/ralf/act/set/*` — interpolate/slew to value (filter cutoff, send level)

### Two intent mapping patterns
Readings map to intents in two ways (can be mixed in the same reading):
- **Direct**: `"add_energy"` — fires on rising edge whenever the reading is active
- **Threshold**: `{ "intent": "strip_energy", "below": 0.3 }` — fires when reading value is in range

### Per-dancer isolation
Each dancer gets their own `Sense` (AdaptiveRange), `Smooth` (one-euro filter), and `Recognize` (cooldown) instances. Two dancers performing the same gesture don't share state.

### Smoothing pipeline
The signal path is: raw quality -> Sense (AdaptiveRange) -> Smooth (one-euro filter) -> readings/gates/thresholds. Without smoothing, thresholds chatter and audio parameters zipper. This is non-negotiable with real sensor data.

### Gate hysteresis (Schmitt trigger)
Gates use two thresholds: enter active at `threshold + band`, exit at `threshold - band`. Default band: 0.05. Without this, qualities hovering near a threshold produce rapid active/inactive toggling.

### Staleness decay
If no quality update arrives for a dancer for 90 frames (3 seconds), decay values toward 0 at 0.02/frame. Prevents disconnected dancers from leaving system stuck.

### Trajectory
Optional gate on readings that filters by direction of change. Computed as windowed linear regression slope over the reading's recent values. Config: `trajectory: { window: 10, above: 0.1 }` means "only activate when value is building (slope > 0.1)". `below: -0.1` detects releasing. Slope is exposed in state broadcasts (`reading.slope`) and shown in the console dashboard with ↑/↓/→ arrows. 90 tests cover trajectory gating.

### Relational qualities (crowd mode)
When >1 non-virtual dancer is active, the runtime auto-creates a `_crowd` virtual dancer with three qualities:
- **synchrony**: mean pairwise Pearson correlation of velocity histories (20-frame window). Only rewards positive correlation (negative clamped to 0).
- **contrast**: mean pairwise L2 distance of quality vectors, normalized by sqrt(numQualities).
- **aggregate_energy**: mean velocity across all active dancers.

Scene readings can target `_crowd` like any dancer. The `_crowd` dancer is deleted when ≤1 real dancer remains. Relational computation happens after staleness decay but before readings evaluation.

### Learning mode
Intent pools support `"deterministic": true` — highest weight always wins. For rehearsal. Switch to stochastic for performance.

## Development Workflow

Use judgment to plan appropriately for the task:
- Simple changes: just implement directly.
- Larger changes: think through the approach before coding.
- Always create a feature branch, commit with descriptive messages, and create a PR.

## Code Quality

- Write tests first when possible. Prefer test-driven development.
- Run quality checks before committing: `npx tsc --noEmit && npx vitest run`
- Keep commits focused — one logical change per commit.
- Tests use `runtime.tick()` for deterministic frame evaluation — never `setTimeout`.

## Commands

```bash
npm run dev    # Start with hot-reload (tsx watch)
npm run build  # Compile TypeScript
npm test       # Run tests (vitest)
```

## Performance Console

The console is a single HTML file (`console/index.html`) served by the runtime on `:3300` (`RALF_CONSOLE_PORT`).

**Dashboard panels**: Dancers (quality bars, stale dancers dimmed with "(stale)" label), Readings (value + active badge, deduplicated across dancers), Acts (scrolling log + rate), Translator (tempo/playing/scene), System (connection, frames).

**Resilience**: Auto-reconnect with exponential backoff (1s→2s→4s→8s→15s max). Amber "stale" badge + dimmed panels when no state update for 3s. Client-side heartbeat pings every 10s, force-closes after 15s no response. WebSocket errors logged to console.

**Scene Editor** (collapsible): Two sections mirroring the data model:
- **Readings section**: Left-to-right card layout per reading. Left column (Qualities): mix weight sliders, gate thresholds, live values. Right column (Intents): wired intent names as clickable links (scroll to intent section), one-shot/continuous mode toggle, per-wire thresholds. Add/remove readings, add/remove qualities.
- **Intents section**: Each intent card shows action pool with manifest-driven action picker, weight sliders (shown as percentages), args from manifest schema, deterministic toggle. Back-reference badges show which readings use each intent.

Changes send `updateScene` patch via WS — applied immediately without resetting calibration. Save persists to disk. Revert reloads from disk (not in-memory snapshot).

**Translator manifest**: `translators/<type>/manifest.json` declares supported actions with type, description, and args schema. Served via `getManifest` WS command. Populates action picker dropdowns in the editor.

**WebSocket commands** (console → runtime):
- `getState` — request current state snapshot
- `getScene` — request full scene config (populates editor)
- `getManifest` — request translator action manifest
- `updateScene { patch }` — hot-reload scene properties
- `saveScene` — write current scene to disk (stamps version, embeds manifest)
- `saveSceneAs { name }` — clone current scene under a new name
- `switchScene { name }` — load a different scene from disk by name
- `listScenes` — list available scene files (returns `sceneList` with names)
- `reloadScene` — reload scene from disk and broadcast to all clients

**Key gotcha**: `scene.intents[name]` can be `IntentOption[]` or `IntentPoolConfig {pool, deterministic?}`. The console normalizes to `IntentPoolConfig` on load.

## OSC Protocol

Input (what the runtime listens for):
- `/ralf/quality/<dancerId>/<quality>` `<float>` — raw quality value (auto-calibrated then smoothed)
- `/ralf/gesture/<dancerId>` `<string>` — gesture event (cooldown-gated by Recognize)

Output (what the runtime sends):
- `/ralf/act/trigger/<action>` `<readingValue> [args...]` — discrete act (execute immediately)
- `/ralf/act/set/<action>` `<readingValue> [args...]` — continuous act (translator interpolates)

State input (from translators):
- `/ralf/state/tempo` `<float>` — current BPM
- `/ralf/state/playing` `<int>` — transport state (0/1)
- `/ralf/state/scene` `<int>` — current scene index

Health:
- `/ralf/ping` `<string>` — responds with `/ralf/pong`

Valid quality names: `velocity`, `acceleration`, `jerkiness`, `energy`, `spatial_extent`, `contraction`, `symmetry`, `coherence`, `verticality`, `heading`, `stillness`, `periodicity`, `groundedness`.
Unknown quality names are silently ignored.

## Build Status

**Phase 2 — COMPLETE.** All 16 build targets done (71 tests passing).

**Phase 3 (Integration) — COMPLETE.** End-to-end pipeline working: MediaPipe → adapter → runtime → translator → sound.

**Phase 4 (Console) — COMPLETE.** Performance Console + Scene Editor at :3300. Live dashboard, real-time scene editing, save to disk.

**Phase 5 (Crowd Mode) — INTEGRATION TESTED.** Relational qualities (synchrony, contrast, aggregate_energy) computed across dancer pairs. Virtual `_crowd` dancer auto-created when >1 dancer active. IMU adapter accepts phones/wristbands over WebSocket on :3400. Tested end-to-end with 2 phones via ngrok.

**Phase 6 (Scene Editor) — COMPLETE.** Full composition tool: add/remove readings, qualities, intents, and actions. Manifest-driven action picker. Two-section layout (Readings + Intents) mirrors data model. Reading name editing, revert-from-disk, dashboard dedup. 78 tests passing.

**Phase 7 (Hardening) — COMPLETE.** Smart launcher kills stale processes on all 7 ports before start. Runtime: SIGTERM handler, uncaughtException/unhandledRejection safety nets, port binding error messages, tick loop error boundary (log + skip frame). WebSocket heartbeat pings clients every 10s, terminates after 15s. Console: exponential backoff reconnect, stale-state indicator, client-side heartbeat, stale dancer styling. State broadcasts include `stale` flag per dancer.

**Phase 8 (Trajectory) — COMPLETE.** Windowed linear regression slope as optional reading gate. Tests (8 trajectory + 5 validator = 90 total), slope exposed in state broadcasts, console UI for trajectory config (window/above/below), live slope display in dashboard and editor with ↑/↓/→ arrows.

**Phase 9 (Scene Library) — COMPLETE.** Scene picker dropdown in console, Save As, switch between scenes. Every save stamps `version: 1` and embeds translator manifest as `_manifest` for portability. New WS commands: listScenes, saveSceneAs, switchScene. Crowd mode tested end-to-end with 4 phones via ngrok.

**Next priorities:**
- First real rehearsal with dancer — iterate on scene design with sustained movement data

## After Completing Work

Before wrapping up a non-trivial PR, self-assess:
- What was the hardest decision or trickiest problem?
- Did anything surprise you or require a workaround?
- Would a future session benefit from knowing this?
If yes, update this file with the pattern or gotcha.

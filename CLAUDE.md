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
│   ├── draw.ts           # Weighted random selection from intent pool (deterministic in learning mode)
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
- **cohesion**: mean pairwise Pearson correlation of velocity histories (20-frame window). **Signed (−1..1)** — negative means deliberate anti-phase (counterpoint), not absence of relationship.
- **synchrony**: deprecated alias for `max(0, cohesion)`. Kept for one release so existing scenes still work. Migrate to `cohesion`.
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
- Run quality checks before committing: `bun run typecheck && bun test`
- Keep commits focused — one logical change per commit.
- Tests use `runtime.tick()` for deterministic frame evaluation — never `setTimeout`.

## Commands

```bash
bun run dev        # Start with hot-reload
bun run start      # Start without watch
bun run typecheck  # tsc --noEmit
bun test           # Run tests (vitest)
```

## Performance Console

Live dashboard + scene editor served on `:3300`. See `docs/performance-console.md` for layout details, WebSocket commands, and signal strip architecture.

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

Phases 2-10 complete (90 tests). See `docs/build-status.md` for detailed phase history.

**Next:** First real rehearsal with dancer — iterate on scene design with sustained movement data.

## After Completing Work

Before wrapping up a non-trivial PR, self-assess:
- What was the hardest decision or trickiest problem?
- Did anything surprise you or require a workaround?
- Would a future session benefit from knowing this?
If yes, update this file with the pattern or gotcha.

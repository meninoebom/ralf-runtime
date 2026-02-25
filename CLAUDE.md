# Ralf Runtime Server

The "brain" of Ralf — a TypeScript server that runs the 7 primitives at 30fps, processing dancer movement into sound responses.

See `../docs/architecture.md` for the full system architecture and vocabulary.

## Architecture

```
src/
├── types.ts              # All shared types (SceneConfig, ReadingValue, ActMessage, etc.)
├── index.ts              # Entry point — wires OSC, WebSocket, and Runtime together
├── engine/
│   └── runtime.ts        # The tick loop: evaluates readings, resolves intents with edge detection
├── primitives/
│   ├── adaptive-range.ts # Self-calibrating 0-1 normalizer (ported from States of Being)
│   ├── sense.ts          # Wraps AdaptiveRange per quality per dancer
│   ├── recognize.ts      # Gesture cooldown/deduplication (per-dancer instances)
│   ├── accumulate.ts     # Windowed rate or total count tracking (not yet wired into runtime)
│   ├── combine.ts        # Weighted quality mix + gate → ReadingValue
│   ├── roll.ts           # Weighted random selection from intent pool
│   ├── gate.ts           # Condition evaluation with and/or logic (not yet wired into runtime)
│   ├── act.ts            # Converts IntentOption → /ralf/act/* OSC message
│   └── index.ts          # Barrel export
├── transport/
│   ├── osc-server.ts     # UDP OSC input/output with hand-rolled parser
│   └── ws-server.ts      # WebSocket for Performance Console
└── scenes/
    └── loader.ts         # Load/save/list JSON scene configs from scenes/ directory
```

## Key Design Decisions

### Edge-detected intent firing
Intents fire on **rising edge only** — when a reading transitions from inactive to active.
Without this, the system would flood the audio engine with 30 messages/second.
Edge state is tracked per `dancerId:readingId:intentName` triple.

### Reading value pass-through
The reading's continuous 0-1 value is passed as the first arg in every ActMessage.
This means `/ralf/act/filter_cutoff 0.73 ...` — the dancer's body shapes the parameter,
not just triggers a preset. Without this, the continuous quality pipeline would
terminate in a binary trigger.

### Two intent mapping patterns
Readings map to intents in two ways (can be mixed in the same reading):
- **Direct**: `"add_energy"` — fires on rising edge whenever the reading is active
- **Threshold**: `{ "intent": "strip_energy", "below": 0.3 }` — fires when reading value is in range

### Per-dancer isolation
Each dancer gets their own `Sense` (AdaptiveRange) and `Recognize` (cooldown) instances.
Two dancers performing the same gesture don't share cooldown state.

### Primitives not yet wired
`Accumulate` and `Gate` exist as standalone primitives with tests, but are not yet
connected to the runtime loop. They will be wired in Phase 2 alongside gesture profiles,
streams, stacks, and signals (porting the full M4L mapping system).

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

## OSC Protocol

Input (what the runtime listens for):
- `/ralf/quality/<dancerId>/<quality>` `<float>` — raw quality value (auto-calibrated by AdaptiveRange)
- `/ralf/gesture/<dancerId>` `<string>` — gesture event (cooldown-gated by Recognize)

Output (what the runtime sends):
- `/ralf/act/<action>` `<readingValue> [args...]` — act messages to audio engine translator

Valid quality names: `velocity`, `jerkiness`, `contraction`, `verticality`, `symmetry`, `coherence`.
Unknown quality names are silently ignored.

## Scene Config Format

```json
{
  "name": "house-session",
  "dancers": [
    { "id": "maya", "input": { "type": "mediapipe", "port": 6448 } }
  ],
  "readings": [
    {
      "id": "hitting-the-beat",
      "mix": { "jerkiness": 0.6, "velocity": 0.3 },
      "gate": { "jerkiness": { "above": 0.2 } },
      "intents": ["add_energy"]
    },
    {
      "id": "energy-level",
      "mix": { "velocity": 0.5, "jerkiness": 0.5 },
      "intents": [
        { "intent": "strip_energy", "below": 0.3 },
        { "intent": "add_energy", "above": 0.7 }
      ]
    }
  ],
  "intents": {
    "add_energy": [
      { "action": "fire_next_scene", "weight": 2 },
      { "action": "unmute_track", "args": { "track": "perc" }, "weight": 3 }
    ]
  },
  "sonic_world": { "type": "ableton", "port": 12000 }
}
```

## Known Gaps (from team review)

Tracked for future phases — do not implement prematurely:

| Gap | Phase | Notes |
|-----|-------|-------|
| Accumulate/Gate not wired into runtime | 2 | Need gesture profiles, streams, stacks in scene config |
| Signals (transport control) | 2 | Direct commands bypassing intents, like start/stop |
| Smoothing/slew on qualities | 2 | Pose data is noisy; needs temporal smoothing before thresholds |
| OSC compat with Gesture Studio | 2 | Studio sends `/gesture/N` float, runtime expects `/ralf/gesture/<id>` string |
| Quality computation from raw pose | 2 | MediaPipe sends raw skeleton; something must compute qualities |
| Graph evaluation engine | 3 | Replace fixed pipeline with topological node evaluation for visual patcher |
| Hysteresis on thresholds | 4 | Schmitt trigger to prevent rapid on/off around boundary |
| Scene sequencing / state machine | 4 | Automated scene progression for long installations |
| Relational qualities (between dancers) | 5 | Proximity, mirroring, synchrony for duo/crowd |

## After Completing Work

Before wrapping up a non-trivial PR, self-assess:
- What was the hardest decision or trickiest problem?
- Did anything surprise you or require a workaround?
- Would a future session benefit from knowing this?
If yes, update this file with the pattern or gotcha.

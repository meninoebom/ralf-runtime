# Ralf Runtime Server

The "brain" of Ralf — a TypeScript server that runs the 7 primitives at 30fps, processing dancer movement into sound responses.

## Architecture

- `src/primitives/` — The 7 node types (Sense, Recognize, Accumulate, Combine, Roll, Gate, Act)
- `src/engine/runtime.ts` — The tick loop that evaluates the dataflow graph
- `src/transport/` — OSC (UDP) and WebSocket servers
- `src/scenes/` — Scene config loading/saving
- `scenes/` — JSON scene files

## Development Workflow

Use judgment to plan appropriately for the task:
- Simple changes: just implement directly.
- Larger changes: think through the approach before coding.
- Always create a feature branch, commit with descriptive messages, and create a PR.

## Code Quality

- Write tests first when possible. Prefer test-driven development.
- Run quality checks before committing: `npx tsc --noEmit && npx vitest run`
- Keep commits focused — one logical change per commit.

## Commands

```bash
npm run dev    # Start with hot-reload (tsx watch)
npm run build  # Compile TypeScript
npm test       # Run tests (vitest)
```

## OSC Protocol

Input:
- `/ralf/quality/<dancerId>/<quality>` `<float>` — quality value
- `/ralf/gesture/<dancerId>` `<string>` — gesture event

Output:
- `/ralf/act/<action>` `[args...]` — act messages to audio engine

## After Completing Work

Before wrapping up a non-trivial PR, self-assess:
- What was the hardest decision or trickiest problem?
- Did anything surprise you or require a workaround?
- Would a future session benefit from knowing this?
If yes, update this file with the pattern or gotcha.

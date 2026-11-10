---
date: 2026-11-10
type: fix
slug: worker-restart-zombies
---

# Restarting a bot no longer leaves its old worker running

**Type:** fix

## Motivation

After the codex crosstalk fix, a group still showed two claude-bot sessions working on the same task at the same time. One was told a message "went to the other session". The cause was outside the session code. Under one supervisor there were **6 worker processes for 3 bots**:

- 2 extra codex-bot workers, the oldest from 11/9 and still running pre-fix code;
- 1 extra claude-bot worker.

Each extra worker kept its own Lark WebSocket connection. With several connections per app, Lark delivers each event to one of them, so a group's consecutive messages landed on different workers. Each of those workers had its own dispatch lane and in-memory session cache, and they all wrote to the same per-bot session file. The result was concurrent runs and divergent sessions in one chat. `ps` showed 11 to 12 restarts per bot.

## What changed

`WorkerManager` (`src/supervisor/worker-manager.ts`):

- `restart()` used to SIGTERM the old worker and fork the new one immediately. It now waits for the old worker to exit. The new `terminate()` sends SIGTERM, then SIGKILL after `killTimeoutMs` (default 10 s).
- `stop()` uses `terminate()` too, and waits for every worker.
- The exit handler ignores a child that is no longer the slot's current one. Before, a replaced worker's late exit cleared the *new* worker's reference, and on a non-zero code it **forked yet another worker**. This is how the extras piled up, and why killing the extras marked healthy bots `stopped`.

Worker (`src/worker/index.ts`, `src/worker/dispatcher.ts`):

- `Dispatcher.abortAll()` drops queued work, aborts every running chat (its CLI is killed through the abort signal), and waits for the runs to wind down.
- On SIGTERM the worker calls `abortAll()`, then `ws.stop()`, with a 5 s hard `process.exit`. A hung WebSocket close can no longer keep a replaced worker alive. Running CLIs are no longer orphaned on restart.

Ops done alongside (not code): the three extra workers were killed by hand on 2026-11-10. They had no running tasks.

## Files touched

- `src/supervisor/worker-manager.ts`: `terminate()`, awaited restart/stop, stale-exit guard, `killTimeoutMs` option.
- `src/worker/dispatcher.ts`: `abortAll()`.
- `src/worker/index.ts`: shutdown aborts runs and can't hang.
- `tests/supervisor/worker-manager.test.ts`, `tests/supervisor/__fixtures__/stubborn-worker.cjs`: a worker that ignores SIGTERM. After `restart()` the old one is dead, the new one is tracked and `ready`, and exactly one worker is alive.
- `tests/worker/dispatcher.test.ts`: `abortAll()` interrupts every running chat; it's a no-op when idle.

## Verification

- RED: the restart test fails on the old code (old worker still alive). The `abortAll` tests failed before it existed.
- GREEN: `pnpm typecheck`, `pnpm lint`, `pnpm test` (404 passing).

## Architecture impact

Updated `docs/architecture.md` / `.zh.md` (crash recovery): restart/stop semantics, plus the version marker.

## Links

- Related: [2026-11-09-codex-session-crosstalk](2026-11-09-codex-session-crosstalk.md)
- Commits: branch `fix/codex-session-crosstalk`
- CHANGELOG: `[Unreleased]` entry

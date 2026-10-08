---
date: 2026-10-08
type: chore
slug: dev-reload-scripts
---

# `pnpm reload` / `pnpm reload:all` for the edit-build-restart loop

**Type:** chore

## Motivation

Picking up a code change required remembering and typing two commands:

```bash
pnpm build
node ./bin/lmcb.mjs restart <bot>
```

Two annoyances beyond the typing. `pnpm build` runs `tsup` with `dts: true`,
and generating `.d.ts` files dominates the build — measured on this repo,
**3.1s with dts vs 0.3s without**, a 10× difference paid on every iteration
for declaration files that only matter to someone importing this package.
And running the two commands separately means a failed build doesn't stop
the restart, so it's easy to debug against stale `dist/` output.

## What changed

Two scripts in `package.json`:

```json
"reload": "tsup --no-dts && node ./bin/lmcb.mjs restart",
"reload:all": "tsup --no-dts && (node ./bin/lmcb.mjs stop || true) && node ./bin/lmcb.mjs start",
```

`pnpm reload <bot>` — rebuild, then restart one worker. The bot name is not
baked into the script: pnpm appends run arguments to the end of the command
string, which lands them right after `restart`. So `pnpm reload codex-bot`
expands to `tsup --no-dts && node ./bin/lmcb.mjs restart codex-bot`, and the
script keeps working for bots added later. Omitting the argument is a
commander usage error, not a silent no-op.

`pnpm reload:all` — rebuild, then stop and start the supervisor. Needed when
the change is in supervisor / CLI / IPC code, which lives in the supervisor
process: `restart` only re-forks workers and can't reload it. There is no
`restart --all` on the IPC protocol (`Methods` has only `restart-worker`
taking one bot), so a full stop/start is the straightforward way to cycle
everything.

The `stop` step is wrapped in `(… || true)` so the script doubles as a cold
start. `stopCommand` `process.exit(1)`s when it can't reach the supervisor
(no `ipc.sock` → `ENOENT` on connect), which with a bare `&&` would abort the
chain before `start` ever ran — exactly the case where you most want it to
run. Swallowing that exit is safe because `startCommand` guards the other
direction: if the socket exists and still answers `ping` it refuses with
`supervisor already running` rather than starting a second one (a stale
socket falls through).

Otherwise both chain with `&&`, so a failed build skips the restart instead
of leaving a worker running against a stale `dist/`.

`--no-dts` is safe here because type *checking* is `pnpm typecheck`
(`tsc --noEmit`), a separate job from declaration emit. `pnpm build` is
unchanged and still emits declarations for release.

Why a restart suffices at all: `WorkerManager.spawn` uses `fork()`
(`src/supervisor/worker-manager.ts:102`), so each restart is a fresh Node
process that loads the current `dist/`. No supervisor restart is needed for
worker-side changes, and sibling bots keep running.

## Files touched

- `package.json` — added the `reload` and `reload:all` scripts.

## Verification

- `pnpm reload`'s argument passthrough verified against a scratch package:
  `pnpm run demo codex-bot` on `"demo": "echo FIRST && echo RESTART"` printed
  `RESTART codex-bot`, confirming pnpm appends to the end of a `&&` chain
  rather than to the first command.
- Build timings measured with `time npx tsup` (3.1s) vs
  `time npx tsup --no-dts` (0.3s).
- `pnpm typecheck` / `pnpm test` (320) / `pnpm lint` — pass, unchanged; this
  touches no source.

## Architecture impact

`None.` — tooling only; no module, topology, IPC, or on-disk state change.

## Links

- Spec: `—`
- Plan: `—`
- Commits: `<pending>`
- CHANGELOG: `[Unreleased]` entry

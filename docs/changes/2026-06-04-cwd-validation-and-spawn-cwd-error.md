---
date: 2026-06-04
type: fix
slug: cwd-validation-and-spawn-cwd-error
---

# Validate user-supplied cwd in /cd and /new; disambiguate bad-cwd spawn ENOENT

**Type:** fix

## Motivation

A user sent `/cd /Downloads/wiz/projects/voice-agent` (mistyped — missing
the `/Users/<name>` prefix) to codex-bot in a group. Two defects turned
that typo into a confusing failure:

1. **`/cd` (and `/new <path>`) stored the path without checking it
   exists.** The bad cwd was silently persisted into
   `state/sessions.json`, bricking every subsequent agent run in that
   chat until a corrective `/cd`.
2. **Node reports spawn-with-nonexistent-cwd as `spawn <cmd> ENOENT`** —
   byte-identical to a missing binary. The bot replied
   `failed to spawn codex: spawn codex ENOENT`, sending debugging toward
   "codex isn't installed" when codex was fine (preflight had succeeded
   moments earlier in the same worker).

## What changed

- New `src/commands/cwd.ts` shared module:
  - `resolveCwd(value)` — `~` / `~/x` expansion + absolute resolve.
    Previously copy-pasted in three places (`cd.ts`, `new.ts`,
    `worker/index.ts`); now single-sourced. `cd.ts` previously used a
    weaker `path.replace(/^~/, …)` that mishandled bare `~` vs `~abc`.
  - `validateCwd(cwd)` — async stat check returning a user-facing error
    string or `undefined` when valid. Distinguishes the failure modes:
    `directory does not exist: …` (ENOENT/ENOTDIR), `not a directory: …`
    (path is a file), and `cannot access directory: … (<code>)` for
    anything else (e.g. EACCES when a parent lacks the execute bit) —
    reporting an unreadable-but-present path as "does not exist" would
    repeat the very misdirection this change exists to remove.
- `/cd` and `/new <path>` now call `validateCwd` after resolving and
  **reject without touching the session store** when the target is
  missing or not a directory.
- `spawnWithLifecycle` (`src/adapters/base.ts`): on spawn failure, if a
  `cwd` was passed and doesn't exist, throw
  `directory does not exist: <cwd> (failed to spawn <cmd>)` instead of the
  misleading generic `failed to spawn <cmd>: spawn <cmd> ENOENT` — phrasing
  deliberately matched to `validateCwd` so both layers speak the same way.
  This is
  defense-in-depth for cwds that *were* valid when stored but deleted
  later — command-time validation can't catch those.

## Files touched

- `src/commands/cwd.ts` — new: shared `resolveCwd` + `validateCwd`.
- `src/commands/handlers/cd.ts` — validate before persisting; use shared
  `resolveCwd`.
- `src/commands/handlers/new.ts` — validate before persisting; local
  `resolveCwd` copy removed in favor of the shared one.
- `src/worker/index.ts` — local `resolveCwd` copy removed in favor of the
  shared one (behavior identical).
- `src/adapters/base.ts` — bad-cwd spawn failures now name the real cause.
- `tests/commands/cd.test.ts` — new: handler-level tests covering
  reject-nonexistent, reject-non-directory, accept-existing, `~`
  expansion, for both `/cd` and `/new` (real `SessionStore` on a temp
  file, no mocks); plus direct `validateCwd` unit tests including the
  EACCES-vs-ENOENT distinction (parent dir chmod `000`, skipped under root).
- `tests/adapters/base.test.ts` — new regression test: nonexistent cwd
  must surface as `directory does not exist: …`, distinct from missing binary.

## Verification

- TDD: all new tests written first and watched fail for the right reason
  (4 failed: handlers accepted bad paths; base.ts threw the generic
  message), then pass after implementation.
- `pnpm typecheck` — clean.
- `pnpm test` — 42 files, 252 tests, all green.
- `pnpm lint` — failed with 34 pre-existing problems in untouched files
  (already failing on `main` before this change; none in files this
  change touches). Cleaned up in a follow-up lint-only commit on the
  same branch; lint is green at branch tip.
- Root-cause reproduction: `spawn('codex', …, {cwd: '/Downloads/…'})`
  confirmed to emit `spawn codex ENOENT` on Node 24.

## Architecture impact

None. No module responsibilities, process topology, adapter event
contract, IPC, or on-disk state shape changed. (`commands/` internal
helper added; command count unchanged.)

## Links

- Spec: —
- Plan: —
- Commits: (filled at merge)
- CHANGELOG: `[Unreleased]` → Fixed

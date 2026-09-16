---
date: 2026-09-15
type: fix
slug: workspace-store-read-through
---

# WorkspaceStore reads through to disk (fixes cross-worker workspace clobber)

**Type:** fix

## Motivation

`WorkspaceStore` had the same shape of bug that
[per-bot-session-files](2026-07-10-per-bot-session-files.md) fixed for
sessions, and that change doc recorded it as a follow-up:

- `state/workspaces.json` is written by every per-bot worker
  (`claude-bot`, `codex-bot`, `gemini-bot`).
- Each store called `load()` once at worker startup and then wrote its
  **whole in-memory snapshot** back on every `save` / `remove`.
- So a worker's write reverted every other worker's entries to whatever
  that worker booted with — cross-process last-writer-wins. Worker
  restarts are frequent, so the snapshot was routinely stale.

Two user-visible symptoms fell out of this:

1. **Lost saves.** `/ws save alpha` in claude-bot, then `/ws save beta`
   in codex-bot, and `alpha` was gone from the file.
2. **Stale reads.** Even with nothing clobbered, a store never re-read
   the file after startup, so a workspace saved from one bot stayed
   invisible to the others until their workers restarted.

## What changed

`WorkspaceStore` is now **read-through**: it holds no cache, every
accessor reads the file, and every mutation is a read-modify-write of
just its own key.

Note the deliberate difference from the session fix. Sessions are already
keyed by `(chatId, botName)`, so splitting them into `state/sessions/<bot>.json`
cost nothing. Workspace aliases are a **global namespace** — `/ws save` in
claude-bot is meant to resolve from codex-bot — so a per-bot split would
fragment them. One shared file is the right shape here; the fix is to stop
writing it from a stale snapshot.

- `resolve(name)` and `list()` became **async** and read from disk.
- `save(name, path)` / `remove(name)` re-read the file, apply their single
  delta, then `writeJsonAtomic`.
- `load()` is retained for lifecycle symmetry with `SessionStore` (the
  worker and tests call it) but is now a no-op — there is nothing to warm.
- `read()` also guards against a malformed/absent `named` key rather than
  trusting the cast.

On-disk format, file path, and the `/ws` command surface are unchanged.

**Known limit:** read-modify-write is not atomic across processes, so two
workers mutating within the same few milliseconds can still lose one edit.
`/ws` is interactive and low-frequency, so that window is negligible next
to the worker-lifetime window it replaces. Proper cross-process locking was
judged not worth the complexity here.

## Files touched

- `src/session/workspace.ts` — read-through store: async `resolve`/`list`,
  read-modify-write `save`/`remove`, `load()` now a no-op, `read()` helper
  with shape guard, class docstring explaining why this store stays shared
  while `SessionStore` went per-bot.
- `src/commands/handlers/ws.ts` — `await` the now-async `resolve`/`list`;
  the `list` branch reads once and derives the card's `named` map from that
  single read instead of calling `list()` twice.
- `tests/session/workspace.test.ts` — existing round-trip now awaits the
  accessors; three new tests: a sibling store's save is not clobbered, a
  sibling's removal is not resurrected, and a sibling's save is visible
  without a reload.
- `.gitignore` — ignore `.idea/` / `.vscode/` / `*.swp` (the `.idea/`
  files committed on this branch are untracked in the same push).

## Verification

- Red first: the three new tests failed against the old store
  (`expected '/srv/alpha', got undefined` for both the clobber and the
  stale-read cases); the round-trip test passed throughout, as expected —
  it only exercises single-process behavior.
- `pnpm typecheck` — passes.
- `pnpm test` — 320 tests pass (317 → 320).
- `pnpm lint` — clean.

## Architecture impact

Updated `docs/architecture.md` / `.zh.md` (module map + on-disk state
tree): the `session/` row now distinguishes the two persistence
strategies, and `state/workspaces.json` is annotated as a shared,
read-through, multi-writer file.

## Links

- Spec: `—` (bug fix)
- Plan: `—`
- Follow-up to: [2026-07-10-per-bot-session-files](2026-07-10-per-bot-session-files.md)
- Commits: `<pending>`
- CHANGELOG: `[Unreleased]` entry

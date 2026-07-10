---
date: 2026-07-10
type: fix
slug: per-bot-session-files
---

# Per-bot session files (fix cross-worker session clobber / "串台")

**Type:** fix

## Motivation

Bots frequently "went to the wrong session" — resuming a stale/older
conversation for a chat. Root cause (found via systematic debugging):

- All three per-bot workers (`claude-bot`, `codex-bot`, `gemini-bot`) shared
  **one** file, `state/sessions.json`.
- Each worker's `SessionStore` `load()`s that file **once** at startup and
  never reloads, then rewrites the **entire** blob on every `upsert`
  (`writeJsonAtomic(this.data)`).
- So a sibling worker's write reverted another bot's slots to *its* stale
  startup snapshot — cross-process last-writer-wins. Each worker's in-memory
  copy stayed correct during its own lifetime, but on the **next restart** it
  reloaded a clobbered file and resumed the wrong `sessionId`.
- Worker restarts were frequent (140–205 per bot over ~7 days), so this bit
  constantly. On-disk evidence: slots reverted to older `sessionId` /
  `messageCount` values than the live conversation.

Session/cwd keying itself (`(chatId, botName)`) was already correct; the bug
was purely the shared-file, load-once, whole-file-write pattern across
processes.

## What changed

Each worker now owns its **own** session file — `state/sessions/<bot>.json` —
so there is a single writer per file and no cross-process clobber.

- `SessionStore` gained an optional second constructor arg
  `{ botName?, legacyPath? }`. On `load()`, if the per-bot file is empty and
  `legacyPath` (the old shared `sessions.json`) exists, it extracts **only this
  bot's** slots (`extractBot`) into the per-bot file, once. The legacy file is
  left untouched — each bot migrates its own slice.
- `paths` gained `sessionsDir` (`state/sessions/`) and
  `sessionBotJson(botName)` (`state/sessions/<bot>.json`, with the same
  bot-name sanitization as `shimsDir`). `sessionsJson` remains only as the
  migration source.
- The worker constructs
  `new SessionStore(paths.sessionBotJson(bot.name), { botName, legacyPath: paths.sessionsJson })`.
- `get` / `upsert` / `reset` / `setCwd` / `setIdleTimeout` / `list` are
  unchanged (still the 2D `(chatId, botName)` API); each per-bot file simply
  only ever contains that one bot's slots.

Behaviour note: `/sessions` (already filtered to `ctx.bot.name`) now naturally
lists only the current bot's sessions, since each worker's store holds only its
own file.

## Files touched

- `src/session/store.ts` — `SessionStoreOpts`, one-time legacy migration in
  `load()`, `extractBot` helper; docstring updated.
- `src/config/paths.ts` — `sessionsDir` + `sessionBotJson(botName)`;
  `sessionsJson` re-documented as legacy migration source.
- `src/worker/index.ts` — construct the store with the per-bot path + opts.
- `tests/session/store.test.ts` — new tests: two per-bot stores don't clobber
  across reloads; one-time migration extracts only this bot's slots; per-bot
  file wins once populated (legacy ignored).

## Verification

- Red first: the migration tests failed before the fix (no opts / no
  migration).
- `pnpm typecheck` — passes.
- `pnpm test` — all 317 tests pass (3 new).
- `pnpm lint` — clean.

## Architecture impact

Updated `docs/architecture.md` / `.zh.md` (on-disk state tree): `state/
sessions.json` → `state/sessions/<bot>.json` (per-bot, single-writer), with the
legacy file noted as a one-time migration source.

## Follow-ups (not in this change)

- `WorkspaceStore` (`state/workspaces.json`) shares the same load-once /
  whole-file-write / shared-file pattern and likely has the same latent
  clobber; worth the same per-bot treatment separately.
- The high worker-restart rate (140–205/7d) is worth investigating on its own —
  it amplified this bug.

## Links

- Spec: `—` (bug fix)
- Plan: `—`
- Commits: `<pending>`
- CHANGELOG: `[Unreleased]` entry

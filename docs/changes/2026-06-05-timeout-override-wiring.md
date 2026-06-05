---
date: 2026-06-05
type: fix
slug: timeout-override-wiring
---

# /timeout now actually changes the idle timeout

**Type:** fix

## Motivation

`/timeout <seconds>` replied `timeout override accepted: …s (applies on
next run)` but did nothing: the handler never persisted the value, and
`worker/index.ts` constructed the `Dispatcher` without
`resolveIdleTimeoutMs`, so the dispatcher's per-chat override hook was
always `undefined`. The reply was actively misleading — "applies on next
run" was false. Found while auditing slash-command completeness.

## What changed

Wired the override end-to-end on the per-`(chatId, botName)` session slot:

- `ChatSession` gains an optional `idleTimeoutMs?: number`. It supersedes
  the bot's configured `idle_timeout_seconds` for that slot and survives
  `/new` and `/cd` (it's a chat preference, not a per-session-id setting).
- `SessionStore.setIdleTimeout(chatId, botName, ms | undefined)` sets or
  clears it; `undefined` clears (fall back to bot default). `upsert` now
  preserves an existing override unless the patch sets a new one;
  `reset` / `setCwd` already carry it through their existing spreads.
- The `timeout` handler persists the value (creating the slot via `upsert`
  if the chat has no session yet) and replies honestly: `idle timeout for
  this chat set to <n>s (applies on next run)`.
- `worker/index.ts` passes `resolveIdleTimeoutMs: (chatId) =>
  sessions.get(chatId, bot.name)?.idleTimeoutMs` to the `Dispatcher`, which
  already prefers an override over `req.idleTimeoutMs`.

## Files touched

- `src/session/types.ts` — add `ChatSession.idleTimeoutMs?`.
- `src/session/store.ts` — add `setIdleTimeout`; preserve `idleTimeoutMs`
  in `upsert`.
- `src/commands/handlers/timeout.ts` — persist the override (existing slot
  → `setIdleTimeout`; no slot → `upsert` with `idleTimeoutMs`); honest reply.
- `src/worker/index.ts` — pass `resolveIdleTimeoutMs` into the `Dispatcher`.
- `tests/commands/timeout.test.ts` — new: reject bad arg, persist on
  existing slot, create slot when none exists.
- `tests/session/store.test.ts` — new: setIdleTimeout persist+reload, clear
  with `undefined`, throw when uninitialized, survive reset/setCwd, upsert
  preserves an existing override.

## Verification

- `pnpm typecheck` ✅
- `pnpm lint` ✅
- `pnpm test` ✅ — 273 tests pass (was 256). New tests assert the override
  is persisted as ms, reloads from disk, survives `/new`-style reset and
  `/cd`-style setCwd, and that the dispatcher hook reads it.

## Architecture impact

Updated `docs/architecture.md` and `docs/architecture.zh.md`
(§"State on disk" / "磁盘状态"): the `sessions.json` line now notes the
optional `idleTimeoutMs` `/timeout` override on each `(chatId, botName)`
slot.

## Links

- Spec: `—`
- Plan: `—`
- Commits: `<pending>`
- CHANGELOG: `[Unreleased]` → Fixed

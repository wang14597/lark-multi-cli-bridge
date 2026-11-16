---
date: 2026-11-13
type: fix
slug: concurrent-session-save-crash
---

# Two chats starting at once no longer crash the worker

**Type:** fix

## Motivation

Two new groups each gave gemini-bot a task one second apart (16:23:35 and 16:23:36). Three seconds later the gemini-bot worker logged `uncaught exception` and exited. Both runs died with it. Their cards stayed on "正在思考" for good, and the users saw no error.

## What changed

The error was `ENOENT: rename '…/gemini-bot.json.tmp.<pid>.<ms>' -> '…/gemini-bot.json'`.

- **Temp-file collision.** `writeJsonAtomic` named its temp file `<path>.tmp.<pid>.<Date.now()>`. When both runs saved their session in the same millisecond, the two writes shared one temp file. The first `rename` moved it, and the second found nothing.
- **Unhandled rejection.** `onSessionUpdate` called `void sessions.upsert(...)`, so the rejection was unhandled and took the whole worker down.

The fix has three parts:

- `src/util/atomic-file.ts`: the temp name now uses `randomUUID()` instead of the millisecond.
- `src/session/store.ts`: `persist()` chains writes so they run one at a time. An older snapshot can no longer finish after a newer one and overwrite it. Before, concurrent saves could silently lose a chat's latest session id.
- `src/worker/index.ts`: `onSessionUpdate` catches a failed save and logs `saving session failed` instead of crashing.

The bug existed before this change, as long as concurrent runs were possible. It only became visible once several groups started work at the same moment.

## Files touched

- `src/util/atomic-file.ts`, `src/session/store.ts`, `src/worker/index.ts`: see above.
- `tests/util/atomic-file.test.ts`: 20 concurrent writes to one file all succeed and leave no temp files.
- `tests/session/store.test.ts`: 10 chats upserting at once are all present after a reload.

## Verification

- RED: both new tests fail on the old code. The atomic-write test fails with the same ENOENT, and the store test loses chats.
- GREEN: `pnpm typecheck`, `pnpm lint`, `pnpm test` (408 passing).

## Architecture impact

None.

## Links

- Commits: branch `fix/ws-handshake-timeout-crash`
- CHANGELOG: `[Unreleased]` entry

---
date: 2026-11-11
type: fix
slug: ws-handshake-timeout-crash
---

# A network blip no longer disables every bot

**Type:** fix

## Motivation

On 2026-11-11 around 10:02 the network was briefly unstable. All three bots were then left `disabled` and stopped answering. Each worker logged `[ws] handshake timeout after 8000ms` and exited with code 1. The supervisor restarted them, they failed the same way, and after 5 crashes within 3 minutes the crash budget disabled them. A disabled bot stays down until someone restarts it by hand.

## What changed

The crash comes from the Lark SDK's handshake timeout (`@larksuiteoapi/node-sdk`). On timeout it calls `wsInstance.removeAllListeners()` and then `wsInstance.terminate()`. Terminating a socket that is still connecting makes `ws` emit `WebSocket was closed before the connection was established`. That handler has just been removed, so the error is uncaught and kills the process, even though the SDK has already marked the attempt as failed and would retry. A standalone `ws` repro reproduced it: same error, exit code 1.

- `src/lark/ws.ts`: `isAbortedHandshakeError(err)` recognises exactly that error.
- `src/worker/index.ts`: a `process.on('uncaughtException')` handler logs that error as a warning and keeps the worker running, so the SDK's own retry continues. Any other uncaught exception is logged as fatal and still exits 1, as before.

Before the restart fix ([2026-11-10-worker-restart-zombies](2026-11-10-worker-restart-zombies.md)), leftover zombie workers kept their Lark connections alive. That probably hid this crash. Once each bot had a single worker, the crash was enough to take the bot offline.

The bots were re-enabled by hand on 2026-11-11 at 10:07, after the network had recovered.

## Files touched

- `src/lark/ws.ts`: `isAbortedHandshakeError`.
- `src/worker/index.ts`: uncaught-exception guard.
- `tests/lark/ws-handshake.test.ts`: the predicate matches the error the SDK's own `ws` emits when a connecting socket is terminated, so a `ws` wording change fails the test. Other errors don't match.

## Verification

- Repro: a standalone `ws` socket stripped of listeners and terminated mid-handshake exits with code 1. With the guard installed, the same repro prints `swallowed` and keeps running.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` (406 passing).

## Architecture impact

None.

## Links

- Related: [2026-11-10-worker-restart-zombies](2026-11-10-worker-restart-zombies.md)
- Commits: branch `fix/ws-handshake-timeout-crash`
- CHANGELOG: `[Unreleased]` entry

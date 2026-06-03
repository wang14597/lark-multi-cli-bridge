---
date: 2026-06-03
type: fix
slug: ws-ping-timeout-watchdog
---

# Arm the WS liveness watchdog so dead connections reconnect instead of going silently offline

**Type:** fix

## Motivation

Card buttons rendered by a bot intermittently failed with Lark's client-side
error **"目标回调服务当前未在线"** (target callback service currently
offline), even though the worker process was alive and had successfully
received a `card.action.trigger` callback minutes earlier. Restarting the
supervisor "fixed" it every time.

Root cause (traced via worker logs + session transcript on 2026-06-03,
14:06–14:18): the worker's Lark WebSocket died **server-side** during an
idle window (NAT/proxy idle reclaim or a network flap), leaving the client
with a half-open TCP socket. `@larksuiteoapi/node-sdk` ships a pong-liveness
watchdog (SDK ≥ 1.65 knob), but it is **opt-in**: `armLiveness()` is a no-op
unless `wsConfig.pingTimeout` is passed to the `WSClient` constructor.
`LarkWsClient` did not pass it, so:

- `readyState` stayed `OPEN`; the ping loop kept writing into the void.
- No `close`/`error` event ever fired → the SDK's auto-reconnect never ran.
- Lark's side saw zero online connections for the app → every card click
  was rejected with "目标回调服务当前未在线", and inbound messages were
  silently dropped too.

The predecessor project (`lark-channel-bridge`) passes
`wsConfig: { pingTimeout: 3 }` for exactly this reason; the knob was lost
when `ws.ts` was ported here.

## What changed

`LarkWsClient.start()` now constructs `Lark.WSClient` with three additional
options:

- `wsConfig: { pingTimeout: 3 }` — arms the SDK's pong watchdog: if no
  inbound frame arrives within 3 s of a ping, the SDK terminates the socket,
  which triggers its auto-reconnect path. This is the actual fix.
- `handshakeTimeoutMs: 8000` — fast-fail handshakes (SDK default 15 s) so
  reconnect loops recover quickly on unstable networks.
- `onReconnecting` / `onReconnected` — logged at **warn** level through
  `opts.logger`, so the next connection drop is visible in the worker log
  instead of being completely silent (the silence is what made this bug
  expensive to diagnose).

## Files touched

- `src/lark/ws.ts` — pass `wsConfig.pingTimeout`, `handshakeTimeoutMs`, and
  the two reconnect hooks to the `WSClient` constructor, with a comment
  explaining the half-open-socket failure mode.
- `tests/lark/ws.test.ts` — new test file (TDD, red first): mocks
  `@larksuiteoapi/node-sdk`, captures the `WSClient` constructor params, and
  asserts the watchdog config, the handshake timeout, the warn-level
  reconnect logging, and that the hooks are safe without a logger.

## Verification

- `tests/lark/ws.test.ts` written first and observed failing (3 of 4 tests
  red: `pingTimeout`/`handshakeTimeoutMs`/hooks all `undefined`), then green
  after the fix.
- `pnpm typecheck` — pass.
- `pnpm test` — 38 files, 232 tests, all pass.
- `pnpm lint` — the two files touched by this change are clean. The repo-wide
  run reports 31 pre-existing errors that also fail on `main` (out of scope).
- Field evidence for the diagnosis: claude-bot worker log 2026-06-03 shows a
  callback delivered at 14:10:47, the failing card sent 14:14:46, zero
  `card action` entries until the 14:18:48 restart, then a callback delivered
  again at 14:21:19 over the fresh connection.

## Architecture impact

Updated `docs/architecture.md` + `docs/architecture.zh.md` (§Process
topology, worker WS paragraph): documented that the per-worker WebSocket runs
with a 3 s pong-liveness watchdog and warn-level reconnect logging.

## Links

- Spec: `—`
- Plan: `—`
- Commits: see branch `worktree-fix-ws-ping-timeout`
- CHANGELOG: `[Unreleased]` → Fixed

---
date: 2026-06-03
type: refactor
slug: base-sdk-options
---

# Extract baseSdkOptions to de-duplicate Lark SDK construction

**Type:** refactor

## Motivation

`createLarkClient` (`src/lark/client.ts`) and the `Lark.WSClient`
construction in `LarkWsClient.start()` (`src/lark/ws.ts`) carried identical
copies of the same three SDK options:

```ts
domain: opts.domain === 'feishu' ? Lark.Domain.Feishu : Lark.Domain.Lark,
loggerLevel: Lark.LoggerLevel.warn,
...(opts.logger ? { logger: opts.logger } : {}),
```

Surfaced during PR review (the WS-watchdog PR). A future change to any
shared knob — a logger-level bump, a new common option — would have to be
made in two places and could drift. Behavior-preserving cleanup.

## What changed

New `src/lark/sdk-options.ts` exports `baseSdkOptions(opts)` returning the
shared `{ domain, loggerLevel, logger? }` triple. Both `createLarkClient`
and `LarkWsClient.start()` now spread `...baseSdkOptions(opts)` and add only
their own `appId`/`appSecret` and transport-specific options (the WSClient
keeps its `wsConfig.pingTimeout` / `handshakeTimeoutMs` / reconnect hooks).
No behavior change.

## Files touched

- `src/lark/sdk-options.ts` — new: `baseSdkOptions` + `BaseSdkOpts` type.
- `src/lark/client.ts` — import and spread `baseSdkOptions`; the local
  `domain`/`loggerLevel`/logger lines removed.
- `src/lark/ws.ts` — same spread; watchdog/reconnect options unchanged.
- `tests/lark/sdk-options.test.ts` — new (TDD, red first): domain mapping
  (feishu → Feishu, lark/default → Lark), loggerLevel always warn, logger
  included only when provided.

## Verification

- `tests/lark/sdk-options.test.ts` written first, failed (module missing),
  green after implementation.
- `pnpm typecheck` — pass. `pnpm test` — 40 files / 243 tests pass.
- `pnpm lint` — touched files clean.
- Behavior preserved: existing client/ws tests (which mock the SDK and
  assert constructor params) still pass unchanged.

## Architecture impact

None. `docs/architecture.md` describes `lark/` as the "Lark SDK wrapper"
without enumerating individual files; adding one small internal helper
module does not change module responsibilities, topology, the event
contract, IPC, or on-disk state.

## Links

- Spec: `—`
- Plan: `—`
- Commits: see branch `worktree-fix-ws-ping-timeout`
- CHANGELOG: `[Unreleased]` → Changed

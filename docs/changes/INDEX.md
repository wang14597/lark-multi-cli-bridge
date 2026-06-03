# Change Index

Reverse-chronological index of every tracked change (newest first). One
row per change doc. See [`CLAUDE.md`](../../CLAUDE.md) for the convention.

中文版: [INDEX.zh.md](INDEX.zh.md)

| Date | Type | Change | Summary |
|------|------|--------|---------|
| 2026-06-03 | fix | [fix-daemon-supervisor-path](2026-06-03-fix-daemon-supervisor-path.md) | Background `lmcb start` spawned the supervisor from a path computed against the source layout; in the tsup-flattened `dist/` it pointed outside the build and died silently. Fix path, add pre-spawn existence guard + regression tests. |
| 2026-06-03 | refactor | [base-sdk-options](2026-06-03-base-sdk-options.md) | Extract `baseSdkOptions` so `createLarkClient` and `LarkWsClient` share one copy of the domain/loggerLevel/logger SDK construction triple instead of duplicating it. |
| 2026-06-03 | fix | [profile-provision-verify](2026-06-03-profile-provision-verify.md) | `ensureLarkProfile` re-lists after `profile add` and fails loudly if the profile didn't land (concurrent config write / diverging `LARK_CHANNEL` config home), instead of logging "provisioned" over a lost write. |
| 2026-06-03 | fix | [bot-self-open-id-resolution](2026-06-03-bot-self-open-id-resolution.md) | `fetchBotSelfOpenId` now uses the authenticated `client.request` (raw `httpInstance` could never work) and `fetchAppOwnerOpenId` sends the mandatory `lang` param — group @-mention stripping and app-owner access fallback actually resolve now. |
| 2026-06-03 | fix | [ws-ping-timeout-watchdog](2026-06-03-ws-ping-timeout-watchdog.md) | Arm the SDK's WS pong watchdog (`wsConfig.pingTimeout: 3`) + warn-level reconnect logs; half-open connections now reconnect instead of leaving card buttons dead with "目标回调服务当前未在线". |
| 2026-06-02 | docs | [introduce-change-tracking](2026-06-02-introduce-change-tracking.md) | Establish the per-change documentation convention + `CLAUDE.md`; refresh `architecture.md` version marker to v0.7.1. |

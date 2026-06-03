# Change Index

Reverse-chronological index of every tracked change (newest first). One
row per change doc. See [`CLAUDE.md`](../../CLAUDE.md) for the convention.

中文版: [INDEX.zh.md](INDEX.zh.md)

| Date | Type | Change | Summary |
|------|------|--------|---------|
| 2026-06-03 | fix | [ws-ping-timeout-watchdog](2026-06-03-ws-ping-timeout-watchdog.md) | Arm the SDK's WS pong watchdog (`wsConfig.pingTimeout: 3`) + warn-level reconnect logs; half-open connections now reconnect instead of leaving card buttons dead with "目标回调服务当前未在线". |
| 2026-06-02 | docs | [introduce-change-tracking](2026-06-02-introduce-change-tracking.md) | Establish the per-change documentation convention + `CLAUDE.md`; refresh `architecture.md` version marker to v0.7.1. |

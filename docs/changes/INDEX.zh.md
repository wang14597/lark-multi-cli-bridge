# 变更索引

按时间倒序排列的全部受追踪变更(最新在上),每个变更文档一行。约定见
[`CLAUDE.md`](../../CLAUDE.md)。

English: [INDEX.md](INDEX.md)

| 日期 | 类型 | 变更 | 摘要 |
|------|------|------|------|
| 2026-06-03 | fix | [ws-ping-timeout-watchdog](2026-06-03-ws-ping-timeout-watchdog.zh.md) | 启用 SDK 的 WS pong 看门狗（`wsConfig.pingTimeout: 3`）+ warn 级重连日志；半开连接现在会自动重连，卡片按钮不再死于"目标回调服务当前未在线"。 |
| 2026-06-02 | docs | [introduce-change-tracking](2026-06-02-introduce-change-tracking.zh.md) | 建立"每次变更随附文档"的约定 + `CLAUDE.md`;把 `architecture.md` 版本标注刷新到 v0.7.1。 |

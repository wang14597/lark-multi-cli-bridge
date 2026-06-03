---
date: 2026-06-03
type: fix
slug: ws-ping-timeout-watchdog
---

# 启用 WS 存活看门狗：死连接自动重连，不再静默离线

**类型:** fix

## Motivation / 动机

bot 发出的卡片按钮间歇性点击失败，飞书客户端报 **"目标回调服务当前未在
线"**——但 worker 进程明明活着，几分钟前还成功收到过一次
`card.action.trigger` 回调。每次重启 supervisor 都能"修好"。

根因（2026-06-03 14:06–14:18 的 worker 日志 + 会话 transcript 取证）：
worker 的 Lark WebSocket 在一段空闲窗口内**服务端侧**断开了（NAT/代理空闲
回收或网络抖动），客户端只剩一个半开的 TCP socket。
`@larksuiteoapi/node-sdk` 自带 pong 存活看门狗（SDK ≥ 1.65 的开关），但它
是 **opt-in** 的：不给 `WSClient` 构造器传 `wsConfig.pingTimeout`，
`armLiveness()` 就是空操作。`LarkWsClient` 没传，于是：

- `readyState` 一直是 `OPEN`，ping 循环把 ping 发进黑洞；
- `close`/`error` 事件永不触发 → SDK 自动重连永不启动；
- 飞书侧看到该 app 没有任何在线连接 → 卡片点击全部报"目标回调服务当前
  未在线"，入站消息也被静默丢弃。

前身项目 `lark-channel-bridge` 正是为治这个病才传了
`wsConfig: { pingTimeout: 3 }`；移植 `ws.ts` 时这个参数被落下了。

## What changed / 改了什么

`LarkWsClient.start()` 构造 `Lark.WSClient` 时新增三项配置：

- `wsConfig: { pingTimeout: 3 }` —— 启用 SDK 的 pong 看门狗：发出 ping 后
  3 秒内没有任何入站帧，SDK 就 terminate socket，从而触发其自动重连。这
  是真正的修复。
- `handshakeTimeoutMs: 8000` —— 握手快速失败（SDK 默认 15 秒），不稳定网
  络下重连循环恢复更快。
- `onReconnecting` / `onReconnected` —— 经 `opts.logger` 以 **warn** 级别
  打日志，下次掉线在 worker 日志里可见，不再完全静默（正是这种静默让本
  bug 难以排查）。

## Files touched / 涉及文件

- `src/lark/ws.ts` —— `WSClient` 构造器补传 `wsConfig.pingTimeout`、
  `handshakeTimeoutMs` 和两个重连钩子，并附注释说明半开 socket 的故障模式。
- `tests/lark/ws.test.ts` —— 新增测试文件（TDD，先红后绿）：mock
  `@larksuiteoapi/node-sdk`，捕获 `WSClient` 构造参数，断言看门狗配置、握
  手超时、warn 级重连日志，以及无 logger 时钩子不抛错。

## Verification / 验证

- `tests/lark/ws.test.ts` 先写先跑红（4 个用例中 3 个红：
  `pingTimeout`/`handshakeTimeoutMs`/钩子均为 `undefined`），修复后全绿。
- `pnpm typecheck` —— 通过。
- `pnpm test` —— 38 个文件、232 个用例全部通过。
- `pnpm lint` —— 本次改动的两个文件零问题；仓库级跑出的 31 个 error 在
  `main` 上同样存在（既有问题，不在本次范围）。
- 诊断的现场证据：claude-bot worker 日志显示 14:10:47 回调成功送达，
  14:14:46 发出问题卡片，此后到 14:18:48 重启前零条 `card action` 记录，
  重启后 14:21:19 的回调在新连接上再次正常送达。

## Architecture impact / 架构影响

已更新 `docs/architecture.md` + `docs/architecture.zh.md`（§进程拓扑，
worker WS 段落）：注明每个 worker 的 WebSocket 带 3 秒 pong 存活看门狗，
重连事件以 warn 级别记录。

## Links / 链接

- Spec: `—`
- Plan: `—`
- Commits: 见分支 `worktree-fix-ws-ping-timeout`
- CHANGELOG: `[未发布]` → 修复

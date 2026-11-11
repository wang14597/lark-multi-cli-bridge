---
date: 2026-11-11
type: fix
slug: ws-handshake-timeout-crash
---

# 网络短暂波动不再导致所有 bot 被禁用

**类型:** fix

## 动机

2026-11-11 10:02 左右网络短暂不稳，之后 3 个 bot 全部变成 `disabled`，不再回复消息。每个 worker 都记录了 `[ws] handshake timeout after 8000ms`，然后以 exit code 1 退出。supervisor 把它们重启，又以同样的方式失败；3 分钟内崩溃满 5 次后，崩溃预算把它们禁用了。被禁用的 bot 会一直停着，直到有人手动重启。

## 改动内容

崩溃来自飞书 SDK（`@larksuiteoapi/node-sdk`）的握手超时处理。超时后，SDK 先调用 `wsInstance.removeAllListeners()`，再调用 `wsInstance.terminate()`。对一个还在连接中的 socket 执行 terminate，`ws` 会抛出 `WebSocket was closed before the connection was established`。可是处理这个错误的监听刚被移除，错误没人接，于是变成未捕获异常，把进程带崩了。而 SDK 其实已经把这次连接记为失败，本来会自己重试。用单独的 `ws` 脚本复现，结果相同：同样的报错，exit code 1。

- `src/lark/ws.ts`：新增 `isAbortedHandshakeError(err)`，只识别这一种错误。
- `src/worker/index.ts`：新增 `process.on('uncaughtException')` 处理。遇到这个错误时记一条 warn，worker 继续运行，SDK 自己的重试接着进行；其他未捕获异常仍记为 fatal 并以 1 退出，和以前一样。

在修复重启问题（[2026-11-10-worker-restart-zombies](2026-11-10-worker-restart-zombies.zh.md)）之前，遗留的僵尸 worker 一直保持着飞书连接，这个崩溃大概因此没被发现。现在每个 bot 只有一个 worker，这一个崩溃就足以让 bot 下线。

2026-11-11 10:07，网络恢复后，已手动重新启用这 3 个 bot。

## 涉及文件

- `src/lark/ws.ts`：`isAbortedHandshakeError`。
- `src/worker/index.ts`：未捕获异常的处理。
- `tests/lark/ws-handshake.test.ts`：用 SDK 自己依赖的那个 `ws`，在连接中途 terminate，验证判断函数能认出实际抛出的错误；`ws` 的报错文字一改，测试就会失败。其他错误不会被误认。

## 验证

- 复现：一个移除了监听的 `ws` socket，在握手中途被 terminate，进程以 exit code 1 退出。装上这个处理后，同样的复现打印 `swallowed`，进程继续运行。
- `pnpm typecheck`、`pnpm lint`、`pnpm test` 全部通过（406 个测试）。

## 架构影响

无。

## 链接

- 相关：[2026-11-10-worker-restart-zombies](2026-11-10-worker-restart-zombies.zh.md)
- 提交：分支 `fix/ws-handshake-timeout-crash`
- CHANGELOG：`[Unreleased]` 条目

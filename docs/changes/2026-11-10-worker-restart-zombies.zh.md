---
date: 2026-11-10
type: fix
slug: worker-restart-zombies
---

# 重启 bot 不再遗留还在运行的旧 worker

**类型:** fix

## 动机

修完 codex 串台之后，有个群里仍然同时出现两个 claude-bot 会话在做同一件事，其中一个还说消息"转到了另一个会话"。原因不在会话代码，而是同一个 supervisor 下有 **6 个 worker 进程，但只有 3 个 bot**：

- codex-bot 多出 2 个，其中最老的从 11/9 起就在跑，用的还是修复前的代码；
- claude-bot 多出 1 个。

每个多出来的 worker 都保持着自己的 Lark WebSocket 连接。同一个应用有多条连接时，Lark 把每条事件只发给其中一条，所以同一个群的连续消息会落到不同的 worker 上。这些 worker 各有各的调度队列和内存里的会话缓存，却都写同一个 per-bot 会话文件，结果就是同一个群里并发运行、会话分叉。`ps` 显示每个 bot 重启了 11 到 12 次。

## 改动内容

`WorkerManager`（`src/supervisor/worker-manager.ts`）：

- `restart()` 原来给旧 worker 发 SIGTERM 后**立刻** fork 新的，现在会先等旧的退出。新增的 `terminate()` 先发 SIGTERM，超过 `killTimeoutMs`（默认 10 秒）还没退出就 SIGKILL。
- `stop()` 也改用 `terminate()`，并等待所有 worker 退出。
- 退出回调会忽略已经不是当前槽位的子进程。原来被替换的旧 worker 晚些退出时，会清掉**新** worker 的引用；退出码不为 0 时还会**再 fork 一个 worker**。多余的 worker 就是这样越积越多的，这也是手动结束多余 worker 后，健康的 bot 被标成 `stopped` 的原因。

Worker（`src/worker/index.ts`、`src/worker/dispatcher.ts`）：

- 新增 `Dispatcher.abortAll()`：清空排队中的任务，中止所有正在运行的会话（通过中止信号结束它的 CLI），并等待这些运行收尾。
- 收到 SIGTERM 时，worker 先 `abortAll()`，再 `ws.stop()`，并设了 5 秒后强制 `process.exit`。WebSocket 关闭卡住，也不会再让被替换的 worker 一直活着；重启时正在运行的 CLI 也不会再变成孤儿进程。

同时做的运维操作（不是代码改动）：2026-11-10 手动结束了 3 个多余的 worker，它们当时都没有正在运行的任务。

## 涉及文件

- `src/supervisor/worker-manager.ts`：`terminate()`、restart/stop 改为等待退出、忽略过期的退出事件、新增 `killTimeoutMs` 选项。
- `src/worker/dispatcher.ts`：`abortAll()`。
- `src/worker/index.ts`：关闭时中止运行，且不会卡住。
- `tests/supervisor/worker-manager.test.ts`、`tests/supervisor/__fixtures__/stubborn-worker.cjs`：模拟一个忽略 SIGTERM 的 worker。`restart()` 之后，旧的已经结束，新的被跟踪且状态为 `ready`，并且只有一个 worker 存活。
- `tests/worker/dispatcher.test.ts`：`abortAll()` 会中断所有正在运行的会话；空闲时不做任何事。

## 验证

- RED：重启测试在旧代码上失败（旧 worker 仍然存活）；`abortAll` 的测试在实现前失败。
- GREEN：`pnpm typecheck`、`pnpm lint`、`pnpm test` 全部通过（404 个测试）。

## 架构影响

更新了 `docs/architecture.md` / `.zh.md` 的崩溃恢复部分（重启 / 停止的行为），以及版本说明。

## 链接

- 相关：[2026-11-09-codex-session-crosstalk](2026-11-09-codex-session-crosstalk.zh.md)
- 提交：分支 `fix/codex-session-crosstalk`
- CHANGELOG：`[Unreleased]` 条目

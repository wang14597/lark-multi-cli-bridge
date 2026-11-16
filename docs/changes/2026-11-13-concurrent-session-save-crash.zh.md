---
date: 2026-11-13
type: fix
slug: concurrent-session-save-crash
---

# 两个群同时开工不再导致 worker 崩溃

**类型:** fix

## 动机

两个新群先后相隔 1 秒（16:23:35 和 16:23:36）给 gemini-bot 派了任务。3 秒后，gemini-bot 的 worker 记录了 `uncaught exception` 并退出，两个任务一起中断。两张卡片从此一直停在"正在思考"，用户也没有看到任何报错。

## 改动内容

报错是 `ENOENT: rename '…/gemini-bot.json.tmp.<pid>.<毫秒>' -> '…/gemini-bot.json'`，原因有两层：

- **临时文件重名。** `writeJsonAtomic` 的临时文件名是 `<路径>.tmp.<pid>.<Date.now()>`。两个任务在同一毫秒保存会话时，两次写入用的是同一个临时文件：第一次 `rename` 把它移走了，第二次就找不到文件了。
- **错误没人处理。** `onSessionUpdate` 调用的是 `void sessions.upsert(...)`，这个 promise 的失败没人处理，结果整个 worker 都崩了。

修复分三处：

- `src/util/atomic-file.ts`：临时文件名改用 `randomUUID()`，不再用毫秒时间戳。
- `src/session/store.ts`：`persist()` 把写入串起来，一次只写一个。这样旧的快照不会晚于新的落盘、把新的覆盖掉。以前并发保存时，某个群最新的会话 ID 可能悄悄丢失。
- `src/worker/index.ts`：`onSessionUpdate` 捕获保存失败，记一条 `saving session failed`，不再让 worker 崩溃。

这个 bug 一直存在，只要能并发运行就可能触发。最近多个群同时开工，它才显现出来。

## 涉及文件

- `src/util/atomic-file.ts`、`src/session/store.ts`、`src/worker/index.ts`：见上文。
- `tests/util/atomic-file.test.ts`：对同一个文件并发写 20 次，全部成功，且不留下临时文件。
- `tests/session/store.test.ts`：10 个群同时保存会话，重新加载后全部都在。

## 验证

- RED：两个新测试在旧代码上都失败。写文件的测试报的是同样的 ENOENT，会话存储的测试丢了一部分群。
- GREEN：`pnpm typecheck`、`pnpm lint`、`pnpm test` 全部通过（408 个测试）。

## 架构影响

无。

## 链接

- 提交：分支 `fix/ws-handshake-timeout-crash`
- CHANGELOG：`[Unreleased]` 条目

---
date: 2026-11-09
type: fix
slug: codex-session-crosstalk
---

# Codex 各会话不再接到别人的 session 上

**类型:** fix

## 动机

九个工作群同时使用 codex-bot 时，各群的对话串到了一起。`state/sessions/codex-bot.json` 里有 8 个会话指向同一个 codex thread `01a1be65-…`，它的会话记录里混着 6 个不同群的消息。

## 改动内容

codex 的 `turn.completed` 不带 thread id。为了补上，`parseCodexJsonLine` 把最近一次 `thread.started` 的 id 存在模块级变量 `lastThreadId` 里，再填进 `turn.completed` 对应的 `done` 事件。问题在于，codex-bot worker 里所有会话共用这一个变量：

1. 多个运行重叠时，会话 A 的 `done` 带上了会话 B 的 thread id。
2. `run()` 优先采用这个值（`ev.sessionId || sessionId`）。
3. `onSessionUpdate` 于是把 B 的 thread 存到了 A 名下。
4. A 的下一条消息执行 `codex exec resume`，接着的是 B 的对话。

现在解析器不再保存状态：`turn.completed` 产出 `sessionId: ''`，由 `run()` 填入自己那次 `thread.started` 报告的 thread id。Claude 和 Gemini 已检查，不受影响：两者都没有模块级状态，也没有共用的 session id。

已经被串过的会话记录，这次改动不负责修复。

## 涉及文件

- `src/adapters/codex.ts`：删除模块级的 `lastThreadId`；`turn.completed` 对应的 `done` 事件，session id 留空。
- `tests/adapters/codex.test.ts`：解析器的测试不再期望 `done` 带 thread id。新增三个测试：
  - 别的流的 `thread.started` 不会漏进 `turn.completed`；
  - `run()` 产出的 `done` 带的是自己的 thread id；
  - 两个并发运行各自保留自己的 id。

## 验证

- RED：在旧代码上，两个解析器测试失败。
- GREEN：`pnpm typecheck`、`pnpm lint`、`pnpm test` 全部通过（401 个测试）。

## 架构影响

无。

## 链接

- Spec：—
- Plan：—
- 提交：分支 `fix/codex-session-crosstalk`
- CHANGELOG：`[Unreleased]` 条目

---
date: 2026-06-05
type: fix
slug: card-action-command-routing
---

# 卡片按钮（new / status / help / ws.*）现在真的会执行

**类型:** fix

## Motivation / 动机

bridge 在 `command-cards.ts` 里渲染的每个交互卡片按钮（`/help`、
`/status`、`/ws list` 卡）都带着 `value.cmd`，如 `new`、`status`、`help`、
`ws.list`、`ws.use`、`ws.remove`。但 `makeCardActionHandler` 只实现了
`cmd === 'stop'`，其余 `cmd` 全部落到 `default → log('unknown card action')`
什么都不做。点击 🆕 新会话 / 📊 状态 / 📂 工作空间 / 💡 帮助 / 切换 /
删除 都是死的空操作——尽管注释写着 "internal slash-command buttons
(preserved)"，实际只有运行中卡的 ⏹ 停止按钮能用。用户直接反馈了这个问题。

## What changed / 改了什么

卡片动作 handler 现在把内部命令按钮走**与键入 `/command` 完全相同的
`CommandRouter`**，让「点按钮」和「键入命令」共用一份实现：

- 新增导出的纯函数 `cmdToSlash(cmd, value)`：把按钮 `cmd` 翻译成 slash
  文本——`new → /new`、`status → /status`、`help → /help`、
  `ws.list → /ws list`、`ws.use → /ws use <value.name>`、
  `ws.remove → /ws remove <value.name>`。对 `stop`（内联处理）、未知 cmd、
  以及缺少字符串 `name` 的 `ws.*` 返回 `undefined`。
- handler 新增可选 dep `dispatchCommand(slashText, {chatId, operatorOpenId})`。
  优先级现为：(1) `__claude_cb` LLM 回调，(2) 内联 `stop` 中断，
  (3) `cmdToSlash` + `dispatchCommand`，(4) 记日志空操作。`dispatchCommand`
  抛错会被 catch 并记日志。
- `worker/index.ts` 基于已有的 `router` + `sessions`/`workspaces`/`bot`
  构造 `dispatchCommand`，按点击者 `open_id` 重算 admin 身份，`reply`/
  `replyCard` 指向点击所在 chat。per-chat 回复闭包抽成共享的
  `makeReplies(chatId)`，消息路径和卡片按钮路径共用。

## Files touched / 涉及文件

- `src/worker/card-action-handler.ts` —— 新增 `cmdToSlash`、`dispatchCommand`
  dep 与优先级 3 路由分支；替换只认 stop 的 switch。
- `src/worker/index.ts` —— 抽出 `makeReplies(chatId)`；构造并传入
  `dispatchCommand`；入站消息 handler 复用 `makeReplies`。
- `tests/worker/card-action-handler.test.ts` —— 新增 `cmdToSlash` 单测与
  「内部命令路由」用例（new/ws.use/未知/未接线/抛错）。

## Verification / 验证

- `pnpm typecheck` ✅
- `pnpm lint` ✅
- `pnpm test` ✅ —— 273 个测试通过（原 256）。新覆盖断言：`cmd:new` 点击
  下发 `/new`、`ws.use` 透传 `value.name`、未知 cmd 不下发、未接线时安全
  空操作、`dispatchCommand` 抛错被吞掉。

## Architecture impact / 架构影响

已更新 `docs/architecture.md` 和 `docs/architecture.zh.md`
（§"Adapter event stream" / "适配器事件流"）：把「点击路由到
`dispatcher.abort`」那句换成三优先级的卡片动作契约（LLM 回调 / 停止 /
内部命令路由）。

## Links / 链接

- Spec: `—`
- Plan: `—`
- Commits: `<pending>`
- CHANGELOG: `[Unreleased]` → Fixed

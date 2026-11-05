---
date: 2026-11-05
type: feat
slug: conclusion-mode
---

# 结论模式：`/mode final` 只推送一条结论，而不是流式卡片

**类型：** feat

## 动机

对耗时较长的任务，流式卡片很吵，而且结束时不会推送通知。用户希望把任务交出去，
最后只收到一条带结果的消息。另外，Codex 卡片从不显示工具调用（适配器丢弃了所有非
`agent_message` 条目），连续的 agent 消息还被粘在一起。

## 改动内容

- **`/mode stream|final`** 按 (会话, bot) 保存 `ChatSession.outputMode`。`/new`、
  `/cd` 不会清掉，非管理员专用，默认 `stream`。
- **final 模式**（`ConclusionStreamer`，每次运行由 `resolveOutputMode` 选择）：先发
  带停止按钮的「处理中…」状态卡；`done` 时**新发**一条结论消息（飞书会推送，群里
  `@` 发送者），再撤回状态卡（`LarkCardSink.recall` → `im.message.delete`）。出错 /
  `is_error` → 「⚠️ 没办成：…」；用户停止 → 卡片改为「已停止」。兜底：创建失败 →
  结论改写进状态卡；撤回失败 → 卡片改为「已完成」；为空 → 「已完成，但没有返回结论」；
  绝不展示原始 JSON。streamer 以第一个终止事件为准。
- **结论来源**（`RunContext.conclusion` → `done.conclusion`）：Claude `--json-schema`
  → `structured_output.conclusion`；Codex `--output-schema <临时文件>` → 最后一条
  `agent_message` 的 JSON（文件为 `$TMPDIR/lmcb-conclusion-schema-<pid>.json`，按进程命名，
  每次运行前若被系统清理则重建）；Gemini prompt 提示 → 最后一次工具调用之后的文本。2026-11-05
  在 claude 2.1.283 / codex-cli 0.162.1 上验证：之后不带 schema 续接的轮次回答正常。
- **Claude `is_error` 发现：** 无效的 `--resume` 会返回 `is_error: true`、
  `subtype: error_during_execution` 的 result 行，信息在 `errors[]`（没有 `result`），
  退出码 1。适配器现在用 `errors[]` 设置 `finalText` 并置 `done.isError`；
  `done{isError}` 与 `error` 事件可能同时出现。
- **评审加固：** final 模式下流结束时既无 `done` 也无 `error`，现在显示
  「⚠️ 没办成：运行结束但没有返回结果」，不再卡在「处理中…」；结论卡正文上限 8000 字符；
  `is_error` 结果的 `finalText` 若是原始 JSON 则显示「未知错误」；Codex 在未渲染的
  `reasoning` 条目前后的消息保持分段。
- **Claude stream 模式的附带变化：** `is_error` 结果的 `result` 为空时，`finalText`
  现取自 `errors[]`，stream 卡片因此显示真实错误文本。
- **Codex 修复（stream 模式同样受益）：** `command_execution` → `tool-call` /
  `tool-result`，`reasoning` → `thinking`（不渲染），消息分段，`finalText` 取最后一条。
  `scripts/record-cli-fixture.sh` 现在关闭 stdin（`codex exec` 会卡着等输入）。

## 已知限制

- worker 中群聊/单聊的 @ 分支没有单元测试。
- Gemini 的结论为尽力而为（仅 prompt 提示，无 schema 支持）。

## 涉及文件

- `src/adapters/conclusion.ts` — 共用 schema + 解析；`types.ts` — `RunContext.conclusion`、`done.conclusion` / `done.isError`。
- `src/adapters/claude.ts` / `codex.ts` / `gemini.ts` — 各 CLI 的结论提取；codex 工具调用/消息映射。
- `src/commands/handlers/mode.ts` — `/mode`；`src/session/{types,store}.ts` — `outputMode`。
- `src/worker/conclusion-streamer.ts`、`src/lark/conclusion-card.ts` — 新 streamer 与卡片；`lark-sink.ts` — `recall`；`card-streamer.ts`、`card-builder.ts`、`dispatcher.ts`、`index.ts` — 模式路由。
- `scripts/record-cli-fixture.sh` — 关闭 stdin；`tests/adapters/__fixtures__/` 下新增 fixture；以上各项的测试。
- 文档：本变更文档（+ `.zh.md`）、INDEX、CHANGELOG、`architecture`。

## 验证

`pnpm typecheck`、`pnpm lint`、`pnpm test` 通过。fixture 取自真实 CLI 输出
（claude `structured-output.jsonl`，codex `json-schema.jsonl` / `json-tools.jsonl`）。
在运行中的 bot 上做实机检查属于后续手工步骤。

## 架构影响

已更新 `docs/architecture.md` / `.zh.md`：适配器事件契约（`done` 字段、结论提取）、
worker 渲染路径（两种 streamer）、落盘状态（`outputMode`）、命令数 12 → 13、版本标记。

## 链接

- Spec：`docs/superpowers/specs/2026-11-05-conclusion-mode-design.md`
- Plan：`docs/superpowers/plans/2026-11-05-conclusion-mode.md`
- 提交：`95af287..f2f95f8` 加评审修复提交 `fix: harden conclusion mode per final review`（分支 `feat/conclusion-mode`）
- CHANGELOG：`[Unreleased]` → 新增、修复

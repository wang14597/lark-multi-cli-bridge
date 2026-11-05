---
date: 2026-11-05
type: feat
slug: final-mode-text-reply
---

# `/mode final` 改为回复普通消息，不再用卡片

**类型：** feat

## 动机

对比另一个团队「直接回一条普通消息」的 bot 后，用户决定 `/mode final` 不再使用任何卡片。
[conclusion-mode](2026-11-05-conclusion-mode.zh.md) 里的原地改卡片也不会触发飞书推送通知
（只有新消息才会）；改成新回复消息后，手机推送又回来了。

## 改动内容

- **final 模式不再有卡片。** 运行期间，bot 给用户那条消息加一个 `OnIt` 表情回应
  （`im.v1.message.reaction` 的 create/delete；已实测 `emoji_type: OnIt` 可用）。运行结束时
  对该消息发**一条** `post`（富文本）引用回复：群聊里先是一个 `at` 段落，再是一个只含结论的
  `md` 段落（上限 8000 字符），然后移除表情回应。
- **出错** → 回复「⚠️ 没办成：…」。**`/stop`** → 只移除表情回应（`/stop` 命令本身会回复
  「aborted current run」）。没有用户消息的合成运行（卡片点击）不加表情，结论作为顶层 post 发出。
- **失败绝不抛错：** 加表情 / 发送 / 取消表情失败只记日志；发送失败后仍会清掉表情。
- **用户接受的取舍：** 没有停止按钮（用 `/stop`），运行中看不到进度（只有表情）。
- **代码：** `src/lark/conclusion-card.ts` → `src/lark/conclusion-post.ts`
  （`renderConclusionPost`）；`lark-sink.ts` 新增 `ReplySink` 接口与 `LarkReplySink`；
  `ConclusionStreamer` 改为接收 `ReplySink`（不再用 `CardSink`）；`card-builder.ts` 的
  `stopButton` 恢复为私有；worker 在 final 模式构造 `LarkReplySink`，stream 模式构造 `LarkCardSink`。

- **不再限制结论的长度和形式（用户决定）。** `CONCLUSION_GUIDANCE`（`src/adapters/conclusion.ts`）原来把结论限制在 1–5 句话；试用中让 bot 按点列出时，它把 24 条压成了一段话。用户不希望有任何长度或形式要求，现在只保留：结论就是模型平时会给出的完整回答，保留 Markdown 排版（标题、列表、换行），能独立阅读。

## 涉及文件

- `src/lark/conclusion-post.ts` — 新增：`renderConclusionPost`，取代已删除的 `conclusion-card.ts`。
- `src/worker/lark-sink.ts` — `ReplySink` + `LarkReplySink`（react / unreact / sendPost）。
- `src/worker/conclusion-streamer.ts` — 表情 + 单条 post 的流程，接收 `ReplySink`。
- `src/worker/index.ts` — final 用 `LarkReplySink`，stream 用 `LarkCardSink`。
- `src/lark/card-builder.ts` — `stopButton` 不再导出。
- `tests/lark/conclusion-post.test.ts`（新增，取代 `conclusion-card.test.ts`）、`tests/worker/conclusion-streamer.test.ts`、`tests/worker/lark-sink.test.ts`。
- 文档：本变更文档（+ `.zh.md`）、INDEX、CHANGELOG、`architecture`。

## 验证

`pnpm typecheck`、`pnpm lint` 通过；`pnpm test` 396 个通过。`OnIt` 表情的创建/删除已对飞书
API 实测。在运行中的 bot 上完整走一遍 `/mode final` 属于后续手工步骤。

## 架构影响

已更新 `docs/architecture.md` / `.zh.md`（适配器事件契约 / worker 渲染路径、`lark/` 与
`worker/` 模块行、版本标记）：final 模式的 streamer 现为「表情回应 + 一条 `post` 回复」。

## 链接

- 规格：—
- 计划：—
- 前一变更：[2026-11-05-conclusion-mode](2026-11-05-conclusion-mode.zh.md)
- 提交：分支 `feat/final-mode-text-reply`
- CHANGELOG：`[未发布]` → 变更

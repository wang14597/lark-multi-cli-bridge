---
date: 2026-06-05
type: fix
slug: card-action-routing-hardening
---

# 卡片命令路由加固：结构化参数 + 可见的失败

**类型：** fix

## 动机

刚落地的卡片命令路由
（[card-action-command-routing](2026-06-05-card-action-command-routing.zh.md)）
经代码审查暴露出两个后续缺陷：

1. **工作空间名往返丢失结构。** `cmdToSlash` 把结构化的按钮 payload
   （`value.name`）重新序列化成 slash 字符串（`/ws use ${name}`），router
   再按 `\s+` 切词、`wsHandler` 只取第二个 token，于是从 `/ws list` 卡片点
   击一个含空白/换行的工作空间名（如 `foo bar`）会被解析成截断前缀
   （`foo`）——若 `foo` 与 `foo bar` 同时存在就会命中错误目标。卡片显示的
   是完整名（已转义），即「所见 ≠ 所点」。
2. **点击失败被静默吞掉。** 卡片路径把所有 `dispatchCommand` 异常 catch 后
   只记日志；群聊里没人看得到 worker log，于是任何 router handler 或 Lark
   SDK 回复出错，都会退化回这个 PR 本要修的「死按钮」症状。

## 改动内容

- **结构化路由，不再走字符串往返。** `CommandRouter` 新增
  `dispatchParsed({name, args}, ctx)`；`dispatch(text, ctx)` 改为先解析再委
  托给它。`card-action-handler.ts` 的 `cmdToSlash` 替换为 `cmdToCommand`，
  返回结构化 `ParsedCommand`（`ws.use` + `value.name` →
  `{ name: 'ws', args: ['use', <name>] }`）。自由文本的名字作为单个离散参
  数传递、绝不再被切词，含空白字符的名字因此能命中卡片所示的精确工作空间。
- **失败可见。** `worker/index.ts` 里内联的 `dispatchCommand` 闭包抽取为
  `makeDispatchCommand`（`src/worker/dispatch-command.ts`）。`dispatchParsed`
  抛错时它会发一条尽力而为的 `⚠️ command failed: /<cmd>` 兜底回复，而不是
  吞掉；只有当兜底回复本身也抛错时才退回记日志。卡片处理器保留一层最后兜
  底 catch，确保任何 rejection 都不会逸出 WS 事件循环。

`dispatchCommand` 依赖契约从 `(slashText: string, meta)` 改为
`(cmd: ParsedCommand, meta)`。

**审查驱动的质量打磨**（对同一改动的第二轮代码审查）：

- 回调契约与回复闭包形状现在是 `dispatch-command.ts` 里的**单一导出类型**
  —— `DispatchCommand`、`CardClickMeta`、`ChatReplies`，由生产方
  （`makeDispatchCommand`）、消费方（`card-action-handler.ts` 依赖）与接线
  （`worker/index.ts` 的 `makeReplies` 返回）共同引用。此前各自在两处手写，
  结构化类型不会在接线点报出漂移。
- `makeDispatchCommand` 的文档注释不再夸大：兜底回复真正能救的是**在产出
  自己的回复之前**就抛错的 handler（store 写入失败、构卡异常），并**不**承诺
  覆盖硬性传输中断（兜底回复发往同一会话同样会失败）；且它在任何成功的状态
  变更之后才触发，所以含义是「这次点击没有干净完成」，而非「什么都没发生」。

审查提的两个 open question **属于设计如此，未做改动**：admin 专属命令
（`/access`、`/sessions`、`/reconnect`）没有卡片按钮，`cmdToCommand` 故意
不映射它们；`/timeout` 的端到端接线已由 store + handler 的单测覆盖。

## 改动文件

- `src/commands/router.ts` —— 新增 `dispatchParsed`；`dispatch` 委托给它。
- `src/worker/card-action-handler.ts` —— `cmdToSlash` → `cmdToCommand`
  （返回 `ParsedCommand`）；`dispatchCommand` 依赖改收 `ParsedCommand`；
  优先级 3 分支更新。
- `src/worker/dispatch-command.ts` —— **新增。** `makeDispatchCommand` 工厂，
  含 admin 重算 + 尽力而为兜底回复；导出共享类型 `DispatchCommand` /
  `CardClickMeta` / `ChatReplies`。
- `src/worker/index.ts` —— 用 `makeDispatchCommand({...})` 替换内联闭包；
  `makeReplies` 标注为 `ChatReplies`。
- `tests/commands/router.test.ts` —— `dispatchParsed` 保持含空白参数完整。
- `tests/worker/card-action-handler.test.ts` —— `cmdToCommand` 用例含空白/
  换行回归；路由断言改为结构化 payload。
- `tests/worker/dispatch-command.test.ts` —— **新增。** 结构化透传、admin 重
  算、**成功时不发兜底**、router 抛错时兜底回复、兜底回复本身抛错也不再抛；
  mock 改为带类型（去掉 `as never`）。
- `tests/worker/card-command-e2e.test.ts` —— **新增。** 端到端回归：
  `cmdToCommand → makeDispatchCommand → 真实 CommandRouter → 真实 wsHandler →
  真实 WorkspaceStore/SessionStore`。`foo bar` 工作空间加一个 `foo` 诱饵，
  证明含空白的名字经真实 handler 命中精确目标，补上此前逐缝验证的缺口
  （未来 wsHandler 若再切词会在此失败）。

## 验证

- `pnpm typecheck` ✅
- `pnpm lint` ✅
- `pnpm test` ✅ —— 282 测试通过（原 273，+9）。新增覆盖：`cmdToCommand`
  把 `foo bar` / `a\nb` 保持为单参数；`dispatchParsed` 不再切词；
  `makeDispatchCommand` 在 router 抛错时发 `⚠️ command failed: …`、成功时静默、
  且绝不再抛；端到端测试经真实 router + wsHandler 把含空白的名字路由到精确
  工作空间（诱饵前缀正是旧 bug 会命中的目标）。

## 架构影响

更新了 `docs/architecture.md` 与 `docs/architecture.zh.md`
（§“Adapter event stream” / “适配器事件流”）：优先级 3 现描述结构化
`cmdToCommand` + 经 `makeDispatchCommand` 调用 `router.dispatchParsed`、
空白字符保真保证，以及尽力而为的兜底回复。

## 链接

- Spec: `—`
- Plan: `—`
- Commits: `<pending>`
- CHANGELOG: `[Unreleased]` → Fixed

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

审查提的两个 open question **属于设计如此，未做改动**：admin 专属命令
（`/access`、`/sessions`、`/reconnect`）没有卡片按钮，`cmdToCommand` 故意
不映射它们；`/timeout` 的端到端接线已由 store + handler 的单测覆盖。

## 改动文件

- `src/commands/router.ts` —— 新增 `dispatchParsed`；`dispatch` 委托给它。
- `src/worker/card-action-handler.ts` —— `cmdToSlash` → `cmdToCommand`
  （返回 `ParsedCommand`）；`dispatchCommand` 依赖改收 `ParsedCommand`；
  优先级 3 分支更新。
- `src/worker/dispatch-command.ts` —— **新增。** `makeDispatchCommand` 工厂，
  含 admin 重算 + 尽力而为兜底回复。
- `src/worker/index.ts` —— 用 `makeDispatchCommand({...})` 替换内联闭包。
- `tests/commands/router.test.ts` —— `dispatchParsed` 保持含空白参数完整。
- `tests/worker/card-action-handler.test.ts` —— `cmdToCommand` 用例含空白/
  换行回归；路由断言改为结构化 payload。
- `tests/worker/dispatch-command.test.ts` —— **新增。** 结构化透传、admin 重
  算、router 抛错时兜底回复、兜底回复本身抛错也不再抛。

## 验证

- `pnpm typecheck` ✅
- `pnpm lint` ✅
- `pnpm test` ✅ —— 281 测试通过（原 273，+8）。新增覆盖：`cmdToCommand`
  把 `foo bar` / `a\nb` 保持为单参数；`dispatchParsed` 不再切词；
  `makeDispatchCommand` 在 router 抛错时发 `⚠️ command failed: …` 且绝不
  再抛。

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

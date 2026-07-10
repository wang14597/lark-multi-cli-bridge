---
date: 2026-07-10
type: fix
slug: per-bot-session-files
---

# 按 bot 拆分 session 文件（修复跨 worker 会话覆盖 / "串台"）

**类型:** fix

## Motivation / 动机

bot 经常"走错 session"——在某个聊天里恢复到一段过期/更早的对话。根因（经
systematic-debugging 定位）：

- 三个 per-bot worker（`claude-bot`、`codex-bot`、`gemini-bot`）**共用同一个**
  文件 `state/sessions.json`。
- 每个 worker 的 `SessionStore` 只在**启动时 `load()` 一次**、之后不再读盘，且
  每次 `upsert` 都把**整个内存快照**写回整个文件（`writeJsonAtomic(this.data)`）。
- 于是某个 worker 的写会把别的 bot 的槽退回成**它启动时的旧快照**——跨进程
  "最后写者覆盖"。每个 worker 运行期间自己的内存是对的，但**下次重启**重新读盘
  时读到被覆盖的文件，就恢复了错误的 `sessionId`。
- worker 重启很频繁（近 7 天每个 bot 140–205 次），所以这个问题一直在发生。
  磁盘证据：槽里的 `sessionId` / `messageCount` 被退回成比实时对话更旧的值。

会话/cwd 的 `(chatId, botName)` keying 本身没问题；bug 纯粹是"共享文件 + 只读一次
+ 整文件写"在多进程下的竞争。

## What changed / 改了什么

每个 worker 现在拥有**自己的** session 文件——`state/sessions/<bot>.json`——
于是每个文件只有一个写者，跨进程覆盖消失。

- `SessionStore` 新增可选的第二个构造参数 `{ botName?, legacyPath? }`。`load()`
  时若 per-bot 文件为空且 `legacyPath`（旧的共享 `sessions.json`）存在，则**只**
  抽取本 bot 的槽（`extractBot`）迁入 per-bot 文件，仅一次。旧文件保持不动——
  每个 bot 迁自己那一份。
- `paths` 新增 `sessionsDir`（`state/sessions/`）与 `sessionBotJson(botName)`
  （`state/sessions/<bot>.json`，bot 名做与 `shimsDir` 相同的净化）。`sessionsJson`
  仅作为迁移来源保留。
- worker 改为构造
  `new SessionStore(paths.sessionBotJson(bot.name), { botName, legacyPath: paths.sessionsJson })`。
- `get` / `upsert` / `reset` / `setCwd` / `setIdleTimeout` / `list` 不变（仍是
  二维 `(chatId, botName)` API）；每个 per-bot 文件只不过只含这一个 bot 的槽。

行为说明：`/sessions`（本就按 `ctx.bot.name` 过滤）现在自然只列出当前 bot 的会话，
因为每个 worker 的 store 只持有自己的文件。

## Files touched / 涉及文件

- `src/session/store.ts` —— `SessionStoreOpts`、`load()` 里的一次性旧文件迁移、
  `extractBot` 辅助函数；docstring 更新。
- `src/config/paths.ts` —— `sessionsDir` + `sessionBotJson(botName)`；
  `sessionsJson` 重注为遗留迁移来源。
- `src/worker/index.ts` —— 用 per-bot 路径 + opts 构造 store。
- `tests/session/store.test.ts` —— 新增测试：两个 per-bot store 跨 reload 不互相
  覆盖；一次性迁移只抽取本 bot 的槽；per-bot 文件有数据后忽略旧文件。

## Verification / 验证

- 先红：迁移测试在修复前失败（无 opts / 无迁移）。
- `pnpm typecheck` —— 通过。
- `pnpm test` —— 全部 317 测试通过（新增 3）。
- `pnpm lint` —— 干净。

## Architecture impact / 架构影响

已更新 `docs/architecture.md` / `.zh.md`（磁盘状态树）：`state/sessions.json` →
`state/sessions/<bot>.json`（按 bot、单写者），旧文件标注为一次性迁移来源。

## Follow-ups / 后续（本次未做）

- `WorkspaceStore`（`state/workspaces.json`）是同样的"只读一次 / 整文件写 / 共享
  文件"模式，很可能有相同的潜在覆盖问题；建议另行做同样的 per-bot 处理。
- worker 重启频率偏高（140–205/7d）值得单独排查——它放大了本 bug。

## Links / 链接

- Spec: `—`（bug fix）
- Plan: `—`
- Commits: `<pending>`
- CHANGELOG: `[Unreleased]` 条目

---
date: 2026-11-03
type: feat
slug: group-team-roles
---

# 按群设置团队分工，让 bot 知道自己的角色和彼此

**类型:** feat

## Motivation / 动机

研发群里有用户加 claude-bot / codex-bot / gemini-bot，目前是三个互相独立的 bot，
由用户逐个指挥。用户希望它们像团队一样工作（A 开发后 `@B` review；B 把结果 `@A`
或直接 `@C` 启动 docker 测试；C 向用户汇报）。bot 之间在飞书里已经能互相 `@`；
缺的是共享上下文——bot 不知道自己在群里的角色，也不知道群里还有谁。

## What changed / 改了什么

- **`TeamStore`**（`src/session/team.ts`，文件 `state/teams.json`）：按群的分工表，
  `chatId → bot 名 → 角色`。全部 worker 共享，所以沿用 `WorkspaceStore` 的读时透传设计
  （不缓存；每次写是只改一个 chat key 的读-改-写；原子写盘）。
- **`/team`**（仅管理员）：`set <bot> <角色…>`、`rm <bot>`、`list`、`clear`。
  存储共享，所以在群里执行一次就更新所有 bot。成员靠命令维护，不从飞书的进群/退群事件同步。
- **`<team_roster>` 块**：`prefixPrompt` 每次运行都把它加在 `<bridge_context>` 之后
  （`you: <bot> — <角色>` 加其他成员）。没有分工就没有该块，没跑过 `/team` 的群行为不变。
  `prefixPrompt` 现在是 `string | Promise<string>`，dispatcher 会 await（分工要读盘）。
- **协作约定**：`lark-bridge-overlay` 新增 "Working as a team" 一节（按角色做事；
  交接发一条带真实 `@` 的单独消息；链条末端的 bot `@` 用户），
  `BOT_SKILL_PROMPT` 的块列表和触发语加入 `<team_roster>`（仍 < 900 字符）。
- `CommandCtx` / `DispatchCommandDeps` 新增 `teams`。
- **roster 带 @ 标签（同分支后续）**：实测发现 bot 每次交接前要花约 4 次工具调用去查队友 id。
  Lark 的 `open_id` 按应用隔离，不能在 `/team set` 时一次存好（只有被 @ 的 bot 的 worker 收到命令，
  且只知道自己视角的 id）。改为每个 worker 用自己的应用调
  `GET /im/v1/chats/{id}/members/list`（`member_types=bot`）（`fetchChatBots`，由
  `makeChatBotsLookup` 按群缓存：成功 10 分钟、失败 1 分钟），把 Lark 显示名（`wl-codex-bot`）
  按子串匹配到 lmcb 名（`codex-bot`），在每个队友行加上 `mention: <at user_id="ou_…">name</at>`。
  匹配不上或接口失败 → 该行不带标签（bot 回退到 `lark-im` 自己查）。需要每个 bot 应用开通
  `im:chat.members:read`（或 `im:chat:readonly`）权限——探测发现 codex-bot 的应用缺这个权限。
- **静默交接（同分支后续）**：overlay 现在要求交接直接发送，发前不铺垫、发后不复述原文/message id，
  最终回复至多一句。"替用户发消息"里的"发送后汇报"规则明确排除团队交接（它正是叙述的来源）。
  流式卡片仍会显示最终文本和工具调用，所以做不到完全静默。

**刻意没做**（用户决定，2026-11-03）：防循环刹车 / 跳数上限、收紧 `allowed_users`、
对 bot 的 cwd / 轮数 / 权限限制。没有刹车时，两个 bot 可能一直互相回复，直到用户叫停
（`/stop` 是按 bot 生效的）。

## Files touched / 涉及文件

- `src/session/team.ts`、`src/worker/team-roster.ts`、`src/commands/handlers/team.ts` —— 新增。
- `src/config/paths.ts` —— `teamsJson`。
- `src/commands/types.ts`、`src/worker/dispatch-command.ts` —— ctx / deps 加 `teams`。
- `src/worker/index.ts` —— 构造 `TeamStore`、注册 `/team`、带分工的异步 `prefixPrompt`。
- `src/worker/dispatcher.ts` —— await `prefixPrompt`。
- `src/prompts/lark-bot-skill.ts`、`skills/lark-bridge-overlay/SKILL.md` —— 团队约定。
- 测试：`tests/session/team.test.ts`、`tests/worker/team-roster.test.ts`、
  `tests/commands/team.test.ts`、`tests/worker/dispatcher-prefix.test.ts`；既有 ctx 夹具补 `teams`；
  更新 prompt 快照哈希。

## Verification / 验证

`pnpm typecheck`、`pnpm lint`、`pnpm test`（50 个文件、333 项）通过。**尚未实机验证**
（spec §4 的门槛）：一个 bot 看到的另一个 bot 的 `open_id` 能否跨 App 用于 `@`；
流式卡片里的 `@` 能否送达对方 bot。因此 overlay 让 bot 用单独的普通消息交接。

## Architecture impact / 架构影响

已更新 `docs/architecture.md` / `.zh.md`：模块表（`worker/` 的前缀块、`commands/` 条数 11 → 12、
`session/` 增加 `TeamStore`）和磁盘状态（`state/teams.json`）。

## Links / 链接

- Spec: `docs/superpowers/specs/2026-11-03-group-team-roles-design.md`
- Plan: `docs/superpowers/plans/2026-11-03-group-team-roles.md`
- Commits: 见分支 `feat/group-team-roles`
- CHANGELOG: `[Unreleased]` → Added

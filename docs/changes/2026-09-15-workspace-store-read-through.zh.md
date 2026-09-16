---
date: 2026-09-15
type: fix
slug: workspace-store-read-through
---

# WorkspaceStore 改为读时透传（修复跨 worker 工作区覆盖）

**类型:** fix

## Motivation / 动机

`WorkspaceStore` 有和
[per-bot-session-files](2026-07-10-per-bot-session-files.zh.md)
一模一样的毛病，那份 change doc 也把它记成了后续项：

- `state/workspaces.json` 由每个 per-bot worker（`claude-bot`、`codex-bot`、
  `gemini-bot`）共同写入。
- 每个 store 只在 worker 启动时 `load()` 一次，之后每次 `save` / `remove` 都把
  **整个内存快照**写回整个文件。
- 于是某个 worker 的写会把别的 worker 的条目退回成它启动时的样子——跨进程
  "最后写者覆盖"。worker 重启频繁，这个快照基本一直是旧的。

对用户来说有两个可见症状：

1. **保存丢失。** 在 claude-bot 里 `/ws save alpha`，再到 codex-bot 里
   `/ws save beta`，文件里 `alpha` 就没了。
2. **读到旧值。** 就算没被覆盖，store 启动后也再不读盘，所以在一个 bot 里存的
   workspace，其它 bot 要等自己的 worker 重启才看得见。

## What changed / 改了什么

`WorkspaceStore` 现在**读时透传**：不持有缓存，每次读都读盘，每次写都是"读-改-写"，
只改自己那一个 key。

这里和 session 那次修法**有意不同**。session 本来就带 `(chatId, botName)` 维度，
拆成 `state/sessions/<bot>.json` 零成本；而 workspace 别名是**全局命名空间**——
在 claude-bot 里 `/ws save` 的路径，本就该能在 codex-bot 里 `/ws use`——按 bot 拆
会把命名空间切碎。所以这里保持单一共享文件是对的，要修的是"别再拿旧快照覆盖它"。

- `resolve(name)` 和 `list()` 改为 **async**，直接读盘。
- `save(name, path)` / `remove(name)` 先重新读盘，只应用自己这一处改动，再
  `writeJsonAtomic`。
- `load()` 为与 `SessionStore` 的生命周期对称而保留（worker 和测试都在调），但现在
  是空实现——没有缓存需要预热。
- `read()` 顺带对 `named` 字段缺失/畸形做了防御，而不是直接信任类型断言。

磁盘格式、文件路径、`/ws` 命令表面均不变。

**已知限制：** 读-改-写在跨进程层面不是原子的，两个 worker 在几毫秒内同时改仍可能
丢掉一次编辑。`/ws` 是交互式低频操作，这个窗口相比它替换掉的"整个 worker 生命周期"
窗口可以忽略。真正的跨进程文件锁在这里不值当。

## Files touched / 涉及文件

- `src/session/workspace.ts` —— 读时透传：`resolve`/`list` 改 async、`save`/`remove`
  改读-改-写、`load()` 变空实现、新增带形状校验的 `read()` 辅助；类 docstring 说明
  为什么这个 store 保持共享而 `SessionStore` 走了 per-bot。
- `src/commands/handlers/ws.ts` —— `await` 现在 async 的 `resolve`/`list`；`list`
  分支改为只读一次，卡片的 `named` 映射从这一次读的结果派生，不再调两次 `list()`。
- `tests/session/workspace.test.ts` —— 原 round-trip 测试改为 await；新增三个测试：
  兄弟 store 的保存不被覆盖、兄弟 store 的删除不被复活、兄弟 store 的保存无需 reload
  即可见。
- `.gitignore` —— 忽略 `.idea/` / `.vscode/` / `*.swp`（本分支上已提交的 `.idea/`
  文件在同一次推送里停止跟踪）。

## Verification / 验证

- 先红：三个新测试在旧 store 上失败（覆盖与陈旧读两种场景都是
  `expected '/srv/alpha', got undefined`）；round-trip 测试全程通过，符合预期——
  它只覆盖单进程行为。
- `pnpm typecheck` —— 通过。
- `pnpm test` —— 320 测试全过（317 → 320）。
- `pnpm lint` —— 干净。

## Architecture impact / 架构影响

已更新 `docs/architecture.md` / `.zh.md`（模块表 + 磁盘状态树）：`session/` 一行现在
区分两种落盘策略，`state/workspaces.json` 标注为共享、读时透传、多写者的文件。

## Links / 链接

- Spec: `—`（bug fix）
- Plan: `—`
- 承接自: [2026-07-10-per-bot-session-files](2026-07-10-per-bot-session-files.zh.md)
- Commits: `<pending>`
- CHANGELOG: `[Unreleased]` 条目

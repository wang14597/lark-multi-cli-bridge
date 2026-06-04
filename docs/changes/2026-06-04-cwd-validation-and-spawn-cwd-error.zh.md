---
date: 2026-06-04
type: fix
slug: cwd-validation-and-spawn-cwd-error
---

# /cd 与 /new 校验用户提供的 cwd；区分坏 cwd 引发的 spawn ENOENT

**类型:** fix

## Motivation / 动机

用户在群里给 codex-bot 发了 `/cd /Downloads/wiz/projects/voice-agent`
（手误——漏了 `/Users/<name>` 前缀）。两个缺陷把这个笔误放大成一次
令人困惑的故障：

1. **`/cd`（以及 `/new <path>`）不检查路径是否存在就直接落盘。**
   坏 cwd 被静默写进 `state/sessions.json`，该聊天之后的每次 agent
   运行全部失败，直到用户再发一次正确的 `/cd`。
2. **Node 在 cwd 不存在时报 `spawn <cmd> ENOENT`**——与二进制缺失的
   报错逐字节相同。bot 回复 `failed to spawn codex: spawn codex
   ENOENT`，把排查方向引向"codex 没装"，而实际上 codex 完好（同一
   worker 几小时前 preflight 还成功过）。

## What changed / 改了什么

- 新增共享模块 `src/commands/cwd.ts`：
  - `resolveCwd(value)`——`~` / `~/x` 展开 + 绝对路径解析。此前在
    `cd.ts`、`new.ts`、`worker/index.ts` 三处复制粘贴，现在单一来源。
    `cd.ts` 原来用的是更弱的 `path.replace(/^~/, …)`，对裸 `~` 和
    `~abc` 处理有歧义。
  - `validateCwd(cwd)`——异步 stat 检查，返回面向用户的错误文案
    （`directory does not exist: …` / `not a directory: …`），合法时
    返回 `undefined`。
- `/cd` 和 `/new <path>` 解析后先调 `validateCwd`，目标不存在或不是
  目录时**直接拒绝，完全不碰 session store**。
- `spawnWithLifecycle`（`src/adapters/base.ts`）：spawn 失败时若传入了
  `cwd` 且该目录不存在，抛出
  `cwd does not exist: <cwd> (failed to spawn <cmd>)`，替代误导性的
  `failed to spawn <cmd>: spawn <cmd> ENOENT`。这是纵深防御——cwd
  落盘时合法、之后被删除的场景，命令时校验拦不住。

## Files touched / 涉及文件

- `src/commands/cwd.ts` —— 新增：共享 `resolveCwd` + `validateCwd`。
- `src/commands/handlers/cd.ts` —— 落盘前校验；改用共享 `resolveCwd`。
- `src/commands/handlers/new.ts` —— 落盘前校验；删除本地 `resolveCwd`
  副本，改用共享版。
- `src/worker/index.ts` —— 删除本地 `resolveCwd` 副本，改用共享版
  （行为不变）。
- `src/adapters/base.ts` —— 坏 cwd 导致的 spawn 失败现在指明真实原因。
- `tests/commands/cd.test.ts` —— 新增：6 个测试覆盖拒绝不存在路径、
  拒绝非目录、接受存在目录、`~` 展开，同时覆盖 `/cd` 和 `/new`
  （真实 `SessionStore` + 临时文件，无 mock）。
- `tests/adapters/base.test.ts` —— 新增回归测试：cwd 不存在必须报
  `cwd does not exist: …`，与二进制缺失区分开。

## Verification / 验证

- TDD：所有新测试先写、先看着以正确原因失败（4 个失败：handler 接受
  坏路径；base.ts 抛通用报错），实现后转绿。
- `pnpm typecheck` —— 通过。
- `pnpm test` —— 42 个文件、252 个测试全绿。
- `pnpm lint` —— 34 个存量问题（本次变更前 `main` 上已失败；全部位于
  本次未触碰的文件）。另行清理。
- 根因复现：Node 24 下 `spawn('codex', …, {cwd: '/Downloads/…'})`
  确认报 `spawn codex ENOENT`。

## Architecture impact / 架构影响

无。模块职责、进程拓扑、adapter 事件契约、IPC、磁盘状态结构均未变。
（`commands/` 内部新增辅助模块；命令数量不变。）

## Links / 链接

- Spec: —
- Plan: —
- Commits: （合并时补）
- CHANGELOG: `[Unreleased]` → Fixed

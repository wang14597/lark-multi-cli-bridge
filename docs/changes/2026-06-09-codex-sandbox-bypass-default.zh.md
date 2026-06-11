---
date: 2026-06-09
type: feat
slug: codex-sandbox-bypass-default
---

# Codex bot 默认绕过 OS 沙箱(对齐 claude)

**类型:** feat

## Motivation / 动机

有用户发现:同一台机器上,claude bot 能联网、能 `git push`、能跑 `lark-cli`,
但 codex bot 全都不行。根因是两个适配器的**默认安全档不对称**,而非功能缺失:

- `ClaudeAdapter` 默认用 `--permission-mode bypassPermissions` 启动
  (`claude.ts`),所以 claude 子进程拥有完整的机器 + 网络访问权。
- `CodexAdapter` 启动的是 `codex exec --json --skip-git-repo-check …`,**没有**
  任何沙箱 flag,于是 codex 落回它自带的 OS 沙箱(Apple Seatbelt / Landlock):
  默认**禁止联网**、只允许写工作目录。所以需要网络的命令(`lark-cli`、
  `git push`)在 codex 沙箱里必然失败。

bridge 的整体模型是"一个代表你本人的可信本地 CLI",claude 已经默认全开。
codex 应当对齐,让 `lmcb init` 出来的 codex bot 开箱即用、和 claude bot 一样,
不需要运维手动改 `extra_args`。

## What changed / 改了什么

为 codex 新增 `bypass_sandbox` 开关,**默认开启**,镜像 claude 的
`bypassPermissions` 默认值与现有的 `skip_git_repo_check` 模式:

- 开启时(默认),`CodexAdapter` 给 `codex exec` 传
  `--dangerously-bypass-approvals-and-sandbox`,获得与 claude 同等的全访问权。
- **去重保护:** 若 bot 的 `extra_args` 已带沙箱/审批相关 flag
  (`--dangerously-bypass-approvals-and-sandbox`、`--sandbox`/`-s`、
  `--ask-for-approval`/`-a`、`--full-auto`、`--yolo`),适配器**不再**叠加 bypass
  flag——以运维的显式选择为准,避免冲突或重复。
- 设 `bypass_sandbox: false` 即可保留 codex 原生沙箱(断网、只写工作目录)。

默认值落在**适配器层**(`bypassSandbox ?? true`),所以即使是空的 `codex: {}`
也会 bypass——与 `skipGitRepoCheck ?? true` 完全一致。`lmcb bot add` / `lmcb init`
还会把 `bypass_sandbox: true` 显式写进生成的 codex yaml,提高可见性,
和给 claude 写 `permission_mode: bypassPermissions` 一个道理。

## Files touched / 涉及文件

- `src/config/schema.ts` —— codex 子块新增 `bypass_sandbox: z.boolean().optional()`。
- `src/adapters/codex.ts` —— 新增 `bypassSandbox?: boolean` opt(默认开);
  注入 `--dangerously-bypass-approvals-and-sandbox`,除非 `extra_args` 已含沙箱/
  审批 flag(`CODEX_SANDBOX_FLAGS` 守卫)。
- `src/adapters/registry.ts` —— 把 `cfg.bypass_sandbox` 透传给适配器
  (条件透传,同 `skip_git_repo_check`)。
- `src/cli/commands/bot.ts` —— `botAdd` 给新建 codex bot 的 backend 块写
  `{ bypass_sandbox: true }`。
- `tests/adapters/codex.test.ts` —— 新增 `sandbox bypass` describe:默认注入、
  `true` 注入、`false` 不注入、不重复加、已有 `--sandbox` 时让位。
- `tests/config/schema.test.ts` —— codex 接受 `bypass_sandbox`;省略时为 undefined。
- `tests/adapters/registry.test.ts` —— 透传 + 省略时 undefined。
- `docs/configuration.md` / `.zh.md` —— 记录新字段。
- `docs/architecture.md` / `.zh.md` —— 在适配器章节标注各 backend 的默认安全档。

## Verification / 验证

- `pnpm typecheck` —— 通过。
- `pnpm test` —— 全部 308 个测试通过,含 9 个新增(5 个适配器沙箱用例 +
  2 个 schema + 2 个 registry)。
- `pnpm lint` —— 干净。
- 先红后绿:确认新测试在实现前失败、实现后通过。

## Architecture impact / 架构影响

已更新 `docs/architecture.md` / `.zh.md`(§模块图 / 适配器):新增一行说明——
各 backend 的适配器默认授予全访问(claude `bypassPermissions`、
codex `bypass_sandbox`),这正是 LLM 子进程能调用 `lark-cli` 的前提。
未改动进程拓扑 / IPC / 事件契约。

## Links / 链接

- Spec: `—`
- Plan: `—`
- Commits: `<pending>`
- CHANGELOG: `[Unreleased]` 条目

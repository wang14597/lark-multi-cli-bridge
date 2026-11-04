---
date: 2026-11-04
type: fix
slug: codex-lark-cli-profile-pin
---

# 让每个 bot 的 lark-cli shim 在 codex 的 PATH 里保持第一

**类型:** fix

## Motivation / 动机

codex-bot 调 `lark-cli` 报 `keychain Get failed: cipher: message authentication failed`。
原因：codex 通过登录 shell（`zsh -lc`）执行命令；macOS 登录 shell 对 `PATH` 的重排把
每个 bot 的 shim 目录排到了 nvm / homebrew 后面，`command -v lark-cli` 解析到真实程序，
codex 于是用了默认 lark profile——身份不对，且在这台机器上它保存的凭据解不开。
用 shim 的 `PATH` 跑 `codex exec` 可复现，之前的 codex 会话日志里也能看到。claude 和 gemini 不受影响。

## What changed / 改了什么

`CodexAdapter` 增加 `-c allow_login_shell=false`（`extraArgs` 已设置
`allow_login_shell=` 时跳过），codex 改用非登录 shell，保留继承的 `PATH`（shim 在最前）。

## Files touched / 涉及文件

- `src/adapters/codex.ts` —— 增加 `-c` 参数。
- `tests/adapters/codex.test.ts` —— 断言该参数。
- 文档：本 change doc（+ `.md`）、INDEX、CHANGELOG、`architecture`（shim 一节）。

## Verification / 验证

在 codex-bot 的 shim `PATH` 下跑 `codex exec`：不带该参数时 `command -v lark-cli` 是 nvm
下的真实程序；带 `-c allow_login_shell=false` 时是 shim。`pnpm typecheck` / `lint` / `test` 通过。

## Architecture impact / 架构影响

已更新 `docs/architecture.md` / `.zh.md`（身份 shim 一节）。

## Links / 链接

- Spec: —
- Plan: —
- Commits: 见分支 `fix/codex-lark-cli-profile-pin`
- CHANGELOG: `[Unreleased]` → Fixed

---
date: 2026-06-03
type: fix
slug: profile-provision-verify
---

# 校验 lark-cli profile add 真正落盘（防丢写护栏）

**类型:** fix

## Motivation / 动机

`ensureLarkProfile` 此前只信任 `profile add` 的 exit 0 就记日志
"provisioned"。但 `profile add` 是对共享配置文件
（`~/.lark-cli/config.json`）的读-改-写，成功报告可能撒谎：

- 所有 worker 启动时并发 provision，并发 add 可能互相覆盖（丢更新——
  后写者赢）。
- 环境标记可能让 CLI 静默指向**另一个配置 home**：`LARK_CHANNEL=1`
  （前身 bridge 给其 LLM 子进程设置）会让 lark-cli 使用
  `~/.lark-cli/lark-channel/`。在那里加的 profile 对没有该标记的进程不可
  见，反之亦然。

无论哪种情况，worker 都会"成功"启动而它的 bot 在 lark-cli 里没有
profile——LLM 后续每次调 lark-cli 都报 "profile not found"，离根因十万八
千里。

（排查备注：2026-06-03 表面上的 "codex/gemini profile 缺失" 正是配置
home 分叉——在带 `LARK_CHANNEL=1` 的 shell 里观察导致的错觉，worker 侧
配置实际完好。本护栏让未来任何真实丢失在启动时就炸响。）

## What changed / 改了什么

`profile add` 成功后，`ensureLarkProfile` 重新跑一次 `profile list`，若
bot 的 `app_id` 仍不在列表中则抛错。错误信息点名两个嫌疑根因（并发配置
写入 / `LARK_CHANNEL` / `LARK_CLI_HOME` 导致的配置 home 分叉）。列表解析
抽成 `listProfiles` helper，两处调用共用。

## Files touched / 涉及文件

- `src/lark/lark-cli-provision.ts` —— 抽出 `listProfiles`；add 后回读校
  验并给出描述性报错。
- `tests/lark/lark-cli-provision.test.ts` —— happy-path 的 add 用例改为
  有状态 mock（profile 在 `add` 之后才出现在 `list` 里）并断言校验性
  re-list；新增丢写用例（`add` exit 0 但 profile 始终没落盘 → 抛
  `missing after add`）。

## Verification / 验证

- 新增/调整的测试先对旧实现跑红（无 re-list、不抛错），改完全绿。
- `pnpm typecheck` 通过；`pnpm test` 39 个文件 / 239 个用例全部通过。
- 手动验证：顺序执行真实 CLI 的 `profile add` 能落盘且对同一配置 home
  可见。

## Architecture impact / 架构影响

无（provisioning 流程不变，只增加了后置条件校验）。

## Links / 链接

- Spec: `—`
- Plan: `—`
- Commits: 见分支 `worktree-fix-ws-ping-timeout`
- CHANGELOG: `[未发布]` → 修复

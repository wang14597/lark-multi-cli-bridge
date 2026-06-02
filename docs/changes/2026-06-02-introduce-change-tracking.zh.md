---
date: 2026-06-02
type: docs
slug: introduce-change-tracking
---

# 引入"每次变更随附文档"追踪机制

**类型:** docs

## Motivation / 动机

项目原本有三层文档(`CHANGELOG.md`、`docs/superpowers/specs|plans/`、
`docs/architecture.md`),但没有任何规则把*每一次*变更绑定到一份持久记录。
漂移已经肉眼可见:`docs/architecture.md` 顶部标注"更新至 v0.4.0",而包版本
已是 v0.7.1。目标是让仓库本身即完整上下文——任何 AI agent clone 下来,仅凭
文档就能理解项目全貌,无需翻代码考古。

## What changed / 改了什么

建立了一套变更追踪约定,并以规则形式写进新的根目录 `CLAUDE.md`:

- 新增 `docs/changes/` 账本。每个逻辑变更(feature / bug fix / refactor)
  按固定的、刻意精简的模板产出双语文档 `YYYY-MM-DD-<slug>.{md,zh.md}`,
  并在 `docs/changes/INDEX.{md,zh.md}` 追加一行。
- 强制的**架构同步规则**:凡触及模块职责、进程拓扑、adapter 事件契约、
  IPC、磁盘状态的变更,必须在同一次变更内更新 `architecture.{md,zh.md}`
  (含版本标注)。
- 豁免白名单(格式化、typo、无行为影响的依赖 bump、纯文档编辑),让账本
  保持信号而非噪音。
- 一份 Definition-of-Done 清单,以及 spec/plan ↔ 变更文档的衔接关系。

本次变更对该约定进行了 dogfood:它本身就是账本的第一条记录。

## Files touched / 涉及文件

- `CLAUDE.md` —— 新增。约定本身与导航入口。
- `docs/changes/TEMPLATE.md`、`TEMPLATE.zh.md` —— 新增。变更文档模板。
- `docs/changes/INDEX.md`、`INDEX.zh.md` —— 新增。时间线索引。
- `docs/changes/2026-06-02-introduce-change-tracking.{md,zh.md}` —— 新增。
  本基线记录。
- `docs/architecture.md`、`architecture.zh.md` —— 版本标注 v0.4.0 → v0.7.1;
  增加指向 `docs/changes/` 的指针。

## Verification / 验证

纯文档变更,未触碰代码。已核对内部链接可达(`CLAUDE.md` → architecture →
INDEX → 本文),并确认双语文件互为镜像。

## Architecture impact / 架构影响

已更新 `docs/architecture.md` 与 `docs/architecture.zh.md`:修正过期的版本
标注(v0.4.0 → v0.7.1),并增加指向 `docs/changes/` 账本的指针以承载逐次
变更历史。系统本身无结构性改动。

## Links / 链接

- Spec: ——(现场 brainstorm,用户选择跳过书面 spec)
- Plan: ——
- Commits: <本次提交>
- CHANGELOG: 见 `[Unreleased]` › Internal

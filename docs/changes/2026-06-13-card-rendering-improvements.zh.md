---
date: 2026-06-13
type: feat
slug: card-rendering-improvements
---

# 运行卡片全宽显示 + 长回答可折叠

**类型:** feat

## Motivation / 动机

群聊中两个可用性问题：

1. **卡片宽度偏窄。** agent 运行卡片以飞书默认宽度渲染，比聊天窗口窄。长代码块和
   工具调用列表显得拥挤或换行过多。

2. **长回答占满时间线。** 一段冗长的 agent 回答（几十行说明、代码或日志）会把群里
   之前所有消息挤出屏幕。用户读完后无法用原生方式折叠它。

## What changed / 改了什么

两处改动都限定在 `src/lark/card-builder.ts` 的 `renderRunCard` 内。
命令卡片（`src/lark/command-cards.ts`）不受影响。无配置 schema 变更。

### 1 — 卡片全宽

`renderRunCard` 在卡片根节点设置 `config.width_mode: 'fill'`，让卡片横跨聊天窗格
的全部宽度（飞书的 `fill` 模式），而不再是默认的固定/偏窄宽度。

### 2 — 长回答可折叠

新常量 `ANSWER_FOLD_LINE_THRESHOLD = 10`（原始行数）控制行为分支：

- **短回答（≤ 10 行）：** 与之前完全相同——在回答列中渲染为普通 `markdown` 元素。
- **长回答（> 10 行）：** markdown 元素通过新的私有辅助函数 `answerPanel` 包裹进
  `collapsible_panel`，`expanded: true`（默认展开，让用户立即看到内容），标题
  固定为 `📄 回答（点击可折叠）`。用户可用飞书原生箭头折叠该面板。

`answerPanel` 刻意**不复用**现有的 `collapsiblePanel` 辅助函数——后者会强制将面板
**正文**设为 `notation`（小）字号。`answerPanel` 不覆盖字号，正文以正常字号渲染。

## Files touched / 涉及文件

- `src/lark/card-builder.ts` —— 在 `renderRunCard` 的卡片根节点添加
  `config: { width_mode: 'fill' }`；新增 `ANSWER_FOLD_LINE_THRESHOLD` 常量和
  `answerPanel` 辅助函数；`renderRunCard` 将超长回答文本块包裹进 `answerPanel`。
- `tests/lark/card-builder.test.ts` —— 新增测试：(a) 所有运行卡片都有全宽 config；
  (b) 短回答（≤ 10 行）不包裹折叠面板；(c) 长回答（> 10 行）包裹在默认展开的
  `collapsible_panel` 中；(d) 命令卡片不受影响。

## Verification / 验证

- `pnpm typecheck` —— 通过。
- `pnpm test` —— 全部测试通过，含新增的 card-builder 用例。
- `pnpm lint` —— 干净。

## Architecture impact / 架构影响

`无。` card-builder 在 `docs/architecture.md` 中已描述为渲染辅助模块；模块职责、
进程拓扑、适配器事件契约、IPC 及磁盘状态均未变更。

## Links / 链接

- Spec: `docs/superpowers/specs/2026-06-13-card-rendering-improvements-design.md`
- Plan: `docs/superpowers/plans/2026-06-13-card-rendering-improvements.md`
- Commits: `125937c`、`c137b30`
- CHANGELOG: `[Unreleased]` 条目

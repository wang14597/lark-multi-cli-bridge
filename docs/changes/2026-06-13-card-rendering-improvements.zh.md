---
date: 2026-06-13
type: feat
slug: card-rendering-improvements
---

# 运行卡片全宽显示 + 长消息可折叠

**类型:** feat

## Motivation / 动机

群聊中两个可用性问题：

1. **卡片宽度偏窄。** agent 运行卡片以飞书默认宽度渲染，比聊天窗口窄。长代码块和
   工具调用列表显得拥挤或换行过多。

2. **长消息占满时间线。** 一次冗长的运行（几十行说明、代码、日志，外加工具调用
   过程）会把群里之前所有消息挤出屏幕。用户读完后无法用原生方式折叠它。

## What changed / 改了什么

两处改动都限定在 `src/lark/card-builder.ts` 的 `renderRunCard` 内。
命令卡片（`src/lark/command-cards.ts`）不受影响。无配置 schema 变更。

### 1 — 卡片全宽

`renderRunCard` 在卡片根节点设置 `config.width_mode: 'fill'`，让卡片横跨聊天窗格
的全部宽度（飞书的 `fill` 模式），而不再是默认的固定/偏窄宽度。

### 2 — 长消息可折叠

一次运行**结束后**，长消息会被**整体**折叠——把**工具调用过程和正文一起**折进
一个可展开/收起的折叠面板：

- `renderRunCard` 把所有 body 元素（正文 markdown + 工具调用引用块）收集成一个
  列表。若运行已终态（`terminal !== 'running'`）且 body 超过
  `ANSWER_FOLD_LINE_THRESHOLD`（10）渲染行，则通过私有辅助函数 `answerPanel` 把
  整个列表包进一个默认展开的 `collapsible_panel`，标题固定为 `展开/折叠`。
- **流式输出中**（或**短消息**，≤ 10 行）时 body 平铺渲染——这样实时进度和进行中
  的工具面板保持可见，短回复也不会被套框。
- 行数（`bodyLineCount`）近似渲染高度：原始正文行数（不含 `normalizeMarkdown`
  补的空行）加上每个工具调用算 1 行。

`answerPanel` 刻意**不复用**现有的 `collapsiblePanel` 辅助函数——后者会强制将面板
**正文**设为 `notation`（小）字号；`answerPanel` 不覆盖字号，正文以正常字号渲染。
飞书面板标题是静态的，所以 `展开/折叠` 文案不会随状态切换，由箭头指示展开/收起。

**设计取舍（迭代中确定）：** 按"每个文本块各自折叠"会把工具调用过程留在面板
**外面**；"前 3 行预览 + 显示更多"的变体视觉上割裂——两者都被否掉，改为把整条
已结束消息作为一个整体折叠。也试过依赖飞书原生的高卡片折叠（纯 markdown、无
面板），同样被否：它比用户想要的带边框面板更朴素。还考虑过"底部收起"控件，但
`collapsible_panel` 的开关只能在顶部，除非引入有状态的回调往返，否则做不到，故
保留顶部开关。

## Files touched / 涉及文件

- `src/lark/card-builder.ts` —— 在 `renderRunCard` 卡片根节点添加
  `config: { width_mode: 'fill' }`；`renderRunCard` 现在先收集 body 元素，终态且
  内容长时通过 `answerPanel` 整体折叠；新增 `bodyLineCount` 辅助函数与
  `ANSWER_FOLD_LINE_THRESHOLD` 常量；`answerPanel` 接收 body 元素列表，用
  `展开/折叠` 标题、正常字号。
- `tests/lark/card-builder.test.ts` —— 新增测试：(a) 每张运行卡片都有全宽 config
  （流式 + 终态）；(b) 短消息（≤ 10 行）平铺、无折叠面板；(c) 长消息（> 10 行）
  整体折进一个默认展开的 `展开/折叠` 面板、正常字号；(d) 工具调用过程与正文一起
  折进同一面板；(e) 10 vs 11 行边界。

## Verification / 验证

- `pnpm typecheck` —— 通过。
- `pnpm test` —— 全部 314 个测试通过，含新增的 card-builder 用例。
- `pnpm lint` —— 干净。
- 手动：在真实飞书会话验证——已结束的长消息把工具调用过程 + 正文折进一个
  `展开/折叠` 面板；短消息平铺；卡片全宽。

## Architecture impact / 架构影响

`无。` card-builder 在 `docs/architecture.md` 中已描述为渲染辅助模块；模块职责、
进程拓扑、适配器事件契约、IPC 及磁盘状态均未变更。

## Links / 链接

- Spec: `docs/superpowers/specs/2026-06-13-card-rendering-improvements-design.md`
- Plan: `docs/superpowers/plans/2026-06-13-card-rendering-improvements.md`
- Commits: `125937c`、`c137b30`、`e327245`、`7f02a96`、`a0d2f50`
- CHANGELOG: `[Unreleased]` 条目

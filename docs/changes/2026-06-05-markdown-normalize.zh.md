---
date: 2026-06-05
type: feat
slug: markdown-normalize
---

# 卡片正文做 markdown 规范化，密集输出不再糊成一片

**类型：** feat

## 动机

codex bot 的卡片明显没有 claude 的好看——大段文字糊在一起。排查（并读了参考
项目 `zarazhangrui/lark-coding-agent-bridge`）后确认：这**不是** bridge 的渲染
bug，也**不是**因为 codex「整段一次性吐出」：

- bridge 把 agent 正文**原样**塞进飞书卡片的 `markdown` 组件
  （`card-builder.ts` 的 `markdown(content)`），中间不处理换行。
- 飞书 `markdown` 组件靠**空行**（`\n\n`）分隔块级内容；单个 `\n` 会被渲染成
  贴在一起的软换行。
- claude 输出用空行分段 + 列表，所以通透；codex 输出更密（标签行之间多用单换
  行、少空行），同一个组件就把它糊成一坨。
- 参考项目的 codex 解析器和卡片渲染器跟我们几乎一模一样（一条 `agent_message`
  → 一个文本块、原样 `markdown()`），它**也没有**做任何规范化——所以「一次性
  吐出」根本不是差异来源。

真正的杠杆是 markdown 规范化，两个项目都没做。本次改动在我们这侧补上。

## 改动内容

新增纯函数 `normalizeMarkdown(md)`（`src/lark/markdown-normalize.ts`），把飞书需
要的空行补回去，应用到 `renderRunCard` 的 agent 正文文本块。

规则：相邻两行非空行之间补**恰好一个**空行，除非它们属于同一**紧凑块**（两个
列表项、两行引用、两行表格）。其余一切——正文↔正文、段落↔列表、列表↔段落、
标题与代码围栏前后——都补空行。细节：

- 围栏代码块（```` ``` ````/`~~~`）**原样透传**——内部空行与缩进不动——只在围栏
  外侧补空行。
- **真表格**靠 GFM **分隔行**（`| --- | --- |`）加表头识别，而非「见到 `|` 就算」。
  表头 + 分隔行 + 连续表体行保持紧凑（绝不拆开），表格前后补空行。仅仅含管道符的
  正文/代码（shell `a | b`、TS 联合 `A | B`、正则 alternation）**不是**表格，按普通
  正文分隔。
- 列表项后**带缩进**的正文行视为该项的续行（折行的 bullet 文本），保持附着、不把
  列表拆开；不带缩进的正文行仍照常分隔。引用块后的正文行按 CommonMark 惰性续行
  保持附着。
- 连续空行折叠为单个空行；首尾空行裁掉。
- 幂等：对已规范化的文本再跑一次是 no-op。

在 `card-builder.ts` 中只对文本块生效（不动工具体/思考面板）。对**所有**后端都
跑——对 claude 无害（本就空行分段、且幂等），对 codex/gemini 则是修复密集问题。

**已知限制（源码中注明）：** 正文↔正文规则假设 agent 不会把同一段落用单换行硬
折成多行。claude/codex 每个逻辑段落一行，成立；若某后端软折行，这些折行会被提
升成段落。

首版经 codex 代码审查指出两个语义风险后做了收紧：(1) 列表项续行被强行拆出列表；
(2) 任何含 `|` 的行都被当成表格，导致含管道符的正文被糊在一起。两点都已按上述规
则修复并补了回归测试。

## 改动文件

- `src/lark/markdown-normalize.ts` —— **新增。** `normalizeMarkdown` + 行分类器。
- `src/lark/card-builder.ts` —— 文本块内容用 `normalizeMarkdown` 包一层。
- `tests/lark/markdown-normalize.test.ts` —— **新增。** 16 个单测（正文拆分、列表
  前补空行、缩进续行保持附着、有序列表、标题、引用紧凑 + 惰性续行、含管道符正文
  被分隔、真 GFM 分隔行表格识别与保护、围栏代码原样、空行折叠、裁剪、幂等、空串/
  单行）。
- `tests/lark/card-builder.test.ts` —— 集成用例：断言密集文本块在卡片里渲染为规
  范化结果。

## 验证

- `pnpm typecheck` ✅
- `pnpm lint` ✅
- `pnpm test` ✅ —— 299 测试通过（原 282，+17）。

## 架构影响

更新了 `docs/architecture.md` 与 `docs/architecture.zh.md`：在 `lark/` 下记入新模
块 `markdown-normalize.ts`，并说明 `renderRunCard` 在输出前对文本块做 markdown
规范化。

## 链接

- Spec: `—`
- Plan: `—`
- Commits: `<pending>`
- CHANGELOG: `[Unreleased]` → Changed

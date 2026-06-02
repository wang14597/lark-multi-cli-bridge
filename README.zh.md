# lark-multi-cli-bridge (lmcb)

飞书/Lark 聊天桥接，把用户消息路由到 **Claude Code**、**OpenAI Codex CLI** 或 **Google Gemini CLI**，支持在同一台机器上并发运行多个机器人——每个机器人对应一种 CLI 后端。

English: [README.md](README.md)

## 为什么

在同一个 Lark 工作区里同时跑 Claude、Codex、Gemini 三个 bot，共用一个 supervisor。每个 bot 各有自己的 Lark 身份、对话状态、崩溃预算和 session 续接——但共用同一套流式卡片 UI、同一套斜杠命令、同一套访问控制和同一份磁盘布局。运维三个 bot 几乎不比运维一个多花精力。

## 功能

- **多 bot、多后端** — 一个 supervisor fork 一个 worker per bot；每个 worker 以独立 bot 身份连接 Lark，并 spawn 各自的 CLI（`claude` / `codex` / `gemini`）。
- **每 bot 独立的 `lark-cli` 身份** — worker 启动时为每个 bot 注册一个 `lark-cli` profile，并在 `~/.lark-multi-cli-bridge/shims/<bot>/` 写一个 PATH shim，强制所有 `lark-cli` 调用带上 `--profile <app_id>`。LLM 子进程可以放心调 `lark-cli api …`，永远绑定到正确 bot 身份，即使一台机器上跑多个 bot 也不会串号。
- **扫码创建 app** — `lmcb init` 默认走二维码流程：用飞书/Lark 移动端扫码，Lark 自动在你的租户下创建内部应用并返回 `app_id`/`app_secret`，无需访问开发者后台。
- **精美流式卡片** — `streaming_mode` 渐进更新；可折叠思考面板；工具调用统一渲染为一个 markdown blockquote（`> ✅ **Tool** — summary`），当前正在跑的工具单独保留 live 面板，失败用 `↳` 嵌入显示错误首行；底部状态栏；终态备注；⏹ 终止按钮。
- **引用回复归属清晰** — 每轮第一张卡通过 `im.message.reply` 引用用户消息发出，原消息出现 `N 条回复` 角标，bot 卡片渲染在 `回复 <user>:` 引用块下方——群聊里再忙也能看清回的是哪条。
- **(chatId, botName) 二维 session** — 同一个聊天若被多个 bot 服务，每个 bot 各自独立维护 `sessionId` / `cwd`。`claude-bot` 的 session UUID 永远不会被 `codex-bot` 看到，一个聊天里能并行跟多个 agent 各开各的对话互不串号。旧版单 slot 文件第一次 load 时自动迁移。
- **抢占 + 500 ms 批处理** — 快速连发的消息合并为一次 CLI 调用，不会重复 spawn。引用回复 anchor 到 batch 里最新一条消息。
- **跨消息续 session** — 通过 CLI 自身的 session id 保留多轮上下文：claude `--session`、codex `exec resume <thread_id>`、gemini `--resume <uuid>`（stream-json + 工具调用渲染与 claude/codex 同等体验）。
- **11 条斜杠命令** — `/help`、`/new`、`/cd`、`/ws`、`/status`、`/stop`、`/timeout`、`/access`、`/sessions`、`/reconnect`、`/doctor`。
- **每 bot 独立访问控制** — 按用户或聊天设白名单；app owner 默认是 admin。
- **崩溃恢复** — 指数退避（1s → 30s）；3 分钟内崩溃 5 次则 worker 被禁用，`lmcb restart <bot>` 重新启用。
- **macOS launchd 守护进程** — `lmcb daemon install` 开机自启。
- **bots 目录热加载** — 编辑 `bots/*.yaml` 后 worker 自动重启（500 ms 防抖）。
- **附件支持** — 图片和文件下载后以 `[Attached <kind>: <abs path>]` 追加到 prompt。
- **SDK 错误完整可见** — Lark SDK 错误通过 pino 输出，使用 `util.inspect({depth: 10})` 序列化，嵌套的 API 错误结构（`field_violations`、`response.data`）完整落入 worker 日志，不再被截断为 `[Object]`。
- 状态存储在 `~/.lark-multi-cli-bridge/`（配置、bot YAML、会话、日志、媒体文件、per-bot `lark-cli` shims）。

## 快速开始

```bash
pnpm install && pnpm build
node ./bin/lmcb.mjs init       # 交互式向导：选后端、扫码、完成
node ./bin/lmcb.mjs start --foreground
```

`init` 向导引导你完成后端选择、bot 命名和应用创建（扫码或粘贴已有凭证）。完成后，在飞书给你的新 bot 发消息即可。

完整教程见：[docs/quickstart.zh.md](docs/quickstart.zh.md)

## Agent Skills（推荐）

bridge 自带一个 agent skill `lark-bridge-overlay`，教 LLM 怎么读 bridge
注入的 `<bridge_context>` / `<quoted_message>` / `<interactive_card>` 块、
`__claude_cb` 按钮回调约定、以及前台阻塞的 OAuth 流程。

它跟上游 `larksuite/cli` 的 26 个 lark-cli skill（lark-im / lark-base /
lark-calendar 等）配套使用——上游教 lark-cli 怎么用，我们的 overlay 教
bridge 里的专属约定。一次装好两层：

```bash
pnpm skills:install -g -y                       # 全局，免确认
UPSTREAM_SKILLS='*' pnpm skills:install -g -y   # 装全部 26 个上游 + overlay
```

默认只装 `lark-im,lark-shared` 这套最小可用集 + 本仓库的 overlay。可以用
`UPSTREAM_SKILLS=lark-im,lark-base,lark-calendar` 自选上游域。详细参数见
[README.md#agent-skills-recommended](./README.md#agent-skills-recommended)。

## 文档

| 文档 | 说明 |
|------|------|
| [docs/quickstart.zh.md](docs/quickstart.zh.md) | 分步骤安装和首次运行 |
| [docs/architecture.zh.md](docs/architecture.zh.md) | 进程拓扑、模块映射、IPC、状态 |
| [docs/adapter-authoring.zh.md](docs/adapter-authoring.zh.md) | 如何添加第 4 种 CLI 后端 |
| [docs/faq.zh.md](docs/faq.zh.md) | 排错与常见问题 |

## 状态

持续开发中。**v0.7.1 已发布**；引用回复、(chatId, botName) 二维 session、gemini 0.44 stream-json、Lark SDK pino 日志、CardKit 2.0 终止按钮修复等一批改动已写入 `[Unreleased]`，待发 v0.7.2——详见 [CHANGELOG.md](CHANGELOG.md)。

在 macOS 上完成人工测试。Linux 支持前台运行；launchd 守护进程仅限 macOS（systemd unit 生成延后）。

## 许可

MIT。见 [LICENSE](LICENSE)。

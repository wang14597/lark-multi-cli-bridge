# lark-multi-cli-bridge (lmcb)

飞书/Lark 聊天桥接，把用户消息路由到 **Claude Code**、**OpenAI Codex CLI** 或 **Google Gemini CLI**，支持在同一台机器上并发运行多个机器人——每个机器人对应一种 CLI 后端。

English: [README.md](README.md)

## 为什么

`lark-channel-bridge` 和 `feishu-claude-code-bridge` 各自只支持一种 CLI 后端。lmcb 填补了这个空白：你可以在同一个 supervisor 下同时跑 `claude-bot`、`codex-bot` 和 `gemini-bot`，各自状态隔离、独立崩溃恢复，共用同一套精美的流式卡片 UI。

## 功能

- **多 bot、多后端** — 一个 supervisor fork 一个 worker per bot；每个 worker 以独立 bot 身份连接 Lark，并 spawn 各自的 CLI。
- **扫码创建 app** — `lmcb init` 默认走二维码流程：用飞书/Lark 移动端扫码，Lark 自动在你的租户下创建内部应用并返回 `app_id`/`app_secret`，无需访问开发者后台。
- **精美流式卡片** — `streaming_mode` 渐进更新；可折叠思考面板；可折叠工具调用面板（3 个以上自动折叠，规避飞书 30 KB 卡片限制）；底部状态栏；终态备注；停止按钮。
- **抢占 + 500 ms 批处理** — 快速连发的消息合并为一次 CLI 调用，不会重复 spawn。
- **每个 chat 的 session 续接** — 通过 CLI 自身的 session id 保留多轮对话上下文。
- **11 条斜杠命令** — `/help`、`/new`、`/cd`、`/ws`、`/status`、`/stop`、`/timeout`、`/access`、`/sessions`、`/reconnect`、`/doctor`。
- **每 bot 独立访问控制** — 按用户或聊天设白名单；app owner 默认是 admin。
- **崩溃恢复** — 指数退避（1s → 30s）；3 分钟内崩溃 5 次则 worker 被禁用，`lmcb restart <bot>` 重新启用。
- **macOS launchd 守护进程** — `lmcb daemon install` 开机自启。
- **bots 目录热加载** — 编辑 `bots/*.yaml` 后 worker 自动重启（500 ms 防抖）。
- **附件支持** — 图片和文件下载后以 `[Attached <kind>: <abs path>]` 追加到 prompt。
- 状态存储在 `~/.lark-multi-cli-bridge/`（配置、bot YAML、会话、日志、媒体文件）。

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

开发中。v0.4.0 已发布，在 macOS 上完成人工测试。Linux 支持前台运行；launchd 守护进程仅限 macOS（systemd 支持延后）。

## 许可

MIT。见 [LICENSE](LICENSE)。

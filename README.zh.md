# lark-multi-cli-bridge (lmcb)

飞书/Lark 聊天桥接，把用户消息路由到 **Claude Code**、**OpenAI Codex CLI** 或 **Google Gemini CLI**，支持在一台机器上并发运行多个机器人——每个机器人对应一种 CLI 后端。

English: [README.md](README.md)

## 功能

- 一个 supervisor 进程为每个 bot fork 一个 worker。Worker 崩溃 → supervisor 用指数退避重启。
- Lark 流式卡片更新（节流：500 ms / 50 字），避免触发 API 限流。
- 抢占 + 500 ms 批处理：快速连发的多条消息合并成一次 CLI 调用，不会破坏对话上下文。
- 每个 chat 的 session 续接基于 CLI 自身的 session id（多轮对话上下文保留）。
- 斜杠命令：`/help`、`/new`、`/cd`、`/ws`、`/status`、`/stop`、`/timeout`、`/access`、`/sessions`、`/reconnect`、`/doctor`。
- 每 bot 独立的访问控制；app owner 默认就是 admin。
- macOS launchd 守护进程开机自启。
- 添加新 CLI 后端的开发指南：`docs/adapter-authoring.md`。

## 架构

```
[supervisor] -- fork --> [worker A: claude-bot] --> spawn `claude`
            \-- fork --> [worker B: codex-bot]  --> spawn `codex`
            \-- fork --> [worker C: gemini-bot] --> spawn `gemini`
```

完整设计文档：[docs/architecture.zh.md](docs/architecture.zh.md)。规范在 `docs/superpowers/specs/`。

## 快速开始

```bash
node ./bin/lmcb.mjs init
```

向导默认走扫码流程：用飞书/Lark 移动端扫描二维码，Lark 会在你的租户下自动创建一个内部应用并返回 `app_id` 和 `app_secret`，bridge 直接写入本地配置——无需访问开发者后台。

如需粘贴已有 `app_id` / `app_secret`，在向导中选择选项 2 即可。

完整教程见 [docs/quickstart.zh.md](docs/quickstart.zh.md)。

## 状态

开发中。M1-M5 五个里程碑代码完成，单元测试齐全；针对真实 Lark bot 的端到端 smoke 测试由用户自行完成。

## 许可

MIT。见 [LICENSE](LICENSE)。

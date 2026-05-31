# 快速开始

## 1. 构建与链接

```bash
git clone <this repo>
cd lark-multi-cli-bridge
pnpm install
pnpm build
npm link   # 把 `lmcb` 命令注册到全局（或直接 `node ./bin/lmcb.mjs`）
```

## 2. 配置第一个 bot

你需要一个 Lark 应用（含 `app_id` + `app_secret`）和绑定到它的机器人身份。

```bash
lmcb bot add claude-bot --app-id cli_xxx --app-secret hex_xxx --backend claude
```

这会写入 `~/.lark-multi-cli-bridge/bots/claude-bot.yaml`。如果你要调整 `access`、`behavior` 或后端特定参数，手工编辑这个文件。

## 3. 启动 supervisor

第一次调试，前台跑：

```bash
lmcb start --foreground
```

在飞书里给 bot 发消息。你应该看到一张流式卡片显示 Claude 的回复。

`Ctrl+C` 停止。

## 4. 升级到后台守护进程 (macOS)

```bash
lmcb start          # 后台模式
lmcb daemon install # 走 launchd 开机自启
```

## 5. 添加更多 bot

```bash
lmcb bot add codex-bot --app-id cli_yyy --app-secret hex_yyy --backend codex
lmcb bot add gemini-bot --app-id cli_zzz --app-secret hex_zzz --backend gemini
```

当你编辑或新增 `bots/` 下的 YAML 时，supervisor 会自动热加载对应的 worker（500 ms 防抖）。

手动重启某个 worker：`lmcb restart codex-bot`。

## 常用命令

| 命令 | 作用 |
|---|---|
| `lmcb ps` | 列出 worker 及状态 |
| `lmcb restart <bot>` | 重启一个 worker |
| `lmcb stop` | 停止 supervisor（连带所有 worker） |
| `lmcb daemon status` | 查看 launchd 状态 |
| `lmcb daemon uninstall` | 移除 launchd plist |

在飞书聊天里，用 `/help` 查所有斜杠命令。

## 排错

- `/doctor`（在 Lark 聊天里）输出 CLI 可用性和当前会话状态。
- 日志在 `~/.lark-multi-cli-bridge/logs/supervisor.log` 和 `~/.lark-multi-cli-bridge/logs/workers/<bot>/YYYY-MM-DD.log`。
- 如果一个 worker 在 3 分钟内崩 5 次会自动 disable，修复后用 `lmcb restart <bot>` 重新启用。

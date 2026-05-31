# 架构

完整规范见 `docs/superpowers/specs/`。本文是摘要。

## 进程拓扑

```
                    用户执行 `lmcb start`
                              |
                              v
                    +---------------------+
                    |     supervisor      |  主进程
                    |  - 读 bots/*.yaml   |
                    |  - 持有 ipc.sock    |
                    +----------+----------+
                               |
        +------- fork ---------+--------- fork -------+
        |                      |                      |
        v                      v                      v
   +----------+          +----------+           +----------+
   | worker A |          | worker B |           | worker C |
   | claude   |          | codex    |           | gemini   |
   +-----+----+          +-----+----+           +-----+----+
         |                     |                      |
   Lark WS               Lark WS                Lark WS
         |                     |                      |
    spawn `claude`        spawn `codex`         spawn `gemini`
    (每条消息独立 spawn)  (每条消息独立 spawn)  (每条消息独立 spawn)
```

## 关键模块

| 模块 | 职责 |
|---|---|
| `src/cli/` | `lmcb` 入口，通过 unix socket 把子命令转发给 supervisor |
| `src/supervisor/` | fork worker、IPC server、崩溃预算 |
| `src/worker/` | 单 bot 生命周期：Lark → dispatcher → adapter → 流式卡片 |
| `src/lark/` | Lark SDK 封装：WS、消息解析、卡片构造、附件下载 |
| `src/adapters/` | `ClaudeAdapter` / `CodexAdapter` / `GeminiAdapter`（流式 `Adapter` 接口） |
| `src/commands/` | 斜杠命令路由 + handlers |
| `src/session/` | `SessionStore` + `WorkspaceStore`，原子文件落盘 |
| `src/auth/` | 访问控制规则 |
| `src/daemon/` | macOS launchd plist 生成 |
| `src/config/` | YAML 加载、zod schema、bots 目录监听 |
| `src/telemetry/` | pino + pino-roll 结构化日志 |

## 适配器事件流

三种适配器都通过 `run(ctx)` 暴露 `AsyncIterable<AdapterEvent>`。事件类型：

- `session-start`——CLI 启动，session id 拿到了
- `text-delta`——增量文本
- `tool-call` / `tool-result`——CLI 调了一个工具
- `thinking`——CLI 在思考（目前仅 claude）
- `error`——可恢复或致命错误
- `done`——最终文本 + token 用量

Worker 的 `Dispatcher` 把事件喂给 `CardStreamer`，由后者把更新节流推到 Lark 卡片。

## IPC

- supervisor ↔ `lmcb` CLI：unix socket 在 `~/.lark-multi-cli-bridge/ipc.sock`，按行分割的 JSON-RPC。
- supervisor ↔ worker：Node 内置的 `child_process.fork()` IPC channel，消息类型有 `ready` / `shutdown` / `reload-config`。

## 磁盘状态

```
~/.lark-multi-cli-bridge/
├── config.yaml
├── bots/<name>.yaml          （chmod 600）
├── state/sessions.json       （原子写）
├── state/workspaces.json
├── state/processes.json
├── logs/supervisor.log
├── logs/workers/<bot>/YYYY-MM-DD.log
├── media/<chat_id>/<file>    （附件——永久保留，手动清理）
└── ipc.sock
```

# 架构

English: [architecture.md](architecture.md)

完整规范见 `docs/superpowers/specs/`。本文是更新至 v0.4.0 的工作摘要。

## 进程拓扑

```
                用户执行 `lmcb start`
                          |
                          v
                +---------------------+
                |     supervisor      |  主进程
                |  - 读 bots/*.yaml   |
                |  - 持有 ipc.sock    |
                |  - 写 processes     |
                +----------+----------+
                           |
      +------- fork -------+-------- fork -------+
      |                    |                     |
      v                    v                     v
 +----------+        +----------+          +----------+
 | worker A |        | worker B |          | worker C |
 | claude   |        | codex    |          | gemini   |
 +-----+----+        +-----+----+          +-----+----+
       |                   |                     |
 Lark WS              Lark WS               Lark WS
       |                   |                     |
 spawn `claude`      spawn `codex`         spawn `gemini`
 (每条消息独立)       (每条消息独立)        (每条消息独立)
```

每个 worker 以独立 bot 身份维持持久的 Lark WebSocket 长连接。消息处理完全在 worker 进程内完成——supervisor 不感知消息内容。

## 模块映射

| 模块（`src/`） | 职责 |
|----------------|------|
| `cli/` | `lmcb` 入口；通过 Unix socket 把子命令转发给 supervisor |
| `supervisor/` | fork worker、IPC server、崩溃预算、日志聚合 |
| `worker/` | 单 bot 生命周期：Lark 事件 → dispatcher → adapter → 流式卡片 |
| `lark/` | Lark SDK 封装：WebSocket、消息解析、`card-builder.ts`、`run-state.ts`、`tool-render.ts`、附件下载 |
| `adapters/` | `ClaudeAdapter` / `CodexAdapter` / `GeminiAdapter`，实现 `AsyncIterable<AdapterEvent>` |
| `commands/` | 斜杠命令路由 + handler（11 条命令） |
| `session/` | `SessionStore` + `WorkspaceStore`，原子文件落盘 |
| `auth/` | 访问控制规则；`register-app.ts` 实现扫码创建应用 |
| `daemon/` | macOS launchd plist 生成 |
| `config/` | YAML 加载、zod schema 校验、bots 目录监听与热加载 |
| `telemetry/` | pino + pino-roll 结构化日志 |
| `util/` | 原子文件写、重试辅助、异步迭代器工具、信号管道 |

v0.4.0 在 `src/lark/` 中新增的关键文件：

- **`run-state.ts`** — `RunState` 数据模型 + 变更辅助函数（跟踪 blocks、reasoning、tools、terminal 标志、footer 文本）。
- **`tool-render.ts`** — `toolHeaderText` / `toolBodyMd` 工具调用面板渲染辅助。
- **`card-builder.ts`** — `renderRunCard` 重写，对齐 `feishu-claude-code-bridge` 的精美风格：无头部栏、`streaming_mode` 切换、可折叠思考面板和工具面板、底部状态栏、终态备注、停止按钮。

## 适配器事件流

卡片按钮点击（如 ⏹）通过 Lark 的 `card.action.trigger` 事件下发，由 `src/lark/card-action.ts` 解析后路由到 `dispatcher.abort(chatId)`。`LarkWsClient` 会发出一个类型化的 `'card-action'` 事件，worker 在经过与入站消息相同的访问控制检查后进行消费。

所有适配器通过 `run(ctx)` 暴露 `AsyncIterable<AdapterEvent>`。判别联合类型共有 **7 个变体**：

| 事件 | 触发时机 |
|------|----------|
| `session-start` | CLI 子进程启动，session id 已知 |
| `text-delta` | 增量助手文本块 |
| `tool-call` | CLI 调用了工具（名称 + 输入） |
| `tool-result` | 工具返回了结果 |
| `thinking` | CLI 正在推理（Claude 专有；触发可折叠思考面板） |
| `error` | CLI 产生了可恢复或致命错误 |
| `done` | CLI 完成；最终文本 + token 用量 |

Worker 的 `Dispatcher` 把事件喂给 `CardStreamer`，后者以 500 ms 或 50 字（先到者触发）节流推送 Lark 卡片补丁。

## 流式卡片状态机

`RunState`（位于 `src/lark/run-state.ts`）跟踪单次流式响应的可变状态：

| 字段 | 说明 |
|------|------|
| `blocks` | 已渲染 Markdown 文本块的有序列表 |
| `reasoning` | 累积的思考文本（显示在可折叠面板中） |
| `tools` | 工具调用面板数组（标题 + 正文）；3 个以上自动折叠旧面板 |
| `terminal` | 运行是否已结束（将卡片切出 `streaming_mode`） |
| `footer` | 显示在卡片底部的状态行 |
| `stopButton` | 停止按钮是否可见 |

`terminal` 变为 true 后，卡片以终态备注收尾并移除停止按钮。

为避免超过飞书单个元素约 30 KB 的限制，工具面板在 3 个以上时自动折叠旧条目。完整工具细节始终可在 worker 日志文件中查看。

## IPC 机制

**supervisor ↔ `lmcb` CLI：**
- Unix socket 路径：`~/.lark-multi-cli-bridge/ipc.sock`
- 按行分割的 JSON-RPC（请求/响应对）
- 支持方法：`start`、`stop`、`ps`、`restart`、`reload`

**supervisor ↔ worker：**
- Node 内置的 `child_process.fork()` IPC channel
- 消息类型：`ready`、`shutdown`、`reload-config`

## 磁盘状态

```
~/.lark-multi-cli-bridge/
├── config.yaml                         （全局配置）
├── bots/<name>.yaml                    （per-bot 配置，chmod 600）
├── state/sessions.json                 （原子写）
├── state/workspaces.json
├── state/processes.json
├── logs/supervisor.log
├── logs/workers/<bot>/YYYY-MM-DD.log   （按日轮转）
├── media/<chat_id>/<file>              （附件——永久保留）
└── ipc.sock                            （正常关闭后删除）
```

## 崩溃恢复

- 退避策略：1s、2s、5s、15s、30s（指数）。
- 预算：3 分钟内崩溃 5 次 → worker 被禁用；需手动 `lmcb restart <bot>` 重新启用。
- supervisor 本身不自动重启；supervisor 退出则所有 worker 一并退出（由 launchd 或用户重启 supervisor）。

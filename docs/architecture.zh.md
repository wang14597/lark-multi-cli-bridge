# 架构

English: [architecture.md](architecture.md)

完整规范见 `docs/superpowers/specs/`。本文是更新至 v0.7.1 的工作摘要。逐次变更历史见 [docs/changes/](changes/INDEX.md)。

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

每个 worker 以独立 bot 身份维持持久的 Lark WebSocket 长连接。消息处理完全在 worker 进程内完成——supervisor 不感知消息内容。连接启用了 SDK 的 pong 存活看门狗（`wsConfig.pingTimeout: 3`）：半开 socket（空闲窗口内服务端侧断开）在 ping 发出 3 秒无回应后被 terminate，从而触发 SDK 自动重连；重连过程以 warn 级别记录日志。不传这个参数时看门狗是空操作，死连接会让 bot 在飞书侧"离线"（卡片按钮失效、消息被丢弃），直到重启才恢复。

### lmcb 如何为 lark-cli 子进程隔离 bot 身份

LLM 子进程（claude / codex / gemini）通常会调用 `lark-cli` 来发消息、列群成员等。
每个 lmcb bot 需要使用自己的 Lark app 身份——若不做隔离，每个 bot 都会悄悄借用
本机当前默认的 `lark-cli` profile，造成 bot 之间的身份串号。

lmcb 通过一个 **PATH shim** 来锁定身份：

1. worker 启动时，`ensureLarkProfile(bot)` 以 bot 的 `app_id` 为名幂等注册一个
   `lark-cli profile`（使用 `--app-secret-stdin`，确保 secret 不出现在 argv 里）。
2. `provisionLarkShim(bot)` 在 `~/.lark-multi-cli-bridge/shims/<bot>/lark-cli`
   写入一个可执行包装脚本，内部 `exec` 真实的 `lark-cli` 二进制并强制带上
   `--profile <app_id>` 参数。
3. dispatcher 把 `PATH=<shim-dir>:$PATH` 注入到每个 LLM 子进程，子进程里所有
   `lark-cli` 调用都会透明地走到正确的 profile。

此前曾尝试通过 `LARKSUITE_CLI_APP_ID/SECRET/BRAND` 环境变量注入实现隔离
（commit ae97924），但在 lark-cli 1.0.43 中证实不可行：这些环境变量虽然被
识别，但永远换不出可用的 bot token。

## 模块映射

| 模块（`src/`） | 职责 |
|----------------|------|
| `cli/` | `lmcb` 入口；通过 Unix socket 把子命令转发给 supervisor |
| `supervisor/` | fork worker、IPC server、崩溃预算、日志聚合 |
| `worker/` | 单 bot 生命周期：Lark 事件 → dispatcher → adapter → 流式卡片 |
| `lark/` | Lark SDK 封装：WebSocket、消息解析、`card-builder.ts`、`markdown-normalize.ts`、`run-state.ts`、`tool-render.ts`、附件下载 |
| `adapters/` | `ClaudeAdapter` / `CodexAdapter` / `GeminiAdapter`，实现 `AsyncIterable<AdapterEvent>` |
| `commands/` | 斜杠命令路由 + handler（11 条命令） |
| `session/` | `SessionStore` + `WorkspaceStore`，原子文件落盘 |
| `auth/` | 访问控制规则；`register-app.ts` 实现扫码创建应用 |
| `daemon/` | macOS launchd plist 生成 |
| `config/` | YAML 加载、zod schema 校验、bots 目录监听与热加载 |
| `telemetry/` | pino + pino-roll 结构化日志 |
| `util/` | 原子文件写、重试辅助、异步迭代器工具、信号管道 |

## 支持的消息类型

`src/lark/message-parse.ts` 将 Lark 所有 `message_type` 变体统一规范化为一个 `{ text, attachments }` 对，再传递给适配器：

| `message_type` | Prompt 输出 |
|----------------|------------|
| `text` | 原始 `.text` 字段 |
| `post`（富文本） | 展平为 Markdown——`@name`、`[文字](url)`、`` `code` ``、代码块、多段落以 `\n` 拼接。内联图片追加 `RawAttachment` 并在文本中插入 `[image]` |
| `image` | 空文本 + `RawAttachment`（下载后注入为 `[Attached image: …]`） |
| `file` | 空文本 + `RawAttachment`（下载后注入为 `[Attached file: …]`） |
| `merge_forward` | `[merge_forward N messages]` 标记（完整展平待后续实现——TODO） |
| `audio` | `[audio N seconds]` 或 `[audio]` 标记（Lark 不提供转写文本） |

`extractPromptFromContent(messageType, content, mentions)` 纯函数负责消息类型到文本的转换，可独立测试。

v0.4.0 在 `src/lark/` 中新增的关键文件：

- **`run-state.ts`** — `RunState` 数据模型 + 变更辅助函数（跟踪 blocks、reasoning、tools、terminal 标志、footer 文本）。
- **`tool-render.ts`** — `toolHeaderText` / `toolBodyMd` 辅助；`toolHeaderText` 输出统一的单行 `✅ **Tool** — summary` 格式，被 blockquote 渲染路径复用。
- **`card-builder.ts`** — `renderRunCard` 构建流式卡片：无头部栏、`streaming_mode` 切换、可折叠思考面板、**基于 blockquote 的工具调用列表**（详见下文"工具调用渲染"）、底部状态栏、终态备注、停止按钮。正文文本块在输出前会经过 `normalizeMarkdown`。
- **`markdown-normalize.ts`** — `normalizeMarkdown(md)`：把飞书 `markdown` 组件分隔块级内容所需的空行补回（标题/列表/引用/代码围栏前后、正文行之间），让密集的单换行 agent 输出（尤其 codex）不再糊成一片。围栏代码原样透传、表格行保持紧凑、连续空行折叠、幂等。

## 适配器事件流

卡片按钮点击通过 Lark 的 `card.action.trigger` 事件下发，由 `src/lark/card-action.ts` 解析后，在经过与入站消息相同的访问控制检查后，交给 `makeCardActionHandler`（`src/worker/card-action-handler.ts`）处理。handler 分三个优先级：

1. **LLM 回调**（`value.__claude_cb === true`）——以合成的 `[card-click] {…}` prompt 续上 LLM 会话（marker 已剥离）。
2. **运行中停止**（`value.cmd === 'stop'`）——直接调用 `dispatcher.abort(chatId)`；必须在流式过程中也能生效。
3. **内部命令按钮**（`new` / `status` / `help` / `ws.list` / `ws.use` / `ws.remove`）——`cmdToCommand` 把按钮的 `cmd` 翻译成**结构化** `{ name, args }`（如 `ws.use` + `value.name` → `{ name: 'ws', args: ['use', <name>] }`），再由 worker 注入的 `dispatchCommand`（由 `src/worker/dispatch-command.ts` 的 `makeDispatchCommand` 构建）通过 `router.dispatchParsed` 走**与键入 `/command` 完全相同的 `CommandRouter`** 执行，`reply`/`replyCard` 指向点击所在的 chat，admin 身份按点击者的 `open_id` 重新计算。因此「点按钮」和「键入命令」共用一份实现。以结构化方式承载命令（而非再序列化成 slash 字符串），含空白字符的工作空间名才能命中精确目标，而不是被截断成前缀。`dispatchCommand` 内部出错时会发一条尽力而为的 `⚠️ command failed: …` 兜底回复，而不是变成静默的「死按钮」。未知 `cmd`（或未接 `dispatchCommand`）则记日志后空操作。

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
| `tools` | 工具调用数组；统一渲染成一个 markdown blockquote 元素，每个工具一行 |
| `terminal` | 运行是否已结束（将卡片切出 `streaming_mode`） |
| `footer` | 显示在卡片底部的状态行 |
| `stopButton` | 停止按钮是否可见 |

`terminal` 变为 true 后，卡片以终态备注收尾并移除停止按钮。

### 工具调用渲染

连续的工具调用合并到一个 markdown **blockquote** 元素中（每行一个工具），让卡片视觉上保持轻盈：

```
> ✅ **Read** — src/lark/card-builder.ts
> ❌ **Bash** — pnpm test
> ↳ AssertionError: expected foo to equal bar
> ✅ **Write** — src/lark/card-builder.ts
```

两个例外会让工具被单独提升为视觉块：

- **失败的工具** 把首行非空输出渲染为同 blockquote 内的 `↳` 跟随行（截断到 150 字符；完整堆栈仍在 worker 日志）。
- **运行尚未结束时最后一个工具** 渲染为一个灰色 `collapsible_panel`，含 live `_运行中…_` body，让长任务可观察。该工具结束后会回退到 blockquote 单行。

工具完整 input + output 不在卡片中展示——查看请到 `~/.lark-multi-cli-bridge/logs/workers/<bot>/YYYY-MM-DD.log`。

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
├── state/sessions.json                 （原子写；按 (chatId,botName)：backend/cwd/sessionId/messageCount + 可选 idleTimeoutMs，即 /timeout 覆盖值）
├── state/workspaces.json
├── state/processes.json
├── logs/supervisor.log
├── logs/workers/<bot>/YYYY-MM-DD.log   （按日轮转）
├── media/<chat_id>/<file>              （附件——永久保留）
├── shims/<bot>/lark-cli                （per-bot PATH shim，0755）
└── ipc.sock                            （正常关闭后删除）
```

## 崩溃恢复

- 退避策略：1s、2s、5s、15s、30s（指数）。
- 预算：3 分钟内崩溃 5 次 → worker 被禁用；需手动 `lmcb restart <bot>` 重新启用。
- supervisor 本身不自动重启；supervisor 退出则所有 worker 一并退出（由 launchd 或用户重启 supervisor）。

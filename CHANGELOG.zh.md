# 变更日志

本项目所有重要变更均记录在此。格式参考 [Keep a Changelog](https://keepachangelog.com)。

English: [CHANGELOG.md](CHANGELOG.md)

## [未发布]

### 新增

- **每轮第一张卡片现在以「引用回复」形式回复用户消息。** 通过 `im.message.reply` 以用户的 `message_id` 作 anchor 发送，卡片渲染在 `回复 <user>:` 引用块下方，原消息出现 `N 条回复` 角标——群聊中更清楚卡片回应的是哪条消息。合成事件（`__claude_cb` 卡片按钮回调）仍走普通发送，因为它们没有真实用户消息可以 anchor。
- **Gemini 0.44 stream-json 适配器**，支持增量文本流、tool-call/result 渲染、UUID-based session 续接。从此前的「每次 fresh」适配器无缝升级：gemini bot 现在能逐 chunk 流式输出到卡片、显示工具调用（`✅ list_directory — ...`）、跨消息保留对话上下文，与 claude / codex bot 同等体验。

### 变更

- **SessionStore 现在按 (chatId, botName) 二维存储**，不再仅按 chat。同一个聊天若被多个 bot 服务（如群内同时有 `claude-bot` + `codex-bot`），每个 bot 各自独立维护 `sessionId` / `cwd`。旧版 v1 文件（`chats[chatId]` = ChatSession）在第一次 `load()` 时自动迁移为 v2（`chats[chatId][botName]` = ChatSession）并写回，无需手动清理。Store API 现在接受 `botName` 参数——`get(chatId, botName)` / `reset(chatId, botName)` / `setCwd(chatId, botName, cwd, reset)`；`list()` 返回扁平化的 `{chatId, botName, session}` 数组。
- **Lark SDK 错误日志完整展开，不再被截断为 `[Object]` / `[Array]`。** 新增 `adaptLarkLogger(pinoLogger)` 适配器，把 SDK 日志通过 pino 输出，使用 `util.inspect({depth: 10})` 序列化，嵌套的 API 错误结构（`field_violations`、`config`、`response.data`）完整落入 worker 日志。worker 把这个 logger 同时注入 `Lark.Client` 与 `Lark.WSClient`。

### 修复

- **卡片按钮不再因一次网络抖动就死于"目标回调服务当前未在线"。** worker 的 Lark WebSocket 可能变成半开连接（空闲窗口内服务端侧断开；NAT/代理空闲回收），而 SDK 毫无感知：其 pong 存活看门狗是 opt-in 的，`LarkWsClient` 没传 `wsConfig.pingTimeout`，导致 `readyState` 一直 `OPEN`、`close`/`error` 不触发、自动重连永不启动，飞书侧判定 app 离线，只能手动重启恢复。现在 `WSClient` 构造时传入 `wsConfig: { pingTimeout: 3 }`（ping 发出 3 秒无回应即 terminate 并重连）、`handshakeTimeoutMs: 8000`（握手快速失败），并以 warn 级别记录 `onReconnecting`/`onReconnected`，之后再掉线在 worker 日志里可见。详见 [docs/changes/2026-06-03-ws-ping-timeout-watchdog.zh.md](docs/changes/2026-06-03-ws-ping-timeout-watchdog.zh.md)。
- **跨 bot session 串号（根因修复）**：`claude-bot` 的 session UUID 被传给 codex 的 `exec resume`，导致后者立即报 `thread/resume: no rollout found for thread id <id>`——该聊天对第二个 bot 实际被锁死，必须 `/new` 才能恢复。上述按 (chatId, botName) 隔离的 SessionStore 改造从源头消除了这种串号，`claude-bot` 的 UUID 永远不会被 `codex-bot` 看到，即使两者共用一个聊天。
- **Gemini CLI 0.42+ 参数兼容**：`--prompt-interactive=false` 被 0.42 yargs 解析为「设置 `-i` 为 'false'」，与 `-p` 冲突报错 `Cannot use both --prompt and --prompt-interactive together`；`--chat-id` 在 0.42 已完全移除（由 `--resume` 替代）。两个 flag 都已从适配器中删除。
- **Gemini agent-loop 的工具事件不再让卡片卡死在 `🧠 正在思考`。** 初版 0.44 parser 只处理 `init` / `message` / `result`，但 gemini-cli 默认是 agentic 的，每次内部工具调用（`list_directory`、`google_web_search` 等）都会发 `tool_use` / `tool_result` 行。Parser 现在把 `tool_use → tool-call`、`tool_result → tool-result` 映射出来，卡片流就能实时渲染整个 agent loop。
- **⏹ 终止按钮（以及所有走内置命令路由的卡片按钮）不再静默失效。** CardKit 2.0 卡片（bridge 从 v0.4.0 起一直渲染的就是这个 schema）在 `card.action.trigger` 事件里把 `open_chat_id` / `open_message_id` 嵌在 `event.context` 下，而 parser 只查顶层，返回 `undefined`，`ws.ts` 的 `if (parsed) emit` 静默吞掉点击——worker 日志里一条记录都没有。`parseCardActionEvent` 现在在顶层 / snake_case 两条 fallback 之后再回退到 `event.context.*`（与 SDK 自家 `normalizeCardAction` 对齐）。Defense in depth：`ws.ts` 现在在 parser 返回 `undefined` 时通过 `opts.logger` 输出 warn 日志，未来 Lark 再改 schema 会落成 `[ws] card.action.trigger unparseable` 而不是死按钮。

### 内部

- 新增 `src/lark/sdk-logger.ts` —— 实现 Lark SDK `Logger` 接口，转发到 pino 并完整展开对象。
- 在 `src/adapters/gemini.ts` 中新增导出 `parseGeminiJsonLine`，与适配器并列（可独立单测）。
- 新增测试 fixture：`tests/adapters/__fixtures__/gemini/stream-json-{simple,tools}.jsonl`，以及 `tests/worker/lark-sink.test.ts`（同时覆盖 reply 与顶层 `im.message.create` 两条分支）。
- **每次变更随附文档的追踪约定。** 新增根目录 `CLAUDE.md`,规定每个逻辑变更都要在 `docs/changes/` 下产出双语文档;新增 `docs/changes/{TEMPLATE,INDEX}.{md,zh.md}` 以及强制的 `architecture.md` 同步规则。顺手刷新 `architecture.md` 版本标注(v0.4.0 → v0.7.1)。详见 [docs/changes/2026-06-02-introduce-change-tracking.zh.md](docs/changes/2026-06-02-introduce-change-tracking.zh.md)。

## [v0.7.1] - 2026-06-02

### 修复

- **多 bot 场景下 lark-cli 身份正确隔离。** 上一版引入的 `LARKSUITE_CLI_APP_ID/SECRET/BRAND` 环境注入方案（v0.7.0）在 lark-cli 1.0.43+ 上其实不工作：这些 env 变量进入"external credentials"模式但永远换不出可用的 bot token，每个 bot 都会悄悄退回到本机 `lark-cli auth login` 留下的默认 profile。新方案：worker 启动时 `ensureLarkProfile(bot)` 为每个 bot 注册 `lark-cli profile`（走 `profile add --app-secret-stdin`，secret 不进 argv），`provisionLarkShim(bot)` 在 `~/.lark-multi-cli-bridge/shims/<bot>/lark-cli` 写出 PATH shim 强制带上 `--profile <app_id>`，dispatcher 把该 shim 目录前置到每个 LLM 子进程的 `PATH`。多 bot 部署下所有 `lark-cli` 调用都透明绑定到正确身份。详见 `docs/architecture.zh.md` → "lmcb 如何为 lark-cli 子进程隔离 bot 身份"。
- **`lark-cli profile list` 在 1.0.43/1.0.45 不再因 `unknown flag: --format` 失败** —— `profile list` 默认就吐 JSON，根本没有 `--format` flag。

### 变更

- **工具调用渲染从「每工具一个折叠面板」改为「单一 blockquote 列表」。** 每个工具渲染为 `> ✅ **Tool** — summary`，连续工具共享同一个 blockquote 元素。失败的工具留在 blockquote 内（`> ↳ <首行输出>`，截断 150 字符）——不再有红框面板。运行中的最后一个工具仍保留一个灰色 live `_运行中…_` 面板，让长任务可观察。完整工具明细（input + output、堆栈）查 worker 日志。详见 `docs/architecture.zh.md` → "工具调用渲染"。

### 内部

- 新增 `src/lark/lark-cli-provision.ts`（profile 幂等注册、shim 写入、`resolveRealLarkCli` 通过 `path.resolve` 归一拒绝 shim 递归调用、内置 `which` helper）。
- `paths.shimsDir(botName)` 和 `paths.shimsRoot` 走 `LMCB_HOME`，沙箱运行和测试隔离不受影响。
- Shim 内部使用单引号 `exec '<path>' --profile '<app_id>' "$@"`，防止 `app_id` 或二进制路径含 `'` / `\n` 时的注入。
- `Dispatcher.extraEnv` 的 JSDoc 与 `tests/worker/dispatcher-extra-env.test.ts` 顶部注释更新为 PATH shim 模型（旧版指向 `LARKSUITE_CLI_*`）。

## [v0.5.2] - 2026-06-01

### 修复

- **群内 `@bot + 多行文本` 不再静默丢弃。** Lark 会将此类消息从 `text` 自动升级为 `post`（富文本）；原解析器对 `post` 返回空字符串，导致 worker 静默忽略消息。`extractPromptFromContent` 现在将 `post` 展平为 Markdown（段落用 `\n` 拼接、`@name`、`[文字](url)`、行内代码、代码块）。
- **per-chat session 隔离** 本身已通过 `chat_id` 为键实现；上述修复使新群聊 session 能真正创建（之前因空文本检查被拦截，session 始终未生成）。

### 新增

- `extractPromptFromContent(messageType, content, mentions)` — 纯函数，处理所有 Lark 消息类型，可独立测试。
- `post` 内联 `img` 标签会追加 `RawAttachment` 并在文本中插入 `[image]`。
- `audio` 消息生成 `[audio N seconds]` / `[audio]` 标记，避免静默丢弃。
- `merge_forward` 消息生成 `[merge_forward N messages]` 标记（完整展平内部消息需额外 Lark API 调用，列为 TODO）。
- 消息处理器顶部添加 `log.info({ chatId, chatType, sender }, 'message received')` 日志，便于生产环境验证 per-chat session 隔离。

## [v0.5.1] - 2026-06-01

### 新增

- **卡片按钮回调处理**：点击流式卡片上的 ⏹ 按钮，现在会触发 `dispatcher.abort(chatId)` 并终止正在运行的任务。
- `src/lark/card-action.ts` — `parseCardActionEvent` + `CardActionEvent` 类型，支持防御性双形状解析（`open_chat_id` / `chat_id` 兜底）。
- `LarkWsClient` 在 `im.message.receive_v1` 之外新增注册 `card.action.trigger`，并发出类型化的 `'card-action'` 事件。
- Worker 监听 `'card-action'`，将 `cmd: 'stop'` 通过与入站消息相同的访问控制门后路由处理。

## [v0.4.0] - 2026-05-31

### 变更

- **流式卡片 UI 重写**，对齐 `feishu-claude-code-bridge` 的精美风格：无头部栏、`streaming_mode` 切换、可折叠思考面板 + 工具面板、底部状态栏、终态备注、停止按钮。

### 新增

- `src/lark/run-state.ts` — RunState 数据模型 + 变更辅助函数。
- `src/lark/tool-render.ts` — 工具面板渲染用的 `toolHeaderText`/`toolBodyMd`。
- `CardStreamer.onThinkingDelta`，为未来对接思考事件做准备。

### 内部实现

- 工具组在 3 个以上调用时自动折叠（每个飞书元素 ≤30 KB）。

## [v0.3.0] - 2026-05-31

### 新增

- **`lmcb init` 扫码创建应用流程**，通过 `@larksuiteoapi/node-sdk` 的 `registerApp` 实现。用户用飞书/Lark 移动端扫码，Lark 自动在其租户下创建内部应用并直接返回 `app_id`/`app_secret`。
- `qrcode-terminal` 依赖，用于在终端中渲染二维码。
- `src/auth/register-app.ts`，暴露 `scanRegisterApp()`。
- `lmcb bot add --tenant <lark|feishu>` 参数。

### 变更

- `lmcb init` 的应用创建方式默认为扫码；手动粘贴为选项 2。
- 文档更新以突出扫码创建流程。

## [v0.2.0] - 2026-05-31

### 新增

- `lmcb init` 交互式向导，用于首次配置。引导用户完成：选后端 → 命名 bot → 输入 app_id/secret → 写入 YAML，并可循环添加多个 bot。

## [v0.1.0] - 2026-05-31

首次发布。实现计划 M1-M5 全部完成。

### 新增

- 3 种适配器（Claude / Codex / Gemini），采用流式 `AdapterEvent` 接口。
- Supervisor + per-bot worker，含崩溃预算和指数退避。
- Unix socket JSON-RPC IPC（`lmcb start/stop/ps/restart/reload`）。
- 11 条斜杠命令（`/help`、`/new`、`/cd`、`/ws`、`/status`、`/stop`、`/timeout`、`/access`、`/sessions`、`/reconnect`、`/doctor`）。
- 访问控制，app owner 隐式拥有 admin 权限。
- macOS launchd 守护进程（`lmcb daemon install/uninstall/status`）。
- 流式卡片节流更新（500 ms / 50 字）。
- 抢占 + 500 ms 批处理（快速连发消息合并）。
- 通过 CLI 自身 session id 实现每个 chat 的对话续接。
- 附件下载（图片 + 文件），以 `[Attached <kind>: <abs path>]` 形式追加到 prompt。
- `bridge_context` / `quoted_message` / `interactive_card` 注入（兼容 `lark-channel-bridge` 约定）。
- E2E 测试脚手架。
- bots 目录热加载（500 ms 防抖）。
- 通过 Lark SDK 发现 app owner。
- README + quickstart + architecture + adapter-authoring + FAQ（中英双语）。
- MIT 许可证。

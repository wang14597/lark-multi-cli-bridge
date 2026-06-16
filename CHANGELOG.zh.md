# 变更日志

本项目所有重要变更均记录在此。格式参考 [Keep a Changelog](https://keepachangelog.com)。

English: [CHANGELOG.md](CHANGELOG.md)

## [未发布]

### 新增

- **运行卡片改为全宽，长回答支持折叠。** `renderRunCard` 设置 `config.width_mode: 'fill'`，让卡片横跨整个聊天窗格，而非默认的偏窄宽度。超过 10 行原始文本的回答块被包裹进默认展开的 `collapsible_panel`（正常字号，标题固定为 `📄 回答（点击可折叠）`），用户可通过飞书原生箭头折叠——短回答（≤ 10 行）与命令卡片不受影响，无配置 schema 变更。见 [docs/changes/2026-06-13-card-rendering-improvements.zh.md](docs/changes/2026-06-13-card-rendering-improvements.zh.md)。

## [v0.8.0] - 2026-06-09

### 新增

- **Codex bot 默认绕过 OS 沙箱，与 claude 的全访问默认对齐。** 有用户在 codex bot 上撞到「sandbox 无法访问网络 / 不能 `git push` / 不能跑 `lark-cli`」，而同机的 claude bot 全都能——这是适配器默认档的不对称，并非功能缺失：`ClaudeAdapter` 默认 `--permission-mode bypassPermissions` 启动，而 `CodexAdapter` 没传任何沙箱 flag，落回 codex 自带 OS 沙箱（Apple Seatbelt / Landlock），默认禁止联网、只许写工作目录。新增 `codex.bypass_sandbox` 开关（**默认开**），让 `CodexAdapter` 传 `--dangerously-bypass-approvals-and-sandbox` 以对齐。带去重守卫：当 `extra_args` 已含沙箱/审批 flag（`--sandbox`/`-s`、`--ask-for-approval`/`-a`、`--full-auto`、`--yolo` 或 bypass flag 本身）时不再自动叠加，以运维显式选择为准。默认值落在适配器层（`bypassSandbox ?? true`），且 `lmcb bot add` / `lmcb init` 会把 `bypass_sandbox: true` 写进生成的 codex yaml，镜像 claude 的 `permission_mode: bypassPermissions`。设 `bypass_sandbox: false` 可保留 codex 原生沙箱。见 [docs/changes/2026-06-09-codex-sandbox-bypass-default.zh.md](docs/changes/2026-06-09-codex-sandbox-bypass-default.zh.md)。
- **每轮第一张卡片现在以「引用回复」形式回复用户消息。** 通过 `im.message.reply` 以用户的 `message_id` 作 anchor 发送，卡片渲染在 `回复 <user>:` 引用块下方，原消息出现 `N 条回复` 角标——群聊中更清楚卡片回应的是哪条消息。合成事件（`__claude_cb` 卡片按钮回调）仍走普通发送，因为它们没有真实用户消息可以 anchor。
- **Gemini 0.44 stream-json 适配器**，支持增量文本流、tool-call/result 渲染、UUID-based session 续接。从此前的「每次 fresh」适配器无缝升级：gemini bot 现在能逐 chunk 流式输出到卡片、显示工具调用（`✅ list_directory — ...`）、跨消息保留对话上下文，与 claude / codex bot 同等体验。

### 变更

- **卡片正文做 markdown 规范化，密集输出不再糊成一片。** bridge 之前把 agent 正文原样塞进飞书卡片的 `markdown` 组件，而该组件靠空行（`\n\n`）分隔块级内容——于是 codex 后端更密的单换行输出糊成一坨，而 claude 的空行分段则通透。（已确认**不是**「一次性吐出」的问题：参考项目 `zarazhangrui/lark-coding-agent-bridge` 同样把 codex 整段一次性吐出并原样渲染，也没有规范化。）新增 `normalizeMarkdown`（`src/lark/markdown-normalize.ts`）把空行补回——标题前、列表/引用前、正文行之间——同时围栏代码原样透传、靠 GFM 分隔行识别**真表格**（而非见到管道符就算）并保持表体完整、列表项缩进续行与引用惰性续行保持附着（列表不被拆开）；连续空行折叠为一个，且幂等。应用于 `renderRunCard` 的正文文本块；对 claude 无害，对 codex/gemini 是修复。（经 codex 代码审查指出「列表续行被拆」「管道符误判表格」后做了收紧。）详见 [docs/changes/2026-06-05-markdown-normalize.zh.md](docs/changes/2026-06-05-markdown-normalize.zh.md)。
- **Lark SDK 构造经 `baseSdkOptions` 去重。** `createLarkClient` 和 `LarkWsClient` 各拷了一份相同的 `domain` / `loggerLevel` / 条件 `logger` 三元组；现统一展开 `src/lark/sdk-options.ts` 的 `baseSdkOptions(opts)`。behavior-preserving 重构。详见 [docs/changes/2026-06-03-base-sdk-options.zh.md](docs/changes/2026-06-03-base-sdk-options.zh.md)。
- **SessionStore 现在按 (chatId, botName) 二维存储**，不再仅按 chat。同一个聊天若被多个 bot 服务（如群内同时有 `claude-bot` + `codex-bot`），每个 bot 各自独立维护 `sessionId` / `cwd`。旧版 v1 文件（`chats[chatId]` = ChatSession）在第一次 `load()` 时自动迁移为 v2（`chats[chatId][botName]` = ChatSession）并写回，无需手动清理。Store API 现在接受 `botName` 参数——`get(chatId, botName)` / `reset(chatId, botName)` / `setCwd(chatId, botName, cwd, reset)`；`list()` 返回扁平化的 `{chatId, botName, session}` 数组。
- **Lark SDK 错误日志完整展开，不再被截断为 `[Object]` / `[Array]`。** 新增 `adaptLarkLogger(pinoLogger)` 适配器，把 SDK 日志通过 pino 输出，使用 `util.inspect({depth: 10})` 序列化，嵌套的 API 错误结构（`field_violations`、`config`、`response.data`）完整落入 worker 日志。worker 把这个 logger 同时注入 `Lark.Client` 与 `Lark.WSClient`。

### 修复

- **卡片命令按钮改为结构化路由、失败可见。** 上一条卡片按钮修复的代码审查后续：点击不再经 slash 字符串往返（`cmdToSlash` → `/ws use ${name}`）——router 会按空白切词，于是像 `foo bar` 这样的工作空间名被解析成截断前缀 `foo`，若二者同时存在就命中错误目标。现在 `cmdToCommand` 返回结构化 `{name, args}`，由 `CommandRouter.dispatchParsed` 不切词地执行，卡片显示的名字即被使用的名字。点击失败时改为发尽力而为的 `⚠️ command failed: …` 回复（逻辑抽取为 `makeDispatchCommand`），不再只是静默记日志——群聊里 worker log 不可见时也不会再出现死按钮。详见 [docs/changes/2026-06-05-card-action-routing-hardening.zh.md](docs/changes/2026-06-05-card-action-routing-hardening.zh.md)。
- **除 ⏹ 停止外的卡片按钮现在真的会执行。** bridge 渲染的每个交互卡片按钮（`/help`、`/status`、`/ws list` 卡）都带 `value.cmd`，如 `new` / `status` / `help` / `ws.list` / `ws.use` / `ws.remove`，但 `makeCardActionHandler` 只实现了 `stop`——其余点击全落到 `default → log('unknown card action')` 什么都不做，尽管注释写着「internal slash-command buttons (preserved)」。新增纯函数 `cmdToSlash(cmd, value)` 把按钮翻译成 slash 文本（`ws.use` + `value.name` → `/ws use <name>`），注入的 `dispatchCommand` 走**与键入 `/command` 相同的 `CommandRouter`** 执行（admin 按点击者 open_id 重算，reply/replyCard 指向点击所在 chat）。回复闭包抽成共享的 `makeReplies(chatId)`。详见 [docs/changes/2026-06-05-card-action-command-routing.zh.md](docs/changes/2026-06-05-card-action-command-routing.zh.md)。
- **`/timeout <seconds>` 现在真的会改变空闲超时。** 它回复 `timeout override accepted: …s (applies on next run)` 却从不持久化该值，且 `Dispatcher` 构造时没传 `resolveIdleTimeoutMs`，per-chat 覆盖钩子永远是 `undefined`——那句回执是假的。现在覆盖值持久化为可选的 `ChatSession.idleTimeoutMs`（经新增的 `SessionStore.setIdleTimeout`；因是 chat 偏好而非 per-session-id，能在 `/new` 和 `/cd` 后存活），且 `worker/index.ts` 给 dispatcher 传入 `resolveIdleTimeoutMs: (chatId) => sessions.get(chatId, bot.name)?.idleTimeoutMs`——dispatcher 本就优先用覆盖值而非 bot 默认。详见 [docs/changes/2026-06-05-timeout-override-wiring.zh.md](docs/changes/2026-06-05-timeout-override-wiring.zh.md)。
- **`/cd` 路径手误不再用误导性报错拖垮整个聊天。** `/cd <path>` 和 `/new <path>` 原先不检查用户给的 cwd 是否存在就直接落盘；下一次 agent 运行随即报 `failed to spawn codex: spawn codex ENOENT`——Node 对 cwd 不存在和二进制缺失的报错完全相同，把排查方向引向错误的原因。现在两个命令落盘前先 stat 校验，目标不存在或非目录时直接拒绝（`directory does not exist: …` / `not a directory: …`），完全不碰 session store；`spawnWithLifecycle` 对剩余场景（cwd 落盘后被删除）也会报 `directory does not exist: <cwd>`（措辞与命令时一致）指明真实原因。三处重复的 `resolveCwd` 辅助函数收敛到 `src/commands/cwd.ts`。详见 [docs/changes/2026-06-04-cwd-validation-and-spawn-cwd-error.zh.md](docs/changes/2026-06-04-cwd-validation-and-spawn-cwd-error.zh.md)。
- **后台 `lmcb start` 完全无法启动 supervisor。** detached spawn 按**源码**目录结构（`src/cli/commands/`）计算 supervisor 入口路径，但 tsup 把 CLI 压平到 `dist/cli/index.js`，路径解析到 `dist/` 之外，子进程秒死——而且因为 `stdio: 'ignore'` 是静默的，CLI 仍打印 `supervisor started (background)`。现在路径正确指向同级的 `dist/supervisor/index.js`，并在 spawn 前增加守卫：入口不存在时显式报 `supervisor entry not found` 并退出，未来构建布局漂移会立刻暴露。前台模式（`--foreground`）从未受影响。详见 [docs/changes/2026-06-03-fix-daemon-supervisor-path.zh.md](docs/changes/2026-06-03-fix-daemon-supervisor-path.zh.md)。
- **bot self open_id / app owner 解析不再每次启动都失败。** `fetchBotSelfOpenId` 走了 SDK 的裸 `httpInstance`（无鉴权、无 domain baseURL——必然抛错），`fetchAppOwnerOpenId` 漏传 API 必填的 `lang` 参数（400 `lang is required`）。两者静默返回 `undefined`，导致群 @-mention 前缀从未被剥离、app-owner 访问兜底从未生效。现改走鉴权的 `client.request` 并补 `params: { lang }`，按 `owner_id`/`creator_id` 兜底。详见 [docs/changes/2026-06-03-bot-self-open-id-resolution.zh.md](docs/changes/2026-06-03-bot-self-open-id-resolution.zh.md)。
- **`ensureLarkProfile` 在 `profile add` 后校验 profile 真正落盘。** add 是对共享配置文件的读-改-写；兄弟 worker 的并发 add 或配置 home 分叉（`LARK_CHANNEL` / `LARK_CLI_HOME`）可能把它吞掉，而 worker 仍记日志 "provisioned"——问题要到 LLM 每次调 lark-cli 报 `profile not found` 时才暴露。现在 add 后回读列表，任何丢写都变成响亮的启动错误。详见 [docs/changes/2026-06-03-profile-provision-verify.zh.md](docs/changes/2026-06-03-profile-provision-verify.zh.md)。
- **卡片按钮不再因一次网络抖动就死于"目标回调服务当前未在线"。** worker 的 Lark WebSocket 可能变成半开连接（空闲窗口内服务端侧断开；NAT/代理空闲回收），而 SDK 毫无感知：其 pong 存活看门狗是 opt-in 的，`LarkWsClient` 没传 `wsConfig.pingTimeout`，导致 `readyState` 一直 `OPEN`、`close`/`error` 不触发、自动重连永不启动，飞书侧判定 app 离线，只能手动重启恢复。现在 `WSClient` 构造时传入 `wsConfig: { pingTimeout: 3 }`（ping 发出 3 秒无回应即 terminate 并重连）、`handshakeTimeoutMs: 8000`（握手快速失败），并以 warn 级别记录 `onReconnecting`/`onReconnected`，之后再掉线在 worker 日志里可见。详见 [docs/changes/2026-06-03-ws-ping-timeout-watchdog.zh.md](docs/changes/2026-06-03-ws-ping-timeout-watchdog.zh.md)。
- **跨 bot session 串号（根因修复）**：`claude-bot` 的 session UUID 被传给 codex 的 `exec resume`，导致后者立即报 `thread/resume: no rollout found for thread id <id>`——该聊天对第二个 bot 实际被锁死，必须 `/new` 才能恢复。上述按 (chatId, botName) 隔离的 SessionStore 改造从源头消除了这种串号，`claude-bot` 的 UUID 永远不会被 `codex-bot` 看到，即使两者共用一个聊天。
- **Gemini CLI 0.42+ 参数兼容**：`--prompt-interactive=false` 被 0.42 yargs 解析为「设置 `-i` 为 'false'」，与 `-p` 冲突报错 `Cannot use both --prompt and --prompt-interactive together`；`--chat-id` 在 0.42 已完全移除（由 `--resume` 替代）。两个 flag 都已从适配器中删除。
- **Gemini agent-loop 的工具事件不再让卡片卡死在 `🧠 正在思考`。** 初版 0.44 parser 只处理 `init` / `message` / `result`，但 gemini-cli 默认是 agentic 的，每次内部工具调用（`list_directory`、`google_web_search` 等）都会发 `tool_use` / `tool_result` 行。Parser 现在把 `tool_use → tool-call`、`tool_result → tool-result` 映射出来，卡片流就能实时渲染整个 agent loop。
- **⏹ 终止按钮（以及所有走内置命令路由的卡片按钮）不再静默失效。** CardKit 2.0 卡片（bridge 从 v0.4.0 起一直渲染的就是这个 schema）在 `card.action.trigger` 事件里把 `open_chat_id` / `open_message_id` 嵌在 `event.context` 下，而 parser 只查顶层，返回 `undefined`，`ws.ts` 的 `if (parsed) emit` 静默吞掉点击——worker 日志里一条记录都没有。`parseCardActionEvent` 现在在顶层 / snake_case 两条 fallback 之后再回退到 `event.context.*`（与 SDK 自家 `normalizeCardAction` 对齐）。Defense in depth：`ws.ts` 现在在 parser 返回 `undefined` 时通过 `opts.logger` 输出 warn 日志，未来 Lark 再改 schema 会落成 `[ws] card.action.trigger unparseable` 而不是死按钮。

### 内部

- 新增 `pnpm-workspace.yaml`，配置 `allowBuilds: {esbuild: true, protobufjs: true}` —— pnpm 11 移除了 `onlyBuiltDependencies` 且默认禁止所有 postinstall 脚本，全新 checkout 时 `pnpm install`（乃至所有脚本）都会失败。
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

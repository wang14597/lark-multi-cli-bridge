# lark-multi-cli-bridge (lmcb)

**把你本机的 Claude Code / OpenAI Codex / Google Gemini CLI 接到飞书。** 一个轻量 bot：一条命令启动，扫码注册一个 Lark PersonalAgent 应用，然后在飞书里 DM 你的 bot——发截图、传文件、跑脚本、改代码，每一步都在你这台电脑上执行。

English: [README.md](README.md)

## 用起来是什么感觉

你本机已经装好了 `claude` / `codex` / `gemini`。lmcb 把它们包成飞书 bot，让你在手机上随时调度。几个具体场景：

- **堵车里，线上爆了。** 截一张 Sentry 报错图 DM 给 `claude-bot`。claude 在你笔记本上读图、打开出问题的文件、写补丁、流式回到飞书卡片里。
- **离开工位，想看跑测结果。** DM `codex-bot` "跑下 pnpm test 看哪些挂了"。codex 本地跑，挂掉的用例名一行一行流出来。
- **群里跟同事一起 triage。** @ 一下 bot，它通过「引用回复」嵌进消息流，群里所有人看着同一个卡片协作。⏹ 按钮可以中途打断。

CLI 自带的 session id 在消息之间保持不变——claude `--session`、codex `exec resume`、gemini `--resume`——所以多轮上下文自然续上。

## 60 秒上手

```bash
git clone https://github.com/wang14597/lark-multi-cli-bridge.git
cd lark-multi-cli-bridge
pnpm install && pnpm build

node ./bin/lmcb.mjs init             # 交互向导：选后端、扫码、完成
node ./bin/lmcb.mjs start --foreground
```

`init` 引导你走完：
1. **选后端** — `claude` / `codex` / `gemini`（你本机装了哪个就选哪个）。
2. **手机飞书扫码**。Lark 自动在你的租户下创建一个 PersonalAgent 应用，把 `app_id` / `app_secret` 返回给 lmcb。**全程不用开浏览器，不用进开发者后台。**
3. Bot 配置写到 `~/.lark-multi-cli-bridge/bots/<name>.yaml`（chmod 600）。完事就可以 DM bot 了。

完整教程见：[docs/quickstart.zh.md](docs/quickstart.zh.md)

## bot 能帮你做什么

按用户实际用得到的顺序：

- **读你发的图和文件**——截图、PDF、代码文件，全部下载到本地磁盘并以 `[Attached <kind>: <abs path>]` 形式注入到 prompt，CLI 直接用绝对路径 `Read` 即可。
- **改本机文件**——CLI 跑在你的电脑上，文件系统权限照常。用 `/cd <path>` 定 cwd；用 `/ws` 保存和切换命名工作区。
- **流式输出**——文字、工具调用（`> ✅ **Bash** — pnpm test`）、工具失败（同行内 `↳ AssertionError: …`）、思考面板，全部实时流入同一张飞书卡片。⏹ 按钮中途打断；`/stop` 命令等效。
- **引用回复归属清晰**——每轮第一张卡引用用户消息发出，原消息出现 `N 条回复` 角标，卡片渲染在 `回复 <user>:` 块下方——群里再忙也能看清回的是哪条。
- **跨消息记忆上下文**——CLI 自带的 session id 按 chat 持久化，后续问"刚才那个怎么处理"它知道指的是什么。
- **聊天里的斜杠命令**——`/help`、`/new`、`/cd`、`/ws`、`/status`、`/stop`、`/timeout`、`/access`、`/sessions`、`/reconnect`、`/doctor`。
- **群里也能用**——@-mention 触发；可以「引用回复」让 bot 针对某条历史消息处理；bridge 会把 `merge_forward` 转发块展开，bot 看到的就是真实上下文。

## 一个 bot 不够时

设计目标是**一个开发者在自己电脑上的 bots**，不追求 SaaS 体量。在这个范围内可以这样扩：

- **不同后端并存**——`claude-bot` + `codex-bot` + `gemini-bot` 一个 supervisor 全管；各自独立的 Lark 身份、崩溃预算、对话状态。
- **同 backend 多人格**——`claude-personal-bot` + `claude-team-bot` 走两个不同 Lark 应用，各自独立的访问名单和 cwd。
- **同聊天多 bot 互不串号**——SessionStore 按 `(chatId, botName)` 二维存储，claude 的 UUID 和 codex 的 thread_id 永远不会交叉传给对方，一个群里可以并行跟多个 agent 对话。
- **每 bot 独立的 `lark-cli` 身份**——worker 启动时为每个 bot 在 `~/.lark-multi-cli-bridge/shims/<bot>/` 写一个 PATH shim，强制 `lark-cli` 调用带上 `--profile <app_id>`。LLM 子进程随便调 `lark-cli api …`，永远绑到正确 bot 身份，机器上 bot 再多也不会串。

## 运维要点

- **崩溃恢复**——指数退避（1s → 30s）；3 分钟内崩溃 5 次则 worker 被禁用，`lmcb restart <bot>` 重新启用。
- **macOS launchd 守护进程**——`lmcb daemon install` 开机自启。Linux 支持前台运行，systemd unit 生成延后。
- **bots 目录热加载**——编辑 `bots/*.yaml` 后 worker 自动重启（500 ms 防抖）。
- **抢占 + 500 ms 批处理**——快速连发的消息合并为一次 CLI 调用，不会重复 spawn；引用回复 anchor 到 batch 里最新一条。
- **SDK 错误完整可见**——Lark SDK 错误通过 pino 输出，`util.inspect({depth: 10})` 序列化，嵌套的 API 错误（`field_violations`、`response.data`）完整落到 worker 日志，不再被截断为 `[Object]`。
- **每 bot 独立访问控制**——按用户或聊天设白名单；app owner 默认是 admin。
- **状态全在 `~/.lark-multi-cli-bridge/`**——配置、bot YAML、会话（按 (chatId, botName)）、日志、媒体文件、per-bot `lark-cli` shims。

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

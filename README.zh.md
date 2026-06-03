# lark-multi-cli-bridge (lmcb)

**把你本机的 Claude Code / OpenAI Codex / Google Gemini CLI 接到飞书。** 一个轻量 bot：一条命令启动，扫码注册一个 Lark PersonalAgent 应用，然后在飞书里 DM 你的 bot——发截图、传文件、跑脚本、改代码，每一步都在你这台电脑上执行。

English: [README.md](README.md)

## 这能用在哪些场景

把多个本机 CLI 包成 bot 拉进同一个飞书群是 lmcb 真正的杀手锏。几个真实场景：

- **群里多 bot A2A，互相挑战、互相补盲。** 把 `claude-bot` 和 `codex-bot` 都加进同一个群。问 claude "这段并发代码有啥风险"，拿到答案再 @ codex "你 review 一下 claude 的建议有没有漏掉边缘 case"，两个 bot 在群里互相点评——你只看结论。本质上是 agent-to-agent 协作，平台是飞书群。
- **人 + 多 bot 联合 triage。** 线上 bug 群里，工程 @ `claude-bot` 让它读截图复现 + 改 fix，QA @ `codex-bot` 跑回归脚本看影响面，PM @ `gemini-bot` 总结时间线和影响用户数。三个 bot 各自在你这台机器上跑，输出全进同一个群，所有人看到的是同一份完整链路。
- **直接让 bot 在群里做开发。** DM 或群里 @ bot "帮我在 `src/payment.ts` 加一个 stripe webhook handler"。bot 在你本地读代码、加新文件、跑测试，整张 PR 在卡片里流式展开。同事看着觉得某段不对？直接对那张卡片**引用回复**指出来，bot 接着改——多人 review + bot 落地，全程在群里完成。
- **离开工位也能继续推进。** 想到一个 feature，手机上 DM bot 直接开干。bot 在家里那台笔记本上跑，第二天回工位 `git diff` 直接 review。

session 续接是自动的——claude `--session`、codex `exec resume`、gemini `--resume`——多轮上下文跟得住。每个 bot 在每个 chat 各有独立 session，群里同时跑多个 bot 不串号。

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

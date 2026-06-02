# 常见问题

English: [faq.md](faq.md)

**Q：我的密钥会泄漏吗？**
A：`~/.lark-multi-cli-bridge/bots/*.yaml` 权限为 chmod 600，目录树为 chmod 700。默认 `.gitignore` 阻止意外提交。schema 保留了 `app_secret_ref` 字段，供未来对接密钥提供商（keychain、exec）。

**Q：我的 Codex CLI 版本没有 `--json` 参数怎么办？**
A：设置 `backend.codex.json_mode: false`，适配器会回退到把原始 stdout 分块作为 text-delta 事件流式输出。你将失去工具调用细节，但仍能获得文本回答。

**Q：如何只启动部分 bot？**
A：在你不需要的 YAML 中设置 `enabled: false`，supervisor 会跳过它们。编辑后运行 `lmcb restart <name>`。

**Q：附件会被删除吗？**
A：不会。`~/.lark-multi-cli-bridge/media/<chat_id>/` 下的附件永久保留，磁盘满时需手动清理。

**Q：能在 Linux 上运行吗？**
A：库本身是跨平台的。唯一平台相关的是 launchd 守护进程。Linux systemd unit 生成延后到后续迭代支持。你仍然可以在前台运行 supervisor，或使用自己的 systemd unit 管理。

**Q：同一个聊天里跑两个 bot 会互相串号吗？**
A：不会。SessionStore 按 `(chatId, botName)` 二维存储——同一个群里的 `claude-bot` 和 `codex-bot` 各自维护独立的 `sessionId` 和 `cwd`，互相看不到对方的 session id（claude 的 UUID 跟 codex 的 thread id 是不同 namespace 的，交叉传过去会触发 `no rollout found` 之类的硬错）。旧版单 slot 文件第一次 load 时自动迁移到二维结构。

**Q：CLI 子进程一直挂住不返回怎么办？**
A：每个 `RunContext` 有 `idleTimeoutMs`（可通过 `behavior.idle_timeout_seconds` 按 bot 配置，默认 600s）。如果 CLI 在该时间内无 stdout 输出，worker 先发 SIGTERM，5s 后再发 SIGKILL。

**Q：需要手动创建 Lark 应用吗？**
A：不需要。`lmcb init` 默认走扫码流程——用飞书/Lark 移动端扫描二维码，Lark 自动在你的租户下创建应用并返回 `app_id`/`app_secret`。如果你更喜欢，选项 2 仍支持手动粘贴。

**Q：启动时终端显示 `99992402 field validation failed`，但 bot 正常工作，需要担心吗？**
A：不需要。这来自 `fetchAppOwnerOpenId` 调用 `application.application.get`，其请求格式因 SDK 版本而异。我们捕获了该错误，回退到无 owner 行为后继续正常运行（你的应用在 Lark 后台仍然归你所有）。完整 SDK 错误对象（含 `field_violations`）现在通过 pino 以 depth-10 序列化输出到 worker 日志，要看到底是哪个字段失败，去 `~/.lark-multi-cli-bridge/logs/workers/<bot>/<date>.log*` 过滤 `src=lark-sdk` 即可。调用本身的修复是另一个待办。

**Q：如何重置并重新开始？**
A：运行 `rm -rf ~/.lark-multi-cli-bridge/bots/* ~/.lark-multi-cli-bridge/state/sessions.json`，然后执行 `lmcb init`。

**Q：升级代码后如何重启？**
A：前台模式：`Ctrl+C`，然后 `pnpm build && lmcb start --foreground`。守护进程模式：`lmcb daemon uninstall && pnpm build && lmcb daemon install`。

**Q：bot 调用了哪些工具？在哪看？**
A：流式卡片里，所有工具调用渲染为一个 markdown blockquote——每行一个工具，格式 `> ✅ **Tool** — summary`。两个例外会让工具单独成块：失败的工具在 blockquote 内追加一行 `↳ <首行错误>`（不另起面板），当前还在跑的工具保留一个灰色的 `_运行中…_` live 面板让你看进度。完整 input/output（含堆栈）在 `~/.lark-multi-cli-bridge/logs/workers/<bot>/<date>.log*` 里，故意不进卡片以避免触碰飞书每个元素约 30 KB 的限制。

**Q：能在对话进行中取消运行吗？**
A：可以，有两种方式。在聊天中发送 `/stop` 文本消息，或点击流式卡片上的 **⏹ 终止** 按钮。两种方式都会路由到 `dispatcher.abort(chatId)`，向正在运行的任务发送 `UserStopError` 并在卡片上渲染"已中断"的终态。

**Q：bot 能在群里回复吗？**
A：可以，但仅在被 @提及时响应（设置 `behavior.group_trigger: always` 可放宽此限制）。多行和富文本（`post`）消息会自动展平成 prompt，因此群内 @bot 后换行的消息可正常处理。

**Q：能自定义流式卡片的样式吗？**
A：可以——参见 `src/lark/card-builder.ts`（`renderRunCard`）和 `src/lark/run-state.ts`。两者均遵循飞书 CardKit 2.0 schema，可自由调整元素、标题和边框样式。

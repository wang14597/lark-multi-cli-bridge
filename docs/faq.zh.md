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

**Q：lmcb 能和 lark-channel-bridge 同时运行吗？**
A：可以，但每个 Lark bot 身份必须只绑定到一个 bridge（否则两者会争抢 WebSocket 长连接）。请使用不同的 `app_id`。

**Q：CLI 子进程一直挂住不返回怎么办？**
A：每个 `RunContext` 有 `idleTimeoutMs`（可通过 `behavior.idle_timeout_seconds` 按 bot 配置，默认 600s）。如果 CLI 在该时间内无 stdout 输出，worker 先发 SIGTERM，5s 后再发 SIGKILL。

**Q：需要手动创建 Lark 应用吗？**
A：不需要。`lmcb init` 默认走扫码流程——用飞书/Lark 移动端扫描二维码，Lark 自动在你的租户下创建应用并返回 `app_id`/`app_secret`。如果你更喜欢，选项 2 仍支持手动粘贴。

**Q：启动时终端显示 `99992402 field validation failed`，但 bot 正常工作，需要担心吗？**
A：不需要。这来自 `fetchAppOwnerOpenId` 调用 `application.application.get`，其请求格式因 SDK 版本而异。我们捕获了该错误，回退到无 owner 行为后继续正常运行（你的应用在 Lark 后台仍然归你所有）。bridge 正常工作，后续版本会修复该调用。

**Q：如何重置并重新开始？**
A：运行 `rm -rf ~/.lark-multi-cli-bridge/bots/* ~/.lark-multi-cli-bridge/state/sessions.json`，然后执行 `lmcb init`。

**Q：升级代码后如何重启？**
A：前台模式：`Ctrl+C`，然后 `pnpm build && lmcb start --foreground`。守护进程模式：`lmcb daemon uninstall && pnpm build && lmcb daemon install`。

**Q：为什么部分工具调用被折叠了？**
A：在 3 个以上工具调用时，lmcb 会把旧的折叠进汇总面板，因为每个飞书卡片元素有约 30 KB 的大小限制。完整的工具细节始终可在 worker 日志文件中查看。最新仍在运行的工具保持展开，以便你实时观察。

**Q：能自定义流式卡片的样式吗？**
A：可以——参见 `src/lark/card-builder.ts`（`renderRunCard`）和 `src/lark/run-state.ts`。两者均遵循飞书 CardKit 2.0 schema，可自由调整元素、标题和边框样式。

# FAQ

中文版: [faq.zh.md](faq.zh.md)

**Q: Will my secrets leak?**
A: `~/.lark-multi-cli-bridge/bots/*.yaml` are chmod 600 and the directory tree is chmod 700. The default `.gitignore` blocks accidental commits. The schema reserves `app_secret_ref` for future secret-provider integration (keychain, exec).

**Q: What if Codex CLI doesn't have `--json` at my version?**
A: Set `backend.codex.json_mode: false` and the adapter will fall back to streaming raw stdout chunks as text-delta events. You'll lose tool-call detail but get the textual answer.

**Q: How do I run only some of my bots?**
A: Set `enabled: false` on the YAMLs you don't want; the supervisor will skip them. `lmcb restart <name>` after editing.

**Q: Will attachments be deleted?**
A: No. Attachments under `~/.lark-multi-cli-bridge/media/<chat_id>/` are kept indefinitely. Manage them yourself if disk fills up.

**Q: Can I run this on Linux?**
A: The library itself is portable. The only platform-specific bit is the launchd daemon. Linux systemd unit generation is deferred to a follow-up iteration. You can still run the supervisor in the foreground or under your own systemd unit.

**Q: Does the bridge work alongside lark-channel-bridge?**
A: Yes, but each Lark bot identity must be assigned to exactly one bridge (otherwise both compete for the WebSocket long-connection). Use different `app_id`s.

**Q: What if my CLI subprocess hangs forever?**
A: Each `RunContext` has `idleTimeoutMs` (configurable per bot via `behavior.idle_timeout_seconds`, default 600s). If the CLI produces no stdout for that duration, the worker sends SIGTERM, then SIGKILL 5 s later.

**Q: Do I need to create a Lark app manually?**
A: No. `lmcb init` defaults to scanning a QR code with your Lark mobile app — Lark creates the application under your tenant automatically and returns `app_id`/`app_secret` to lmcb. Manual paste is still option 2 if you prefer.

**Q: My terminal shows a `99992402 field validation failed` error on startup but the bot still works. Should I worry?**
A: No. That comes from `fetchAppOwnerOpenId` calling `application.application.get` whose request shape varies across SDK versions. We catch the error and fall back to no-owner behavior (your app is still owned by you in reality). The bridge continues normally. We'll fix the call shape in a follow-up.

**Q: How do I reset and start over?**
A: `rm -rf ~/.lark-multi-cli-bridge/bots/* ~/.lark-multi-cli-bridge/state/sessions.json`, then `lmcb init`.

**Q: How do I restart after upgrading code?**
A: In foreground mode: `Ctrl+C` then `pnpm build && lmcb start --foreground`. In daemon mode: `lmcb daemon uninstall && pnpm build && lmcb daemon install`.

**Q: Why are some tool calls collapsed?**
A: At 3+ tool calls, lmcb collapses earlier ones into a summary panel because each Feishu card element has a ~30 KB size limit. Full tool details are in the worker log files. The latest still-running tool stays expanded so you can watch it.

**Q: Can I cancel a run mid-stream?**
A: Yes, in two ways. Send `/stop` as a text message in the chat, or click the **⏹ 终止** button on the streaming card. Both route to `dispatcher.abort(chatId)`, which sends a `UserStopError` to the in-flight run and renders an "interrupted" final state on the card.

**Q: Does the bot respond in groups?**
A: Yes, but only when @-mentioned (set `behavior.group_trigger: always` to relax this). Multi-line and rich-text (`post`) messages are automatically flattened to a prompt, so group @-mentions followed by newlines work correctly.

**Q: Can I customize the streaming card look?**
A: Yes — see `src/lark/card-builder.ts` (`renderRunCard`) and `src/lark/run-state.ts`. Both follow Feishu CardKit 2.0 schema; tweak elements, headers, and borders to taste.

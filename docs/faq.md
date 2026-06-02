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

**Q: Can two bots in the same chat share or step on each other's session?**
A: No. SessionStore is scoped per `(chatId, botName)`. `claude-bot` and `codex-bot` active in the same group keep independent `sessionId` and `cwd` — neither sees the other's continuation id (claude UUIDs and codex thread ids live in disjoint namespaces and cross-feeding would yield `no rollout found` or worse). Legacy single-slot session files are auto-migrated on first load.

**Q: What if my CLI subprocess hangs forever?**
A: Each `RunContext` has `idleTimeoutMs` (configurable per bot via `behavior.idle_timeout_seconds`, default 600s). If the CLI produces no stdout for that duration, the worker sends SIGTERM, then SIGKILL 5 s later.

**Q: Do I need to create a Lark app manually?**
A: No. `lmcb init` defaults to scanning a QR code with your Lark mobile app — Lark creates the application under your tenant automatically and returns `app_id`/`app_secret` to lmcb. Manual paste is still option 2 if you prefer.

**Q: My terminal shows a `99992402 field validation failed` error on startup but the bot still works. Should I worry?**
A: No. It comes from `fetchAppOwnerOpenId` calling `application.application.get` whose request shape varies across SDK versions. We catch it and fall back to no-owner behavior (your app is still owned by you in reality); the bridge continues normally. The full SDK error payload — including `field_violations` — is now routed through pino with depth-10 inspect, so if you want to see exactly which field tripped, look in `~/.lark-multi-cli-bridge/logs/workers/<bot>/<date>.log*` and filter for `src=lark-sdk`. Fixing the call shape itself is a follow-up.

**Q: How do I reset and start over?**
A: `rm -rf ~/.lark-multi-cli-bridge/bots/* ~/.lark-multi-cli-bridge/state/sessions.json`, then `lmcb init`.

**Q: How do I restart after upgrading code?**
A: In foreground mode: `Ctrl+C` then `pnpm build && lmcb start --foreground`. In daemon mode: `lmcb daemon uninstall && pnpm build && lmcb daemon install`.

**Q: Where do I see what tools the bot called?**
A: Inside the streaming card, tool calls render as a single markdown blockquote — one line per call, format `> ✅ **Tool** — summary`. Two exceptions promote a tool back into its own visual block: errors get a `↳ <first line of output>` follow-up inside the same blockquote (no separate panel), and the tool currently in flight keeps a live `_运行中…_` grey panel so you can watch progress. Full input/output (and stack traces) is in `~/.lark-multi-cli-bridge/logs/workers/<bot>/<date>.log*` — intentionally kept out of the card to stay under Feishu's 30 KB per-element limit.

**Q: Can I cancel a run mid-stream?**
A: Yes, in two ways. Send `/stop` as a text message in the chat, or click the **⏹ 终止** button on the streaming card. Both route to `dispatcher.abort(chatId)`, which sends a `UserStopError` to the in-flight run and renders an "interrupted" final state on the card.

**Q: Does the bot respond in groups?**
A: Yes, but only when @-mentioned (set `behavior.group_trigger: always` to relax this). Multi-line and rich-text (`post`) messages are automatically flattened to a prompt, so group @-mentions followed by newlines work correctly.

**Q: Can I customize the streaming card look?**
A: Yes — see `src/lark/card-builder.ts` (`renderRunCard`) and `src/lark/run-state.ts`. Both follow Feishu CardKit 2.0 schema; tweak elements, headers, and borders to taste.

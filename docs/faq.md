# FAQ

**Q: Will my secrets leak?**
A: `~/.lark-multi-cli-bridge/bots/*.yaml` are chmod 600 and the directory tree is chmod 700. The default `.gitignore` blocks accidental commits. The schema reserves `app_secret_ref` for future secret-provider integration (keychain, exec).

**Q: What if Codex CLI doesn't have `--json` at my version?**
A: Set `backend.codex.json_mode: false` and the adapter will fall back to streaming raw stdout chunks as text-delta events. You'll lose tool-call detail but get the textual answer.

**Q: How do I run only some of my bots?**
A: Set `enabled: false` on the YAMLs you don't want; the supervisor will skip them. `lmcb restart <name>` after editing.

**Q: Will attachments be deleted?**
A: No. Attachments under `~/.lark-multi-cli-bridge/media/<chat_id>/` are kept indefinitely. Manage them yourself if disk fills up.

**Q: Can I run this on Linux?**
A: The library itself is portable. The only platform-specific bit is the launchd daemon. Linux systemd unit generation is deferred to a follow-up iteration (see `docs/superpowers/plans/.../Deferred from v1`). You can still run the supervisor in the foreground or under your own systemd unit.

**Q: Does the bridge work alongside lark-channel-bridge?**
A: Yes, but each Lark bot identity must be assigned to exactly one bridge (otherwise both compete for the WebSocket long-connection). Use different `app_id`s.

**Q: What if my CLI subprocess hangs forever?**
A: Each `RunContext` has `idleTimeoutMs` (configurable per bot via `behavior.idle_timeout_seconds`, default 600s). If the CLI produces no stdout for that duration, the worker sends SIGTERM, then SIGKILL 5 s later.

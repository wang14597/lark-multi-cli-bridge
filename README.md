# lark-multi-cli-bridge (lmcb)

A Lark/Feishu chat bridge that routes inbound messages to **Claude Code**, **OpenAI Codex CLI**, or **Google Gemini CLI**, with support for running multiple bots concurrently — one bot per CLI backend — on a single host.

中文版: [README.zh.md](README.zh.md)

## Why

`lark-channel-bridge` and `feishu-claude-code-bridge` each serve a single CLI backend. lmcb fills the gap: you can run a `claude-bot`, a `codex-bot`, and a `gemini-bot` side by side under one supervisor, each with isolated state, independent crash recovery, and the same polished streaming card UI.

## Features

- **Multi-bot, multi-backend** — one supervisor forks one worker per bot; each worker connects to Lark via its own bot identity and spawns its own CLI.
- **Scan-to-create onboarding** — `lmcb init` defaults to scanning a QR code with the Lark mobile app; Lark auto-creates an internal-use application under your tenant and returns `app_id`/`app_secret`. No developer console visit required.
- **Polished streaming cards** — `streaming_mode` progressive updates; collapsible reasoning panel; collapsible tool-call panels (auto-collapses at 3+ calls to stay under Feishu's 30 KB card limit); footer status bar; terminal-state note; stop button.
- **Preempt + 500 ms batch** — rapid follow-ups merge into a single CLI run instead of spawning a redundant one.
- **Per-chat session continuity** — multi-turn context preserved via the CLI's own session id.
- **11 slash commands** — `/help`, `/new`, `/cd`, `/ws`, `/status`, `/stop`, `/timeout`, `/access`, `/sessions`, `/reconnect`, `/doctor`.
- **Per-bot access control** — allowlist by user or chat; app owner is implicit admin.
- **Crash recovery** — exponential back-off (1s → 30s); worker disabled after 5 crashes in 3 minutes, re-enabled with `lmcb restart <bot>`.
- **macOS launchd daemon** — `lmcb daemon install` for boot-time start.
- **Bots-dir hot-reload** — edit a `bots/*.yaml` and the worker restarts automatically (500 ms debounce).
- **Attachment support** — images and files downloaded and appended to prompt as `[Attached <kind>: <abs path>]`.
- State lives in `~/.lark-multi-cli-bridge/` (config, bot YAMLs, sessions, logs, media).

## Quickstart

```bash
pnpm install && pnpm build
node ./bin/lmcb.mjs init       # interactive wizard: pick backend, scan QR, done
node ./bin/lmcb.mjs start --foreground
```

The `init` wizard walks you through backend selection, bot naming, and app provisioning (scan QR or paste existing credentials). After completing it, message your new bot in Lark.

Full walkthrough: [docs/quickstart.md](docs/quickstart.md)

## Docs

| Doc | Description |
|-----|-------------|
| [docs/quickstart.md](docs/quickstart.md) | Step-by-step setup and first run |
| [docs/architecture.md](docs/architecture.md) | Process topology, module map, IPC, state |
| [docs/adapter-authoring.md](docs/adapter-authoring.md) | How to add a 4th CLI backend |
| [docs/faq.md](docs/faq.md) | Troubleshooting and common questions |

## Status

Active development. v0.4.0 released. Tested manually with Lark on macOS. Linux is supported for foreground mode; the launchd daemon is macOS-only (systemd support deferred).

## License

MIT. See [LICENSE](LICENSE).

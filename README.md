# lark-multi-cli-bridge (lmcb)

Lark/Feishu chat bridge that routes inbound messages to **Claude Code**, **OpenAI Codex CLI**, or **Google Gemini CLI**, with support for running multiple bots concurrently — one bot per CLI backend.

中文版: [README.zh.md](README.zh.md)

## Features

- One supervisor process forks one worker per bot. Workers crash → supervisor restarts with exponential backoff.
- Streaming card updates in Lark, throttled to respect API rate limits (500 ms / 50 chars).
- Preempt + 500 ms batch: rapid follow-ups merge into a single CLI run instead of starting a new conversation.
- Per-chat session continuity via the CLI's own session id (multi-turn context is preserved).
- Slash commands: `/help`, `/new`, `/cd`, `/ws`, `/status`, `/stop`, `/timeout`, `/access`, `/sessions`, `/reconnect`, `/doctor`.
- Per-bot access control with implicit app-owner admin.
- Native macOS launchd daemon for boot-time install.
- Adapter authoring guide for adding more CLIs (`docs/adapter-authoring.md`).

## Architecture

```
[supervisor] -- fork --> [worker A: claude-bot] --> spawns `claude`
            \-- fork --> [worker B: codex-bot]  --> spawns `codex`
            \-- fork --> [worker C: gemini-bot] --> spawns `gemini`
```

Full design: [docs/architecture.md](docs/architecture.md). Canonical spec under `docs/superpowers/specs/`.

## Quickstart

See [docs/quickstart.md](docs/quickstart.md).

## Status

In active development. Core features (M1-M5) implemented and unit-tested; manual smoke against a real Lark bot is the user's responsibility.

## License

MIT. See [LICENSE](LICENSE).

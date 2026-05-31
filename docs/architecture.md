# Architecture

See the canonical design document under `docs/superpowers/specs/` for the full version. This is a short summary.

## Process topology

```
                    user runs `lmcb start`
                              |
                              v
                    +---------------------+
                    |     supervisor      |  main process
                    |  - reads bots/*.yaml|
                    |  - holds ipc.sock   |
                    +----------+----------+
                               |
        +------- fork ---------+--------- fork -------+
        |                      |                      |
        v                      v                      v
   +----------+          +----------+           +----------+
   | worker A |          | worker B |           | worker C |
   | claude   |          | codex    |           | gemini   |
   +-----+----+          +-----+----+           +-----+----+
         |                     |                      |
   Lark WS               Lark WS                Lark WS
         |                     |                      |
   spawn `claude`        spawn `codex`          spawn `gemini`
   (one-shot per msg)    (one-shot per msg)     (one-shot per msg)
```

## Key modules

| Module | Responsibility |
|---|---|
| `src/cli/` | `lmcb` entrypoint; routes subcommands through unix socket to supervisor |
| `src/supervisor/` | Worker fork/respawn, IPC server, crash budget |
| `src/worker/` | Single-bot lifecycle: Lark → dispatcher → adapter → streaming card |
| `src/lark/` | Lark SDK wrapper: WS, message parsing, card builder, attachments |
| `src/adapters/` | `ClaudeAdapter` / `CodexAdapter` / `GeminiAdapter` (streaming `Adapter` interface) |
| `src/commands/` | Slash command router + handlers |
| `src/session/` | `SessionStore` + `WorkspaceStore` with atomic file persistence |
| `src/auth/` | Access control rules |
| `src/daemon/` | macOS launchd plist generation |
| `src/config/` | YAML loading + zod schema + bots-dir watcher |
| `src/telemetry/` | pino + pino-roll structured logging |

## Adapter event stream

All three adapters expose `AsyncIterable<AdapterEvent>` over `run(ctx)`. Events:

- `session-start` — CLI started, session id known
- `text-delta` — incremental assistant text
- `tool-call` / `tool-result` — CLI invoked a tool
- `thinking` — CLI is reasoning (claude-specific currently)
- `error` — recoverable or fatal error
- `done` — final text + token usage

The worker's `Dispatcher` aggregates events into a `CardStreamer` which throttles patches to the Lark card.

## IPC

- `supervisor` ↔ `lmcb` CLI: unix socket at `~/.lark-multi-cli-bridge/ipc.sock`, newline-delimited JSON-RPC.
- `supervisor` ↔ `worker`: Node's built-in `child_process.fork()` IPC channel with `ready` / `shutdown` / `reload-config` messages.

## State on disk

```
~/.lark-multi-cli-bridge/
├── config.yaml
├── bots/<name>.yaml          (chmod 600)
├── state/sessions.json       (atomic writes)
├── state/workspaces.json
├── state/processes.json
├── logs/supervisor.log
├── logs/workers/<bot>/YYYY-MM-DD.log
├── media/<chat_id>/<file>    (attachments — kept forever, manual cleanup)
└── ipc.sock
```

# Architecture

中文版: [architecture.zh.md](architecture.zh.md)

See the canonical design document under `docs/superpowers/specs/` for the full specification. This is a working summary updated through v0.4.0.

## Process topology

```
                user runs `lmcb start`
                          |
                          v
                +---------------------+
                |     supervisor      |  main process
                |  - reads bots/*.yaml|
                |  - holds ipc.sock   |
                |  - writes processes |
                +----------+----------+
                           |
      +------- fork -------+-------- fork -------+
      |                    |                     |
      v                    v                     v
 +----------+        +----------+          +----------+
 | worker A |        | worker B |          | worker C |
 | claude   |        | codex    |          | gemini   |
 +-----+----+        +-----+----+          +-----+----+
       |                   |                     |
 Lark WS              Lark WS               Lark WS
       |                   |                     |
 spawn `claude`      spawn `codex`         spawn `gemini`
 (one-shot/msg)      (one-shot/msg)        (one-shot/msg)
```

Each worker holds a persistent Lark WebSocket connection for its bot identity. Inbound messages are handled entirely inside that worker process — the supervisor does not see message content.

## Module map

| Module (`src/`) | Responsibility |
|-----------------|----------------|
| `cli/` | `lmcb` entrypoint; routes subcommands through the Unix socket to the supervisor |
| `supervisor/` | Worker fork/respawn, IPC server, crash budget, log aggregation |
| `worker/` | Single-bot lifecycle: Lark events → dispatcher → adapter → streaming card |
| `lark/` | Lark SDK wrapper: WebSocket, message parsing, `card-builder.ts`, `run-state.ts`, `tool-render.ts`, attachment download |
| `adapters/` | `ClaudeAdapter` / `CodexAdapter` / `GeminiAdapter` implementing `AsyncIterable<AdapterEvent>` |
| `commands/` | Slash-command router and handlers (11 commands) |
| `session/` | `SessionStore` + `WorkspaceStore` with atomic file persistence |
| `auth/` | Access control rules; `register-app.ts` for scan-to-create QR provisioning |
| `daemon/` | macOS launchd plist generation |
| `config/` | YAML loading, zod schema validation, bots-dir watcher with hot-reload |
| `telemetry/` | pino + pino-roll structured logging |
| `util/` | Atomic file writes, retry helpers, async iterator utilities, signal plumbing |

Notable v0.4.0 additions inside `src/lark/`:

- **`run-state.ts`** — `RunState` data model + mutation helpers (tracks blocks, reasoning, tools, terminal flag, footer text).
- **`tool-render.ts`** — `toolHeaderText` / `toolBodyMd` helpers for tool-call panel rendering.
- **`card-builder.ts`** — `renderRunCard` rewritten to match `feishu-claude-code-bridge`'s polished look: no header bar, `streaming_mode` toggle, collapsible reasoning and tool panels, footer status, terminal-state note, stop button.

## Adapter event stream

All adapters expose `AsyncIterable<AdapterEvent>` over `run(ctx)`. The discriminated union has **7 variants**:

| Event | When emitted |
|-------|-------------|
| `session-start` | CLI subprocess started; session id is known |
| `text-delta` | Incremental assistant text chunk |
| `tool-call` | CLI invoked a tool (name + input) |
| `tool-result` | Tool returned a result |
| `thinking` | CLI is reasoning (Claude-specific; triggers collapsible reasoning panel) |
| `error` | Recoverable or fatal error from the CLI |
| `done` | CLI finished; final text + token usage |

The worker's `Dispatcher` aggregates events into a `CardStreamer`, which throttles Lark card patches to 500 ms or 50 chars (whichever fires first).

## Streaming card state machine

`RunState` (in `src/lark/run-state.ts`) tracks the mutable state of a single streaming response:

| Field | Description |
|-------|-------------|
| `blocks` | Ordered list of rendered Markdown text blocks |
| `reasoning` | Accumulated thinking text (shown in collapsible panel) |
| `tools` | Array of tool-call panels (header + body); auto-collapses older ones at 3+ calls |
| `terminal` | Whether the run has ended (switches card out of `streaming_mode`) |
| `footer` | Status line shown at the bottom of the card |
| `stopButton` | Whether the stop button is visible |

When `terminal` becomes true, the card is finalized with a terminal-state note and the stop button is removed.

Tool panels auto-collapse at 3 or more calls to stay within Feishu's ~30 KB per-element card limit. Full tool details are always available in the worker log files.

## IPC mechanism

**supervisor ↔ `lmcb` CLI:**
- Unix socket at `~/.lark-multi-cli-bridge/ipc.sock`
- Newline-delimited JSON-RPC (request / response pairs)
- Supported methods: `start`, `stop`, `ps`, `restart`, `reload`

**supervisor ↔ workers:**
- Node's built-in `child_process.fork()` IPC channel
- Message types: `ready`, `shutdown`, `reload-config`

## State on disk

```
~/.lark-multi-cli-bridge/
├── config.yaml                         (global config)
├── bots/<name>.yaml                    (per-bot config, chmod 600)
├── state/sessions.json                 (atomic writes)
├── state/workspaces.json
├── state/processes.json
├── logs/supervisor.log
├── logs/workers/<bot>/YYYY-MM-DD.log   (rotated daily)
├── media/<chat_id>/<file>              (attachments — kept indefinitely)
└── ipc.sock                            (removed on clean shutdown)
```

## Crash recovery

- Back-off schedule: 1s, 2s, 5s, 15s, 30s (exponential).
- Budget: 5 crashes in 3 minutes → worker disabled; requires manual `lmcb restart <bot>`.
- The supervisor itself does not crash-restart; if the supervisor exits, all workers exit with it (launchd or the user restarts the supervisor).

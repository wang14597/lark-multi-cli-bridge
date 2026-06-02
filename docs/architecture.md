# Architecture

中文版: [architecture.zh.md](architecture.zh.md)

See the canonical design document under `docs/superpowers/specs/` for the full specification. This is a working summary updated through v0.7.1. Granular per-change history lives in [docs/changes/](changes/INDEX.md).

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

### How lmcb isolates bot identity for lark-cli children

The LLM subprocess (claude / codex / gemini) typically calls `lark-cli` to
send messages, list members, etc. Each lmcb bot needs its own Lark app
identity — without isolation, every bot would silently borrow whichever
`lark-cli` profile happens to be the local default, leaking cross-bot
identity.

lmcb pins identity via a **PATH shim**:

1. At worker startup, `ensureLarkProfile(bot)` idempotently registers a
   `lark-cli profile` named after the bot's `app_id` (using
   `--app-secret-stdin` so secrets never appear in argv).
2. `provisionLarkShim(bot)` writes an executable wrapper at
   `~/.lark-multi-cli-bridge/shims/<bot>/lark-cli` that `exec`s the real
   `lark-cli` binary with `--profile <app_id>` prepended.
3. The dispatcher injects `PATH=<shim-dir>:$PATH` into every LLM child, so
   any `lark-cli` call inside the child transparently routes through the
   correct profile.

This was migrated from a `LARKSUITE_CLI_APP_ID/SECRET/BRAND` env-injection
approach (commit ae97924) which proved non-functional in lark-cli 1.0.43:
the env vars are recognised but never mint a usable bot token.

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

## Supported message types

`src/lark/message-parse.ts` normalises all Lark `message_type` variants into a single `{ text, attachments }` pair before the prompt reaches the adapter:

| `message_type` | Prompt output |
|----------------|--------------|
| `text` | Raw `.text` field |
| `post` (rich text) | Flattened Markdown — `@name`, `[text](url)`, `` `code` ``, code blocks, multi-paragraph joins with `\n`. Inline images push a `RawAttachment` and emit `[image]` |
| `image` | Empty text + `RawAttachment` (downloaded and injected as `[Attached image: …]`) |
| `file` | Empty text + `RawAttachment` (downloaded and injected as `[Attached file: …]`) |
| `merge_forward` | `[merge_forward N messages]` marker (full flatten deferred — TODO) |
| `audio` | `[audio N seconds]` or `[audio]` marker (Lark does not provide a transcript) |

The `extractPromptFromContent(messageType, content, mentions)` pure function handles the type-to-text conversion and is independently testable.

Notable v0.4.0 additions inside `src/lark/`:

- **`run-state.ts`** — `RunState` data model + mutation helpers (tracks blocks, reasoning, tools, terminal flag, footer text).
- **`tool-render.ts`** — `toolHeaderText` / `toolBodyMd` helpers; `toolHeaderText` is the canonical single-line `✅ **Tool** — summary` format reused by the blockquote rendering path.
- **`card-builder.ts`** — `renderRunCard` builds the streaming card: no header bar, `streaming_mode` toggle, collapsible reasoning panel, **blockquote-based tool list** (see "Tool-call rendering" below), footer status, terminal-state note, stop button.

## Adapter event stream

Card button clicks (e.g. ⏹) are dispatched via Lark's `card.action.trigger` event, parsed by `src/lark/card-action.ts`, and routed to `dispatcher.abort(chatId)`. The `LarkWsClient` emits a typed `'card-action'` event that the worker consumes after performing the same access-control check as inbound messages.

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
| `tools` | Array of tool calls; rendered as a single blockquote markdown element, one line per tool |
| `terminal` | Whether the run has ended (switches card out of `streaming_mode`) |
| `footer` | Status line shown at the bottom of the card |
| `stopButton` | Whether the stop button is visible |

When `terminal` becomes true, the card is finalized with a terminal-state note and the stop button is removed.

### Tool-call rendering

Consecutive tool calls collapse into a single markdown **blockquote** element (one line per tool) so the card stays visually light:

```
> ✅ **Read** — src/lark/card-builder.ts
> ❌ **Bash** — pnpm test
> ↳ AssertionError: expected foo to equal bar
> ✅ **Write** — src/lark/card-builder.ts
```

Two exceptions promote a tool back into its own visual block:

- **Errors** render their first non-empty output line as a `↳` follow-up inside the same blockquote (capped at 150 chars; full stack stays in the worker log).
- **The last tool while the run is still in flight** renders as a grey `collapsible_panel` with the live `_运行中…_` body, so long tasks remain observable. It collapses back to a blockquote line once it completes.

Tool detail (full input + output) is intentionally not surfaced in the card — it's always available in `~/.lark-multi-cli-bridge/logs/workers/<bot>/YYYY-MM-DD.log`.

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
├── shims/<bot>/lark-cli                (per-bot PATH shim, 0755)
└── ipc.sock                            (removed on clean shutdown)
```

## Crash recovery

- Back-off schedule: 1s, 2s, 5s, 15s, 30s (exponential).
- Budget: 5 crashes in 3 minutes → worker disabled; requires manual `lmcb restart <bot>`.
- The supervisor itself does not crash-restart; if the supervisor exits, all workers exit with it (launchd or the user restarts the supervisor).

# lark-multi-cli-bridge — Design Document

- **Date**: 2026-05-31
- **Status**: Draft (awaiting user review)
- **Author**: Lei (via Claude Code)
- **Repo (planned)**: `/Users/lei.wang2/Downloads/wiz/projects/lark-multi-cli-bridge/`
- **Reference (read-only, MIT)**: `/Users/lei.wang2/Downloads/wiz/projects/feishu-claude-code-bridge/`

## 1. Goal & Non-Goals

### Goal

Build a self-owned, Lark/Feishu chat bridge that routes inbound messages to one of three local AI coding CLIs — **Claude Code**, **OpenAI Codex CLI**, **Google Gemini CLI** — and supports running **multiple Lark bots in parallel on a single host**, where each bot is bound to one CLI backend.

Concrete success criterion: one command (`lmcb start`) brings up three bots simultaneously (`claude-bot`, `codex-bot`, `gemini-bot`) on the same machine, each backed by its own CLI, with isolated state, independent crash recovery, and streaming card updates in Lark.

### Non-Goals

- Replacing the existing `lark-channel-bridge` daemon — both can coexist while this project matures.
- Web UI / dashboard. CLI-only.
- Hosted/SaaS deployment. Local-first, single-user, single-host.
- Windows daemon support in v1. macOS launchd + Linux systemd only.
- Multi-tenancy or org-level RBAC. Per-bot access lists are sufficient.

## 2. Decision Log (locked during brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Project positioning | Built independently from scratch; references open-source `feishu-claude-code-bridge` for architectural inspiration only |
| 2 | Tech stack | Node.js (>=20) + TypeScript |
| 3 | Process topology | Supervisor + per-bot worker subprocesses |
| 4 | Adapter abstraction | Streaming event interface (`AsyncIterable<AdapterEvent>`) |
| 5 | MVP scope | Core + secondary + extended tiers (full parity with `lark-channel-bridge` capabilities, plus multi-CLI multi-bot) |
| 6 | Project name | `lark-multi-cli-bridge`, CLI binary `lmcb` |
| 7 | Bot config layout | One file per bot under `~/.lark-multi-cli-bridge/bots/<bot-name>.yaml` |
| 8 | CLI invocation model | One-shot child process per message, session continuity via CLI-native session IDs |
| 9 | Attachment retention | Retained permanently; no auto-cleanup |
| 10 | `/cd` vs `/ws use` semantics | `/cd` keeps session, `/ws use` resets session |
| 11 | Multi-bot in same group chat | No special handling — each mentioned bot's worker runs independently |
| 12 | Daemon platforms (v1) | macOS launchd + Linux systemd; Windows deferred |
| 13 | Streaming card throttle | 500 ms or 50-char buffer, whichever fires first |
| 14 | Crash backoff | Exponential (1s, 2s, 5s, 15s, 30s); 5 crashes in 3 min disables the worker until manual `lmcb restart` |

## 3. Architecture Overview

### 3.1 Process Topology

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
        +------- fork ---------+--------- fork -------+
        |                      |                      |
        v                      v                      v
   +----------+          +----------+           +----------+
   | worker A |          | worker B |           | worker C |
   | claude-bot|         | codex-bot|           | gemini-bot|
   +-----+----+          +-----+----+           +-----+----+
         |                     |                      |
   Lark WS (bot A)        Lark WS (bot B)        Lark WS (bot C)
         |                     |                      |
   spawn `claude`        spawn `codex`          spawn `gemini`
   (one-shot, per msg)   (one-shot, per msg)    (one-shot, per msg)
```

### 3.2 Module Map

| Module (`src/`) | Responsibility |
|-----------------|----------------|
| `cli/` | `lmcb` entry; subcommand routing through unix socket to supervisor |
| `supervisor/` | Worker fork/respawn, IPC server, log aggregation, crash budget |
| `worker/` | Single-bot lifecycle: Lark events -> dispatcher -> adapter -> streaming card |
| `lark/` | Lark SDK wrapper: WebSocket, message parsing, card builder, attachment download |
| `adapters/` | `ClaudeAdapter`, `CodexAdapter`, `GeminiAdapter` implementing the streaming `Adapter` interface |
| `commands/` | Slash-command handlers (`/help`, `/new`, `/cd`, `/ws`, `/status`, `/stop`, ...) |
| `session/` | Persistence of `chat_id -> {session_id, cwd, backend, bot}` and named workspaces |
| `auth/` | Access control (`allowed_users`, `allowed_chats`, `admins`) and device-code OAuth |
| `daemon/` | Generate macOS launchd plist / Linux systemd user unit |
| `config/` | YAML loading, zod schema validation, file watch + hot reload |
| `telemetry/` | Structured logs (pino), optional Prometheus metrics |
| `util/` | Atomic file writes, retry, async iterator helpers, signal plumbing |

### 3.3 Boundary Discipline

- `adapters/` depend only on `Adapter` interface + child_process — they do not know Lark exists. Unit-testable against fixture transcripts.
- `lark/` depends only on the Lark SDK — does not know which CLI backend will run. Mock adapters can drive end-to-end tests against a fake Lark WS server.
- `worker/` is the integration layer that wires Lark events to adapter runs and back to streaming cards.

## 4. Configuration & State

### 4.1 Filesystem Layout (`~/.lark-multi-cli-bridge/`)

```
~/.lark-multi-cli-bridge/
├── config.yaml                 global defaults + ipc socket + log retention
├── bots/                       one file per bot
│   ├── claude-bot.yaml
│   ├── codex-bot.yaml
│   └── gemini-bot.yaml
├── state/
│   ├── sessions.json           chat_id -> { backend, session_id, cwd, last_used_at, message_count, bot }
│   ├── workspaces.json         named workspaces { name -> abs_path }
│   └── processes.json          live supervisor + workers registry
├── logs/
│   ├── supervisor.log
│   └── workers/<bot-name>/YYYY-MM-DD.log
├── media/<chat_id>/<file>      downloaded attachments (PERMANENT — no auto-cleanup)
├── ipc.sock                    supervisor unix socket
└── .gitignore                  defensive: blocks accidental git add
```

All files chmod 600 by default; directories 700.

### 4.2 Per-Bot YAML Schema

```yaml
# ~/.lark-multi-cli-bridge/bots/claude-bot.yaml
name: claude-bot                      # required, must match filename
enabled: true

lark:
  app_id: cli_aa93d72c97f9deea
  app_secret: <hex>                   # plaintext, file is chmod 600
  tenant: lark                        # lark | feishu
  # future-proof: app_secret_ref allows external secret providers
  # app_secret_ref: { source: keychain, key: "lmcb/claude-bot/app_secret" }

backend:
  type: claude                        # claude | codex | gemini
  claude:                             # backend-specific sub-block (discriminated union)
    model: opus-4-7                   # optional
    permission_mode: bypassPermissions
    extra_args: []                    # passthrough to the CLI

access:
  allowed_users: []                   # empty array = allow all; non-empty = whitelist
  allowed_chats: []
  admins: [ou_xxx]                    # in addition to app owner (always implicit admin)

behavior:
  default_cwd: ~                      # ~ resolves to $HOME
  group_trigger: mention              # mention | always
  idle_timeout_seconds: 600           # CLI idle (no stdout) timeout
  max_concurrent_chats: 0             # 0 = unlimited
```

Schema validated with `zod` at load time. Backend sub-block validated as a discriminated union on `backend.type`.

### 4.3 Global `config.yaml`

```yaml
log_retention_days: 7
ipc_socket: ~/.lark-multi-cli-bridge/ipc.sock
metrics:
  enabled: false
  port: 9099
defaults:
  behavior:
    group_trigger: mention
    idle_timeout_seconds: 600
```

### 4.4 Secret Handling

- v1 stores `app_secret` as plaintext under chmod 600 + `.gitignore`.
- Schema reserves `app_secret_ref` for future providers (`keychain`, `exec`, `env`). Implementation deferred to a later iteration.
- Startup checks file permissions and auto-corrects with a warning if too open.

## 5. Process Lifecycle

### 5.1 Startup

1. `lmcb start` — exits with error if `ipc.sock` is already held by a live supervisor.
2. Supervisor loads `config.yaml` + every `bots/*.yaml`, validates with zod.
3. Supervisor opens `ipc.sock`, writes `processes.json`, initializes pino logger.
4. For each `enabled: true` bot, supervisor `child_process.fork()`s a worker.
5. Each worker:
   - Connects Lark WebSocket (SDK auto-retry; manual reconnect after 5s timeout).
   - Loads its slice of `sessions.json`.
   - Posts `ready` to supervisor over IPC.
6. Supervisor either stays in foreground (`--foreground`) or returns control to shell after all workers are ready.

### 5.2 IPC

- **Supervisor <-> worker**: `child_process.fork()` built-in channel, typed JSON messages validated by zod discriminated unions.
- **`lmcb` CLI <-> supervisor**: Unix socket at `ipc.sock`, newline-delimited JSON-RPC (custom, ~150 LOC).

Message types (worker <-> supervisor):

| Direction | Type | Payload |
|-----------|------|---------|
| supervisor -> worker | `reload-config` | `{ bot: BotConfig }` |
| supervisor -> worker | `shutdown` | `{ graceTimeoutMs }` |
| supervisor -> worker | `status-query` | `{}` |
| worker -> supervisor | `ready` | `{ workerId }` |
| worker -> supervisor | `error` | `{ recoverable, message, stack? }` |
| worker -> supervisor | `metrics` | `{ activeChats, totalRuns, ... }` |
| worker -> supervisor | `log` | `{ level, msg, fields }` |

### 5.3 Crash & Restart

| Failing component | Owner | Policy |
|-------------------|-------|--------|
| CLI child process | worker | Surface error to the originating Lark chat as a card; worker keeps running |
| Worker process | supervisor | Exponential backoff: 1s, 2s, 5s, 15s, 30s. **5 crashes within 3 minutes => bot enters `disabled` state** until manual `lmcb restart <bot>` |
| Supervisor | OS (launchd/systemd) | Restarted by OS; resumes state from `sessions.json` + `processes.json` |
| Lark WS disconnect | worker (internal) | SDK auto-reconnect; manual reconnect after 5s silence |

### 5.4 Shutdown

1. Supervisor receives SIGTERM or `lmcb stop`.
2. Sends `shutdown` IPC to each worker.
3. Each worker:
   - Unsubscribes Lark message events.
   - Waits up to **30 seconds** for in-flight CLI children to finish (user might be awaiting an answer).
   - SIGTERM stragglers, then SIGKILL after another 5 seconds.
   - Flushes `sessions.json` (atomic write).
4. Supervisor waits up to 30s for workers, deletes `ipc.sock` and `processes.json`, exits.

### 5.5 `lmcb restart <bot>`

Blocking call: supervisor SIGTERMs the named worker, waits for exit, re-forks, returns success only after the new worker emits `ready`.

## 6. Adapter Layer

### 6.1 Interface

```typescript
// src/adapters/types.ts

export interface RunContext {
  prompt: string;                    // user text, with mention stripped
  cwd: string;                       // child process CWD
  sessionId?: string;                // prior session id; absent for new conversations
  attachments?: Attachment[];        // downloaded files
  signal: AbortSignal;               // /stop or new message preempt
  env?: Record<string, string>;
}

export type AdapterEvent =
  | { type: 'session-start'; sessionId: string }
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; name: string; input: unknown }
  | { type: 'tool-result'; name: string; ok: boolean; summary?: string }
  | { type: 'thinking'; text?: string }
  | { type: 'error'; message: string; recoverable: boolean }
  | { type: 'done'; finalText: string; sessionId: string; usage?: TokenUsage };

export interface Adapter {
  readonly backend: 'claude' | 'codex' | 'gemini';
  preflight(): Promise<{ ok: boolean; version?: string; error?: string }>;
  run(ctx: RunContext): AsyncIterable<AdapterEvent>;
}
```

### 6.2 Per-Backend Mapping

**ClaudeAdapter**

- Spawn: `claude -p <prompt> --output-format stream-json --verbose --permission-mode bypassPermissions [--resume <session-id>] [--cwd <cwd>] [--append-system-prompt <bridge-prompt>]`
- Input is already a JSON-lines event stream — map directly:
  - `system.init` (carries session_id) -> `session-start`
  - `assistant.delta` content blocks -> `text-delta`
  - `tool_use` block -> `tool-call`
  - `tool_result` block -> `tool-result`
  - final `result` event -> `done`

**CodexAdapter**

- Spawn: `codex exec --json [--session <id>] [--cd <cwd>] <prompt>` (requires `codex-cli` >= the version exposing `--json`; fallback strategy below)
- If `--json` is available, parse JSON Lines similarly to claude.
- Fallback (plain text mode): emit one `session-start` synthesized from CLI stdout headers, stream raw stdout as `text-delta` chunks (line-buffered), parse usage from final summary if present.

**GeminiAdapter**

- Spawn: `gemini --prompt-interactive=false --prompt <prompt> [--chat-id <id>] [--cd <cwd>]` (flags verified against `gemini` 0.42 at implementation time)
- Gemini stdout is human-formatted (ANSI + markdown). Adapter:
  - Strips ANSI escape sequences.
  - Emits stdout chunks as `text-delta`.
  - Treats stderr lines matching error patterns as `error` events.
  - Persists `--chat-id` for continuity; if the CLI version lacks server-side history, fallback is to prepend transcript summary into the next prompt (degraded mode, marked in logs).

### 6.3 Spawn / Timeout / Cancel

Shared scaffolding in `src/adapters/base.ts`:

```typescript
async function* runWithLifecycle(cmd, args, opts, ctx) {
  const child = spawn(cmd, args, opts);
  const onAbort = () => {
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 5000);
  };
  ctx.signal.addEventListener('abort', onAbort);

  let lastByteAt = Date.now();
  const idleMs = setInterval(() => {
    if (Date.now() - lastByteAt > opts.idleTimeoutMs) child.kill('SIGTERM');
  }, 1000);

  try {
    for await (const line of readlines(child.stdout)) {
      lastByteAt = Date.now();
      yield* parseLine(line);
    }
  } finally {
    clearInterval(idleMs);
    ctx.signal.removeEventListener('abort', onAbort);
  }
}
```

### 6.4 Preemption & Batching

Per chat, the worker holds `currentRun: { signal, promise }`:

- Incoming message while `currentRun` is active -> `signal.abort()` -> queue the new message in `pendingPrompts[chat_id]`.
- 500 ms after the last incoming message, the worker concatenates `pendingPrompts[chat_id]` with `\n\n` separators into a single prompt and starts a new run.
- This matches `lark-channel-bridge` behavior to preserve user experience.

### 6.5 Adapter Testing Strategy

- `tests/adapters/__fixtures__/<backend>/<scenario>.jsonl` holds recorded CLI output.
- `MockChildProcess` injects fixtures into the adapter; tests assert the emitted `AdapterEvent` sequence.
- All adapter tests run without Lark and without invoking real CLIs.

## 7. Lark Message Flow

End-to-end path for a single inbound message:

1. **IngressHandler**
   - Parse event: `chat_id`, `chat_type`, `sender_id`, message body, attachments, mentions.
   - Group chat and bot not mentioned (under `group_trigger: mention`) -> silently drop.
   - Access control fails (`allowed_users`, `allowed_chats`) -> silently drop. Never reply to unauthorized senders.
   - Build normalized `IngressMessage`.

2. **CommandRouter**
   - Text begins with `/` -> dispatch to slash-command handler (Section 8).
   - Otherwise -> fall through to dispatcher.

3. **Dispatcher**
   - Look up `sessions.json` for `{ cwd, session_id, backend }`. Initialize from bot defaults if absent.
   - If a `currentRun` exists for `chat_id`, abort it and enqueue the new message; otherwise start a 500 ms batch window.
   - On window close, concat batched messages, download attachments to `media/<chat_id>/`, append attachment paths to prompt.
   - Build `<bridge_context>` and (if present) `<quoted_message>` / `<interactive_card>` blocks, prepended to the prompt — matching `lark-channel-bridge` semantics so system prompts on the CLI side need no rework.

4. **AdapterRunner**
   - Resolve `Adapter` from registry by `backend`.
   - Call `adapter.run({ prompt, cwd, sessionId, signal, ... })`.
   - Iterate `AdapterEvent` stream, forward to streamer.

5. **CardStreamer**
   - On first event, send `interactive` card via `client.im.message.create`. Persist `card_id`.
   - On `text-delta`, append to buffer. Flush patch when **500 ms** elapsed OR **>= 50 chars** accumulated, via `client.im.message.patch`.
   - On `tool-call`, render a collapsible row `Read(file.ts) ...`.
   - On `tool-result`, mark the row done.
   - On `done`, finalize the card: remove spinner, show summary footer (`12.3s | 1.2k tokens`).
   - On `error`, show error row; if `recoverable`, render a retry button (`__claude_cb: true`).

6. **SessionPersister**
   - On `done`, atomically write the new `session_id` and bump `message_count`.

### 7.1 Attachments

- Images and files downloaded to `media/<chat_id>/<message_id>.<ext>`.
- Absolute paths appended to the prompt as `[Attached image: /abs/path.png]` lines.
- **Permanent retention** — no automatic cleanup. Manual cleanup via `lmcb media prune <chat_id> [--older-than 30d]` (future command, not v1 critical).

### 7.2 Bridge Context Injection

Drop-in compatible with `lark-channel-bridge`:

```
<bridge_context>
chat_id: oc_xxx
chat_type: p2p|group
sender_id: ou_xxx
sender_name: ...
</bridge_context>

<quoted_message id="om_xxx" sender_id="ou_xxx" sender_name="..." created_at="..." type="text">
...
</quoted_message>

<interactive_card>
{ ...full card JSON... }
</interactive_card>

<actual user prompt text>
```

This lets the CLI side reuse existing prompt conventions verbatim.

## 8. Slash Commands, Access Control, Daemon

### 8.1 Slash Commands

| Command | Effect |
|---------|--------|
| `/help` | List all commands available to the caller (admin commands hidden from non-admins) |
| `/new [path]` | Reset session for current chat; optionally change cwd |
| `/cd <path>` | Change cwd, keep session |
| `/ws save <name>` | Name the current cwd |
| `/ws use <name>` | Switch to a named workspace (resets session) |
| `/ws list` | List named workspaces |
| `/ws remove <name>` | Remove a named workspace |
| `/status` | Show backend, cwd, session_id, message count for this chat |
| `/stop` | Abort the current run |
| `/timeout <seconds>` | Override `idle_timeout_seconds` for this chat |
| `/sessions` | (admin) List all sessions on this bot |
| `/reconnect` | (admin) Force Lark WS reconnect |
| `/doctor` | Diagnostic: CLI availability, version, recent errors, disk, network |
| `/access` | (admin) View current access lists |

### 8.2 Access Control

1. **App owner** of the Lark app is an implicit admin and **cannot be locked out** of `/access`.
2. `allowed_users` and `allowed_chats` each empty -> no restriction; non-empty -> strict allowlist.
3. Unauthorized messages are dropped silently — never reply, never reveal the bot exists.
4. `/access` and other admin-only commands are gated by `access.admins` plus the implicit owner.
5. Changes to `bots/<name>.yaml` access lists -> supervisor watches mtime and pushes `reload-config` to the worker; manual `lmcb reload <bot>` available as a fallback.

### 8.3 Daemon

- **macOS**: `lmcb daemon install` writes `~/Library/LaunchAgents/ai.lark-multi-cli-bridge.plist` with `KeepAlive=true`, `ThrottleInterval=15`. The plist runs `lmcb start --foreground` so launchd directly supervises the supervisor.
- **Linux**: `~/.config/systemd/user/lark-multi-cli-bridge.service` (Type=simple, Restart=always). Reminds user to `loginctl enable-linger $USER`.
- **Windows**: not supported in v1. `lmcb daemon install` on Windows prints a clear "unsupported in v1" message.
- `lmcb daemon uninstall` / `status` mirror.

## 9. Logging & Telemetry

- `pino` JSON-lines logs; `pino-roll` rotates per day; default 7-day retention (configurable).
- Each worker writes directly to its own file under `logs/workers/<bot>/YYYY-MM-DD.log` (worker holds its own pino instance). Supervisor writes to `logs/supervisor.log`.
- The supervisor `log-aggregator` is responsible only for supervisor-level events (worker spawn / crash / restart decisions, IPC errors, lifecycle transitions) and for forwarding worker-originated alerts (e.g. backoff exhaustion) into `supervisor.log`. It does **not** funnel every worker log line — that would double-write and add IPC pressure.
- Each log entry includes `bot`, `chat_id` (when applicable), `run_id`, `backend`.
- Optional `prometheus_exporter` exposes counters/histograms (active chats, runs/min, error rate per backend, CLI spawn latency). Disabled by default.

## 10. Security & Privacy

- All config files chmod 600, directories 700; auto-corrected at startup.
- `.gitignore` at root of `~/.lark-multi-cli-bridge/` to block accidental commits if the user ever `git init`s the dir.
- `app_secret` plaintext in v1 is a known tradeoff; future `app_secret_ref` providers (keychain/exec) close it without breaking config schema.
- Bridge never echoes raw bridge_context tags back to users (consistent with current `lark-channel-bridge` convention).
- Attachments are stored locally and indefinitely; user is responsible for their content. README documents this clearly.

## 11. Directory Layout (Source)

```
lark-multi-cli-bridge/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── pnpm-lock.yaml
├── README.md
├── README.zh.md
├── LICENSE                              MIT
├── bin/
│   └── lmcb.mjs                         shebang entry
├── src/
│   ├── cli/
│   │   ├── index.ts
│   │   └── commands/
│   │       ├── start.ts | stop.ts | ps.ts | restart.ts | reload.ts
│   │       ├── bot.ts                   add | list | rm | edit
│   │       ├── auth.ts                  device-code OAuth
│   │       ├── logs.ts | doctor.ts
│   │       └── daemon.ts                install | uninstall | status
│   ├── supervisor/
│   │   ├── index.ts
│   │   ├── worker-manager.ts
│   │   ├── ipc-server.ts
│   │   └── log-aggregator.ts
│   ├── worker/
│   │   ├── index.ts
│   │   ├── ingress.ts
│   │   ├── dispatcher.ts
│   │   ├── card-streamer.ts
│   │   ├── session-persister.ts
│   │   └── ipc-client.ts
│   ├── lark/
│   │   ├── client.ts
│   │   ├── ws.ts
│   │   ├── message-parse.ts
│   │   ├── card-builder.ts
│   │   └── attachment.ts
│   ├── adapters/
│   │   ├── types.ts
│   │   ├── base.ts
│   │   ├── claude.ts
│   │   ├── codex.ts
│   │   ├── gemini.ts
│   │   └── registry.ts
│   ├── commands/
│   │   ├── index.ts
│   │   └── handlers/
│   │       ├── help.ts | new.ts | cd.ts | ws.ts
│   │       ├── status.ts | stop.ts | timeout.ts
│   │       ├── sessions.ts | reconnect.ts | doctor.ts | access.ts
│   ├── session/
│   │   ├── store.ts
│   │   ├── workspace.ts
│   │   └── types.ts
│   ├── auth/
│   │   ├── access-control.ts
│   │   └── device-code.ts
│   ├── config/
│   │   ├── load.ts
│   │   ├── schema.ts
│   │   ├── paths.ts
│   │   └── reload.ts
│   ├── daemon/
│   │   ├── macos.ts
│   │   ├── linux.ts
│   │   └── template/
│   ├── telemetry/
│   │   ├── logger.ts
│   │   └── metrics.ts
│   └── util/
│       ├── async-iter.ts | signals.ts | atomic-file.ts | retry.ts
├── tests/
│   ├── adapters/                        unit, fixture-driven
│   ├── worker/                          mock Lark + mock adapter
│   ├── supervisor/                      IPC + worker manager
│   └── e2e/                             mock Lark WS + real CLI smoke
├── docs/
│   ├── architecture.md | architecture.zh.md
│   ├── quickstart.md | quickstart.zh.md
│   ├── adapter-authoring.md             how to add a 4th CLI
│   └── faq.md
└── scripts/
    ├── dev-launch.sh
    └── record-cli-fixture.sh
```

### 11.1 Tech Stack

| Concern | Choice |
|---------|--------|
| CLI framework | `commander` |
| Lark SDK | `@larksuiteoapi/node-sdk` |
| Config | `js-yaml` + `zod` |
| Logging | `pino` + `pino-roll` |
| Process | Node `child_process.fork` / `spawn` |
| IPC | Unix socket + newline-delimited JSON-RPC (custom, ~150 LOC) |
| Test | `vitest` |
| Bundle | `tsup` (ESM + d.ts) |
| Lint | `eslint` + `prettier` |

## 12. Milestones

| M | Duration | Scope | Acceptance |
|---|----------|-------|------------|
| **M1** | 3-4 days | Project scaffolding; `ClaudeAdapter` with full streaming; single-bot worker; Lark WS receive + streaming card | Real Claude conversation in one Lark chat with live card updates |
| **M2** | 3 days | `CodexAdapter` + `GeminiAdapter` (text-delta + done events); adapter unit tests with fixtures | All three bots configured and replying; adapter unit tests green |
| **M3** | 4 days | Supervisor + worker IPC + crash backoff; `lmcb start/stop/ps/restart/reload` | One `lmcb start` brings up all three bots; killing any worker triggers exponential restart; 5-in-3min cap works |
| **M4** | 4 days | Full slash commands; sessions + workspaces; preempt + batch; attachment download; quoted message + interactive card injection | Every `/help` command works; concatenated batched messages; images flow to CLI |
| **M5** | 3 days | Access control + macOS launchd daemon + `/doctor` + Chinese/English docs + E2E tests | Reboot recovery via launchd; docs/ complete; E2E smoke passes |

**Total: 17-18 working days (~4 weeks including buffer).**

Each milestone ends with a smoke run of the full happy path before moving on.

## 13. Open Questions Deferred Past v1

1. Secret storage providers beyond plaintext file (keychain / `exec`).
2. Windows daemon support.
3. Linux systemd: integration with `journalctl` for log access.
4. Per-chat backend override (e.g. `/use gemini` inside a `claude-bot` chat).
5. Prometheus metrics exporter — schema reserved, implementation gated on demand.
6. Multi-host deployment / shared state.

## 14. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Codex CLI lacks `--json` flag at our target version | Medium | Medium | Fallback to plain-text streaming; document degraded mode |
| Gemini CLI session-id flag changes between versions | Medium | Low | Adapter detects at `preflight()`; degrades to prompt-prefix transcript |
| Lark card patch rate limit hit under burst | Low | Medium | Throttle (500 ms / 50 char) + retry-after handling in `card-streamer.ts` |
| Worker crash storm under bad config | Low | High | 5-in-3min crash budget disables worker; surfaced via `lmcb ps` |
| CLI subprocess hangs (network, OAuth) | Medium | Medium | Idle-timeout SIGTERM + SIGKILL after 5s grace |

## 15. References

- Reference repo (read-only, MIT): `/Users/lei.wang2/Downloads/wiz/projects/feishu-claude-code-bridge/`
- Existing internal daemon (for behavior parity): `lark-channel-bridge` v0.1.33 at `/Users/lei.wang2/.nvm/versions/node/v24.13.1/lib/node_modules/lark-channel-bridge/`
- Claude Code SDK / CLI docs (Anthropic)
- Lark Open Platform SDK: `@larksuiteoapi/node-sdk`
- Codex CLI 0.130.0 docs
- Gemini CLI 0.42.0 docs

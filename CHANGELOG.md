# Changelog

All notable changes to this project will be documented in this file. Format inspired by [Keep a Changelog](https://keepachangelog.com).

中文版: [CHANGELOG.zh.md](CHANGELOG.zh.md)

## [Unreleased]

### Added

- **First card per turn is now a Lark quote-reply against the user's message.** Sent via `im.message.reply` with the user's `message_id` as the anchor, so the card renders under a `回复 <user>:` header and the original message gets a `N 条回复` badge — much clearer attribution in busy group chats. Synthetic events (`__claude_cb` card-button callbacks) still send top-level since they have no real user message to anchor to.
- **Gemini 0.44 stream-json adapter** with incremental text streaming, tool-call/result rendering, and UUID-based session resume. Drop-in upgrade from the prior fresh-only adapter: gemini bots now stream output chunk-by-chunk into the card, surface tool calls (`✅ list_directory — ...`), and remember conversation context across turns on par with claude / codex bots.

### Changed

- **SessionStore is now scoped per (chatId, botName)** instead of per chat. A chat served by multiple bots (e.g. `claude-bot` + `codex-bot` in the same group) keeps an independent `sessionId` / `cwd` slot for each bot. Legacy v1 files (`chats[chatId]` = ChatSession) are auto-migrated to v2 (`chats[chatId][botName]` = ChatSession) on first `load()` and persisted, no manual cleanup required. The store API now takes a `botName` parameter — `get(chatId, botName)` / `reset(chatId, botName)` / `setCwd(chatId, botName, cwd, reset)` — and `list()` returns flattened `{chatId, botName, session}` entries.
- **Lark SDK errors render in full instead of truncated to `[Object]` / `[Array]`.** A new `adaptLarkLogger(pinoLogger)` adapter routes SDK log lines through pino with `util.inspect({depth: 10})`, so nested API error payloads (`field_violations`, `config`, `response.data`) land in the worker log with full structure. The worker wires this into both `Lark.Client` and `Lark.WSClient`.

### Fixed

- **Cross-bot session bleed (root cause)**: a `claude-bot` session UUID was being passed to codex's `exec resume`, which then bailed with `thread/resume: no rollout found for thread id <id>`. The chat was effectively bricked for the second bot until `/new`. The per-(chatId, botName) SessionStore scoping above eliminates this at the source — `claude-bot`'s UUID is never visible to `codex-bot` even when they share a chat.
- **Gemini CLI 0.42+ arg compatibility**: `--prompt-interactive=false` was being parsed by 0.42 yargs as "set `-i` to value 'false'", colliding with `-p` (`Cannot use both --prompt and --prompt-interactive together`). `--chat-id` was removed entirely in favour of `--resume`. Both flags are dropped from the adapter.
- **Gemini agent-loop tool events no longer freeze the card on `🧠 正在思考`.** The initial 0.44 parser only handled `init` / `message` / `result`, but gemini-cli is agentic by default and emits `tool_use` / `tool_result` lines around every internal tool call (`list_directory`, `google_web_search`, etc.). Parser now maps `tool_use → tool-call` and `tool_result → tool-result` so the card streamer renders the agent loop in real time.
- **⏹ stop button (and every other card-button route through the internal command router) no longer silently no-ops.** CardKit 2.0 cards (which the bridge has rendered since v0.4.0) deliver `card.action.trigger` events with `open_chat_id` / `open_message_id` nested under `event.context`; the parser only checked the top level, returned `undefined`, and `ws.ts`'s `if (parsed) emit` swallowed the click without a single log line. `parseCardActionEvent` now falls back to `event.context.*` after the top-level / snake-case attempts (matching the SDK's own `normalizeCardAction` chain). Defense in depth: `ws.ts` now warns through `opts.logger` when the parser returns `undefined` so any future schema bump lands as a `[ws] card.action.trigger unparseable` log entry instead of a dead button.

### Internal

- New `src/lark/sdk-logger.ts` — Lark SDK `Logger` interface implementation that proxies to pino with full-depth inspect.
- New exported `parseGeminiJsonLine` in `src/adapters/gemini.ts` alongside the adapter (independently unit-tested).
- New test fixtures: `tests/adapters/__fixtures__/gemini/stream-json-{simple,tools}.jsonl`, plus `tests/worker/lark-sink.test.ts` covering both reply and top-level `im.message.create` branches.

## [v0.7.1] - 2026-06-02

### Fixed

- **Per-bot lark-cli identity is now correctly enforced.** The previous `LARKSUITE_CLI_APP_ID/SECRET/BRAND` env injection (introduced in v0.7.0) did not actually work on lark-cli 1.0.43+: those env vars enter "external credentials" mode but never mint a usable bot token, so every bot silently fell back to whichever profile `lark-cli auth login` had touched last. Replaced with: at worker startup `ensureLarkProfile(bot)` registers a `lark-cli profile` per bot (`profile add --app-secret-stdin`), `provisionLarkShim(bot)` writes a PATH shim at `~/.lark-multi-cli-bridge/shims/<bot>/lark-cli` that `exec`s the real binary with `--profile <app_id>` pinned, and the dispatcher prepends that shim dir to every LLM child's `PATH`. Multi-bot deployments now route every `lark-cli` call to the right identity transparently. See `docs/architecture.md` → "How lmcb isolates bot identity for lark-cli children".
- **`lark-cli profile list` no longer fails with `unknown flag: --format`** on lark-cli 1.0.43/1.0.45 — `profile list` emits JSON by default, the flag never existed.

### Changed

- **Tool-call rendering switched from per-tool collapsible panels to a single blockquote list.** Each tool now renders as `> ✅ **Tool** — summary`, with consecutive tools sharing one blockquote element. Errors stay inline (`> ↳ <first-line of output>`, capped at 150 chars) — no more red-bordered panel. The last tool while the run is still in flight keeps a live `_运行中…_` panel so long tasks remain observable. Full tool detail (input + output, stack traces) is in the worker log. See `docs/architecture.md` → "Tool-call rendering".

### Internal

- New `src/lark/lark-cli-provision.ts` (idempotent profile registration, shim writer, hardened `resolveRealLarkCli` with shim-recursion guard via `path.resolve` normalization, internal `which` helper).
- `paths.shimsDir(botName)` and `paths.shimsRoot` honor `LMCB_HOME` so sandboxed runs and tests stay isolated.
- Shim is single-quoted (`exec '<path>' --profile '<app_id>' "$@"`) to prevent injection via apostrophe / newline in `app_id` or installed binary path.
- `Dispatcher.extraEnv` JSDoc and `tests/worker/dispatcher-extra-env.test.ts` header updated to reference the PATH shim model (was: `LARKSUITE_CLI_*` env keys).

## [v0.7.0] - 2026-06-01

### Added

- **Bundled bot-skill system prompt, injected into every backend by default.** Teaches the LLM about the bridge's `<bridge_context>` / `<quoted_message>` / `<interactive_card>` blocks, how to send interactive cards via the local `lark-cli`, and how to drive `lark-cli auth login` device flow safely. Controlled by two new per-backend YAML fields: `injectSkillPrompt` (default `true`) and `appendSystemPrompt` (optional, concatenated after the skill prompt). Injection mechanism: `claude` uses `--append-system-prompt`; `codex` and `gemini` prepend with a `\n\n---\n\n` separator.
- **LLM card-button callbacks via `__claude_cb` marker.** When the LLM emits an interactive card with a button whose `value` contains `__claude_cb: true`, clicking the button re-enters the same LLM session with a synthetic `[card-click] {...}` message (the marker stripped before forwarding). Enables multi-step button-driven flows. Buttons without `__claude_cb` (e.g., the bridge's own `/status` buttons) continue to dispatch through the internal command router and are never seen by the LLM.

## [v0.5.2] - 2026-06-01

### Fixed

- **Group `@bot + multi-line` no longer silences the bot.** Lark auto-upgrades such messages from `text` to `post` (rich text); the previous parser returned an empty string for `post`, causing the worker to silently drop the message. `extractPromptFromContent` now flattens `post` to Markdown (paragraphs joined by `\n`, `@name`, `[text](url)`, inline code, code blocks).
- **Per-chat session isolation** was already keyed by `chat_id`; the fix above makes new group-chat sessions actually materialize (they were invisible before because the empty-text guard blocked them).

### Added

- `extractPromptFromContent(messageType, content, mentions)` — pure function that handles all Lark message types, independently testable.
- `post` inline `img` tags push a `RawAttachment` and emit `[image]` in the text.
- `audio` messages emit `[audio N seconds]` / `[audio]` marker so they are not silently dropped.
- `merge_forward` messages emit `[merge_forward N messages]` marker (full flatten of inner messages is a TODO requiring an extra Lark API call).
- `log.info({ chatId, chatType, sender }, 'message received')` at top of message handler to verify per-chat session isolation in the wild.

## [v0.5.1] - 2026-06-01

### Added

- **Card button callback handling**: clicking the ⏹ button on a streaming card now triggers `dispatcher.abort(chatId)` and stops the in-flight run.
- `src/lark/card-action.ts` — `parseCardActionEvent` + `CardActionEvent` type with defensive dual-shape parsing (`open_chat_id` / `chat_id` fallback).
- `LarkWsClient` registers `card.action.trigger` alongside `im.message.receive_v1`; emits typed `'card-action'` events.
- Worker listens for `'card-action'` and routes `cmd: 'stop'` through the same access-control gate as inbound messages.

## [v0.4.0] - 2026-05-31

### Changed

- **Streaming card UI rewritten** to mirror `feishu-claude-code-bridge`'s polished look: no header bar, `streaming_mode` toggle, collapsible reasoning + tool panels, footer status, terminal-state notes, stop button.

### Added

- `src/lark/run-state.ts` — RunState data model + mutation helpers.
- `src/lark/tool-render.ts` — `toolHeaderText`/`toolBodyMd` for tool panels.
- `CardStreamer.onThinkingDelta` for future thinking-event hookup.

### Internals

- Tool group auto-collapses at 3+ calls (each Feishu element ≤30 KB).

## [v0.3.0] - 2026-05-31

### Added

- **Scan-to-create QR flow** in `lmcb init` via `@larksuiteoapi/node-sdk`'s `registerApp`. Users scan a QR code with the Lark mobile app and Lark auto-creates an internal-use application under their own tenant, returning `app_id`/`app_secret` directly.
- `qrcode-terminal` dependency for rendering the QR in the terminal.
- `src/auth/register-app.ts` exposing `scanRegisterApp()`.
- `lmcb bot add --tenant <lark|feishu>` flag.

### Changed

- `lmcb init` provisioning method prompt defaults to scan; manual paste is option 2.
- Docs updated to highlight scan-to-create.

## [v0.2.0] - 2026-05-31

### Added

- `lmcb init` interactive wizard for first-time setup. Walks the user through choosing backend → naming bot → entering app_id/secret → writing YAML, and loops to chain multiple bots in one session.

## [v0.1.0] - 2026-05-31

Initial release. M1-M5 of the implementation plan complete.

### Added

- 3 adapters (Claude / Codex / Gemini) with a streaming `AdapterEvent` interface.
- Supervisor + per-bot workers with crash budget and exponential backoff.
- Unix-socket JSON-RPC IPC (`lmcb start/stop/ps/restart/reload`).
- 11 slash commands (`/help`, `/new`, `/cd`, `/ws`, `/status`, `/stop`, `/timeout`, `/access`, `/sessions`, `/reconnect`, `/doctor`).
- Access control with implicit app-owner admin.
- macOS launchd daemon (`lmcb daemon install/uninstall/status`).
- Streaming card updates throttled to 500 ms / 50 chars.
- Preempt + 500 ms batch (rapid follow-ups merge).
- Per-chat session continuity via CLI's own session id.
- Attachment download (images + files) appended to prompt as `[Attached <kind>: <abs path>]`.
- `bridge_context` / `quoted_message` / `interactive_card` injection (compatible with `lark-channel-bridge` convention).
- E2E test scaffold.
- Bots-dir hot-reload (500 ms debounce).
- App-owner discovery via Lark SDK.
- README + quickstart + architecture + adapter-authoring + FAQ (English + Chinese).
- MIT license.

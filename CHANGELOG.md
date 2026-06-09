# Changelog

All notable changes to this project will be documented in this file. Format inspired by [Keep a Changelog](https://keepachangelog.com).

中文版: [CHANGELOG.zh.md](CHANGELOG.zh.md)

## [Unreleased]

### Added

- **First card per turn is now a Lark quote-reply against the user's message.** Sent via `im.message.reply` with the user's `message_id` as the anchor, so the card renders under a `回复 <user>:` header and the original message gets a `N 条回复` badge — much clearer attribution in busy group chats. Synthetic events (`__claude_cb` card-button callbacks) still send top-level since they have no real user message to anchor to.
- **Gemini 0.44 stream-json adapter** with incremental text streaming, tool-call/result rendering, and UUID-based session resume. Drop-in upgrade from the prior fresh-only adapter: gemini bots now stream output chunk-by-chunk into the card, surface tool calls (`✅ list_directory — ...`), and remember conversation context across turns on par with claude / codex bots.

### Changed

- **Card text is markdown-normalized so dense agent output stops collapsing into a wall.** The bridge passed agent text verbatim into Lark's card `markdown` widget, which needs a blank line (`\n\n`) to separate block-level pieces — so the codex backend's denser, single-newline output rendered as a wall while claude's blank-line-separated output looked airy. (Confirmed *not* a one-shot-emission issue: the reference project `zarazhangrui/lark-coding-agent-bridge` emits codex's whole message in one block and renders verbatim too, with no normalization.) New `normalizeMarkdown` (`src/lark/markdown-normalize.ts`) re-inserts the expected blank lines — around headings, before lists/blockquotes, between prose lines — while passing fenced code verbatim, detecting **real** GFM tables (a delimiter row, not bare pipes) and keeping their rows intact, and keeping indented list-item / blockquote continuations attached so a list is never split; runs of blank lines collapse to one and it is idempotent. Applied to the answer text groups in `renderRunCard`; harmless for claude, the fix for codex/gemini. (Hardened after a codex code review flagged list-continuation splitting and over-broad pipe→table detection.) See [docs/changes/2026-06-05-markdown-normalize.md](docs/changes/2026-06-05-markdown-normalize.md).
- **Lark SDK construction de-duplicated via `baseSdkOptions`.** `createLarkClient` and `LarkWsClient` shared identical copies of the `domain` / `loggerLevel` / conditional-`logger` triple; both now spread `baseSdkOptions(opts)` from `src/lark/sdk-options.ts`. Behavior-preserving refactor. See [docs/changes/2026-06-03-base-sdk-options.md](docs/changes/2026-06-03-base-sdk-options.md).
- **SessionStore is now scoped per (chatId, botName)** instead of per chat. A chat served by multiple bots (e.g. `claude-bot` + `codex-bot` in the same group) keeps an independent `sessionId` / `cwd` slot for each bot. Legacy v1 files (`chats[chatId]` = ChatSession) are auto-migrated to v2 (`chats[chatId][botName]` = ChatSession) on first `load()` and persisted, no manual cleanup required. The store API now takes a `botName` parameter — `get(chatId, botName)` / `reset(chatId, botName)` / `setCwd(chatId, botName, cwd, reset)` — and `list()` returns flattened `{chatId, botName, session}` entries.
- **Lark SDK errors render in full instead of truncated to `[Object]` / `[Array]`.** A new `adaptLarkLogger(pinoLogger)` adapter routes SDK log lines through pino with `util.inspect({depth: 10})`, so nested API error payloads (`field_violations`, `config`, `response.data`) land in the worker log with full structure. The worker wires this into both `Lark.Client` and `Lark.WSClient`.

### Fixed

- **Card command buttons route structurally and fail visibly.** Code-review follow-up to the card-button fix below: clicks no longer round-trip through a slash string (`cmdToSlash` → `/ws use ${name}`), which the router re-split on whitespace so a workspace name like `foo bar` resolved to the truncated prefix `foo` — the wrong target if both exist. `cmdToCommand` now returns a structured `{name, args}` and `CommandRouter.dispatchParsed` runs it without re-splitting, so the name the card shows is the name that's used. And a failing click now sends a best-effort `⚠️ command failed: …` reply (logic extracted into `makeDispatchCommand`) instead of silently logging — no more dead button in group chats where the worker log is invisible. See [docs/changes/2026-06-05-card-action-routing-hardening.md](docs/changes/2026-06-05-card-action-routing-hardening.md).
- **Card buttons other than ⏹ stop now actually run.** Every interactive-card button the bridge renders (`/help`, `/status`, `/ws list` cards) carries a `value.cmd` like `new` / `status` / `help` / `ws.list` / `ws.use` / `ws.remove`, but `makeCardActionHandler` only implemented `stop` — every other click hit `default → log('unknown card action')` and did nothing, despite the comment claiming "internal slash-command buttons (preserved)". A new pure `cmdToSlash(cmd, value)` maps the button to slash text (`ws.use` + `value.name` → `/ws use <name>`) and an injected `dispatchCommand` runs it through the **same `CommandRouter`** the typed `/command` path uses (admin recomputed from the clicker's open_id; reply/replyCard target the click's chat). Reply closures were extracted into a shared `makeReplies(chatId)`. See [docs/changes/2026-06-05-card-action-command-routing.md](docs/changes/2026-06-05-card-action-command-routing.md).
- **`/timeout <seconds>` now actually changes the idle timeout.** It replied `timeout override accepted: …s (applies on next run)` but never persisted the value, and the `Dispatcher` was constructed without `resolveIdleTimeoutMs`, so the per-chat override hook was always `undefined` — the ack was a lie. The override is now persisted as an optional `ChatSession.idleTimeoutMs` (via new `SessionStore.setIdleTimeout`; survives `/new` and `/cd` since it's a chat preference, not per-session-id), and `worker/index.ts` passes `resolveIdleTimeoutMs: (chatId) => sessions.get(chatId, bot.name)?.idleTimeoutMs` into the dispatcher, which already prefers an override over the bot default. See [docs/changes/2026-06-05-timeout-override-wiring.md](docs/changes/2026-06-05-timeout-override-wiring.md).
- **A mistyped `/cd` path no longer bricks the chat with a misleading error.** `/cd <path>` and `/new <path>` stored the user-supplied cwd without checking it exists; the next agent run then failed with `failed to spawn codex: spawn codex ENOENT` — Node reports a nonexistent cwd identically to a missing binary, pointing debugging at the wrong cause. Both commands now stat-validate the target and reject (`directory does not exist: …` / `not a directory: …`) without touching the session store, and `spawnWithLifecycle` disambiguates the remaining case (cwd deleted after being stored) by reporting `directory does not exist: <cwd>` (phrasing matched to the command-time message). The thrice-duplicated `resolveCwd` helper is consolidated into `src/commands/cwd.ts`. See [docs/changes/2026-06-04-cwd-validation-and-spawn-cwd-error.md](docs/changes/2026-06-04-cwd-validation-and-spawn-cwd-error.md).
- **Background `lmcb start` could not start the supervisor at all.** The detached spawn computed the supervisor entry path against the *source* layout (`src/cli/commands/`), but tsup flattens the CLI into `dist/cli/index.js`, so the path resolved outside `dist/` and the child died instantly — silently, since it runs with `stdio: 'ignore'` while the CLI still printed `supervisor started (background)`. The path now resolves one level up to the sibling `dist/supervisor/index.js`, and a pre-spawn guard exits loudly with `supervisor entry not found` if the build layout ever drifts again. Foreground mode (`--foreground`) was never affected. See [docs/changes/2026-06-03-fix-daemon-supervisor-path.md](docs/changes/2026-06-03-fix-daemon-supervisor-path.md).
- **Bot self open_id / app owner resolution no longer fails on every startup.** `fetchBotSelfOpenId` went through the SDK's raw `httpInstance` (no auth, no domain baseURL — always threw) and `fetchAppOwnerOpenId` omitted the API's mandatory `lang` param (400 `lang is required`). Both silently returned `undefined`, so group @-mention prefixes were never stripped and the app-owner access fallback never resolved. Now via the authenticated `client.request` and `params: { lang }` with `owner_id`/`creator_id` fallback. See [docs/changes/2026-06-03-bot-self-open-id-resolution.md](docs/changes/2026-06-03-bot-self-open-id-resolution.md).
- **`ensureLarkProfile` verifies the profile actually landed after `profile add`.** The add is a read-modify-write on a shared config file; a concurrent sibling-worker add or a diverging config home (`LARK_CHANNEL` / `LARK_CLI_HOME`) could swallow it while the worker still logged "provisioned" — surfacing much later as `profile not found` on every LLM lark-cli call. A post-add re-list now turns any lost write into a loud startup error. See [docs/changes/2026-06-03-profile-provision-verify.md](docs/changes/2026-06-03-profile-provision-verify.md).
- **Card buttons no longer die with "目标回调服务当前未在线" after a network blip.** The worker's Lark WebSocket could go half-open (server-side drop during an idle window; NAT/proxy idle reclaim) and the SDK never noticed: its pong-liveness watchdog is opt-in and `LarkWsClient` didn't pass `wsConfig.pingTimeout`, so `readyState` stayed `OPEN`, no `close`/`error` fired, auto-reconnect never ran, and Lark saw the app as offline until a manual restart. The `WSClient` is now constructed with `wsConfig: { pingTimeout: 3 }` (terminate + reconnect 3 s after an unanswered ping), `handshakeTimeoutMs: 8000` (fast-fail handshakes), and warn-level `onReconnecting`/`onReconnected` logs so future drops are visible in the worker log. See [docs/changes/2026-06-03-ws-ping-timeout-watchdog.md](docs/changes/2026-06-03-ws-ping-timeout-watchdog.md).
- **Cross-bot session bleed (root cause)**: a `claude-bot` session UUID was being passed to codex's `exec resume`, which then bailed with `thread/resume: no rollout found for thread id <id>`. The chat was effectively bricked for the second bot until `/new`. The per-(chatId, botName) SessionStore scoping above eliminates this at the source — `claude-bot`'s UUID is never visible to `codex-bot` even when they share a chat.
- **Gemini CLI 0.42+ arg compatibility**: `--prompt-interactive=false` was being parsed by 0.42 yargs as "set `-i` to value 'false'", colliding with `-p` (`Cannot use both --prompt and --prompt-interactive together`). `--chat-id` was removed entirely in favour of `--resume`. Both flags are dropped from the adapter.
- **Gemini agent-loop tool events no longer freeze the card on `🧠 正在思考`.** The initial 0.44 parser only handled `init` / `message` / `result`, but gemini-cli is agentic by default and emits `tool_use` / `tool_result` lines around every internal tool call (`list_directory`, `google_web_search`, etc.). Parser now maps `tool_use → tool-call` and `tool_result → tool-result` so the card streamer renders the agent loop in real time.
- **⏹ stop button (and every other card-button route through the internal command router) no longer silently no-ops.** CardKit 2.0 cards (which the bridge has rendered since v0.4.0) deliver `card.action.trigger` events with `open_chat_id` / `open_message_id` nested under `event.context`; the parser only checked the top level, returned `undefined`, and `ws.ts`'s `if (parsed) emit` swallowed the click without a single log line. `parseCardActionEvent` now falls back to `event.context.*` after the top-level / snake-case attempts (matching the SDK's own `normalizeCardAction` chain). Defense in depth: `ws.ts` now warns through `opts.logger` when the parser returns `undefined` so any future schema bump lands as a `[ws] card.action.trigger unparseable` log entry instead of a dead button.

### Internal

- New `pnpm-workspace.yaml` with `allowBuilds: {esbuild: true, protobufjs: true}` — pnpm 11 removed `onlyBuiltDependencies` and blocks all postinstall scripts by default, which broke `pnpm install` (and therefore every script) on fresh checkouts.
- New `src/lark/sdk-logger.ts` — Lark SDK `Logger` interface implementation that proxies to pino with full-depth inspect.
- New exported `parseGeminiJsonLine` in `src/adapters/gemini.ts` alongside the adapter (independently unit-tested).
- New test fixtures: `tests/adapters/__fixtures__/gemini/stream-json-{simple,tools}.jsonl`, plus `tests/worker/lark-sink.test.ts` covering both reply and top-level `im.message.create` branches.
- **Per-change documentation tracking convention.** New root `CLAUDE.md` defines the rule that every logical change ships with a bilingual doc under `docs/changes/`; added `docs/changes/{TEMPLATE,INDEX}.{md,zh.md}` and a mandatory `architecture.md` sync rule. Refreshed the `architecture.md` version marker (v0.4.0 → v0.7.1). See [docs/changes/2026-06-02-introduce-change-tracking.md](docs/changes/2026-06-02-introduce-change-tracking.md).

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

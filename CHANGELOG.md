# Changelog

All notable changes to this project will be documented in this file. Format inspired by [Keep a Changelog](https://keepachangelog.com).

中文版: [CHANGELOG.zh.md](CHANGELOG.zh.md)

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

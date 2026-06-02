# lark-multi-cli-bridge (lmcb)

A Lark/Feishu chat bridge that routes inbound messages to **Claude Code**, **OpenAI Codex CLI**, or **Google Gemini CLI**, with support for running multiple bots concurrently — one bot per CLI backend — on a single host.

中文版: [README.zh.md](README.zh.md)

## Why

Run a Claude, Codex, and Gemini bot from the same Lark workspace, side by side under one shared supervisor. Each bot keeps its own Lark identity, its own conversation state, its own crash budget, and its own session continuity — but they share the streaming-card UI, the slash-command surface, the access-control model, and the on-disk layout, so operating three bots is barely more work than operating one.

## Features

- **Multi-bot, multi-backend** — one supervisor forks one worker per bot; each worker connects to Lark via its own bot identity and spawns its own CLI (`claude` / `codex` / `gemini`).
- **Per-bot `lark-cli` identity** — at worker startup the bridge registers a `lark-cli` profile for each bot and writes a per-bot PATH shim that pins `--profile <app_id>` on every invocation. The LLM child can call `lark-cli api …` freely; calls always route to the correct bot's identity, even when several bots share one machine.
- **Scan-to-create onboarding** — `lmcb init` defaults to scanning a QR code with the Lark mobile app; Lark auto-creates an internal-use application under your tenant and returns `app_id`/`app_secret`. No developer console visit required.
- **Polished streaming cards** — `streaming_mode` progressive updates; collapsible reasoning panel; tool calls render as a single markdown blockquote (`> ✅ **Tool** — summary`), with the currently-running tool kept as a live panel and errors surfaced inline with a `↳` follow-up; footer status bar; terminal-state note; ⏹ stop button.
- **Quote-reply attribution** — the first card per turn is sent via `im.message.reply` against the user's message, so the original gets a `N 条回复` badge and the bot's card renders under a `回复 <user>:` header — clear attribution even in busy group chats.
- **Per-(chatId, botName) sessions** — two bots active in the same chat keep independent `sessionId` / `cwd`. `claude-bot`'s session UUID is never visible to `codex-bot` (or vice versa), so a single chat can hold parallel conversations with different agents without cross-bleed. Legacy single-slot session files migrate automatically on first load.
- **Preempt + 500 ms batch** — rapid follow-ups merge into a single CLI run instead of spawning a redundant one. The reply quote pins to the latest message in the batch.
- **Session continuity** — multi-turn context preserved via the CLI's own session id: claude `--session`, codex `exec resume <thread_id>`, gemini `--resume <uuid>` (stream-json + tool-call rendering on par with claude/codex).
- **11 slash commands** — `/help`, `/new`, `/cd`, `/ws`, `/status`, `/stop`, `/timeout`, `/access`, `/sessions`, `/reconnect`, `/doctor`.
- **Per-bot access control** — allowlist by user or chat; app owner is implicit admin.
- **Crash recovery** — exponential back-off (1s → 30s); worker disabled after 5 crashes in 3 minutes, re-enabled with `lmcb restart <bot>`.
- **macOS launchd daemon** — `lmcb daemon install` for boot-time start.
- **Bots-dir hot-reload** — edit a `bots/*.yaml` and the worker restarts automatically (500 ms debounce).
- **Attachment support** — images and files downloaded and appended to prompt as `[Attached <kind>: <abs path>]`.
- **Full SDK error visibility** — Lark SDK errors stream through pino with `util.inspect({depth: 10})`, so nested API failures (`field_violations`, `response.data`) land in the worker log with full structure instead of being truncated to `[Object]`.
- State lives in `~/.lark-multi-cli-bridge/` (config, bot YAMLs, sessions, logs, media, per-bot `lark-cli` shims).

## Quickstart

```bash
pnpm install && pnpm build
node ./bin/lmcb.mjs init       # interactive wizard: pick backend, scan QR, done
node ./bin/lmcb.mjs start --foreground
```

The `init` wizard walks you through backend selection, bot naming, and app provisioning (scan QR or paste existing credentials). After completing it, message your new bot in Lark.

Full walkthrough: [docs/quickstart.md](docs/quickstart.md)

## Configuration

### Agent Skills (recommended)

The bridge ships an agent skill, `lark-bridge-overlay`, that teaches the
LLM the bridge-only conventions (how to read `<bridge_context>` /
`<quoted_message>` / `<interactive_card>` blocks, the `__claude_cb`
button-callback pattern, and the foreground-blocking OAuth flow).

It pairs with upstream `larksuite/cli` skills that cover `lark-cli`
itself — the official Lark CLI ships 26 domain skills (`lark-im`,
`lark-base`, `lark-calendar`, etc.). Install both layers in one shot:

```bash
pnpm skills:install -g -y                     # global, no prompts
UPSTREAM_SKILLS='*' pnpm skills:install -g -y # all 26 upstream + overlay
```

By default the install picks the minimum useful upstream set
(`lark-im,lark-shared`) plus this repo's overlay. Override with
`UPSTREAM_SKILLS=lark-im,lark-base,lark-calendar` or any subset.

Pass `-a claude-code,codex,gemini-cli` to install into specific agent
dirs, or `-a '*'` for all. `pnpm skills:install --help`-equivalent is
`npx skills add --help`.

The skill files live in `skills/lark-bridge-overlay/`; verify with
`npx skills list` after installing.

### Skill prompt injection

Every bot, regardless of backend, gets a bundled bot-skill prompt
injected by default. It teaches the LLM about the bridge's
`<bridge_context>` / `<quoted_message>` / `<interactive_card>` blocks,
how to send interactive cards via the local `lark-cli` (including
button callbacks via the `__claude_cb` marker), and how to drive
`lark-cli auth login` device flow safely.

Two per-backend YAML fields control injection:

```yaml
backend:
  type: codex
  codex:
    extra_args: []
  injectSkillPrompt: true        # default; set to false to disable
  appendSystemPrompt: |          # optional, concatenated AFTER the skill prompt
    Additional instructions specific to this bot.
```

Injection mechanism per backend:
- `claude`: `--append-system-prompt <text>` flag
- `codex`, `gemini`: prepended to the prompt with `\n\n---\n\n` separator

### LLM card-button callbacks (`__claude_cb`)

When the LLM emits an interactive card with a button whose `value`
contains `__claude_cb: true`, clicking the button re-enters the same
LLM session with a synthetic `[card-click] {...}` message (the marker
is stripped before forwarding). This lets the LLM build multi-step
flows where the user picks from buttons.

Example button (CardKit 2.0):

```json
{
  "tag": "button",
  "text": { "tag": "plain_text", "content": "方案 A" },
  "behaviors": [{
    "type": "callback",
    "value": { "__claude_cb": true, "choice": "a" }
  }]
}
```

Buttons **without** `__claude_cb` (e.g., the bridge's own `/status`
buttons) continue to dispatch through the internal command router as
before — they are not seen by the LLM.

### codex: skip git repo check

`codex exec` refuses to run outside a Git repository (or a directory
explicitly trusted in `~/.codex/config.toml`) unless invoked with
`--skip-git-repo-check`. Because bridge bots commonly point at `$HOME`
or other non-repo cwds, the bridge passes this flag by default for
every codex bot. You can opt out per bot:

```yaml
backend:
  type: codex
  codex:
    skip_git_repo_check: false   # default true; set false to enforce codex's trust check
```

## Docs

| Doc | Description |
|-----|-------------|
| [docs/quickstart.md](docs/quickstart.md) | Step-by-step setup and first run |
| [docs/architecture.md](docs/architecture.md) | Process topology, module map, IPC, state |
| [docs/adapter-authoring.md](docs/adapter-authoring.md) | How to add a 4th CLI backend |
| [docs/faq.md](docs/faq.md) | Troubleshooting and common questions |

## Status

Active development. **v0.7.1 released**; an `[Unreleased]` batch covering quote-reply, per-(chatId, botName) session scoping, gemini 0.44 stream-json, Lark SDK pino logging, and the CardKit 2.0 stop-button fix is queued for v0.7.2 — see [CHANGELOG.md](CHANGELOG.md).

Tested manually with Lark on macOS. Linux works for foreground mode; the launchd daemon is macOS-only (systemd unit generation is deferred).

## License

MIT. See [LICENSE](LICENSE).

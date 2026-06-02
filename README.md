# lark-multi-cli-bridge (lmcb)

**Drive your local Claude Code / OpenAI Codex / Google Gemini CLI from Lark.** A lightweight bot: one command to start, scan a QR to mint a Lark PersonalAgent app, then DM the bot from Feishu to send screenshots, attach files, run scripts, edit code — every action runs on your own machine.

中文版: [README.zh.md](README.zh.md)

## What it feels like

You already have `claude` / `codex` / `gemini` installed on your laptop. lmcb wraps one of them in a Lark bot so you can reach it from your phone — anywhere. A few concrete moments:

- **Stuck in traffic, prod just broke.** Snap a screenshot of the Sentry stack and DM your `claude-bot`. claude reads the image on your laptop, opens the offending file, drafts a fix, streams the diff back into a Lark card.
- **Away from the desk, want a build status.** DM `codex-bot` "跑下 pnpm test 看哪些挂了". codex runs it locally, the failing test names stream in line by line.
- **In a group with teammates triaging a bug.** @-mention the bot; it answers as a quoted reply so the thread stays legible. ⏹ button on the card to abort mid-stream.

The CLI keeps its native session id between messages, so multi-turn context survives — claude `--session`, codex `exec resume`, gemini `--resume`, transparently.

## 60-second setup

```bash
git clone https://github.com/wang14597/lark-multi-cli-bridge.git
cd lark-multi-cli-bridge
pnpm install && pnpm build

node ./bin/lmcb.mjs init             # interactive: pick backend, scan QR, done
node ./bin/lmcb.mjs start --foreground
```

`init` walks you through:
1. **Pick a backend** — `claude` / `codex` / `gemini` (whichever CLI you have).
2. **Scan a QR** with the Lark mobile app. Lark auto-creates a PersonalAgent app under your tenant and returns `app_id` / `app_secret` to lmcb. **No browser, no developer console required.**
3. Bot YAML is written to `~/.lark-multi-cli-bridge/bots/<name>.yaml` (chmod 600). Then DM the bot.

Full walkthrough: [docs/quickstart.md](docs/quickstart.md)

## What the bot can do for you

User-visible behaviors, in order of how often they matter:

- **Read images and files you send.** Screenshots, PDFs, code files — all downloaded to local disk and injected into the prompt as `[Attached <kind>: <abs path>]` so the CLI can `Read` them with full path.
- **Modify your local files.** The CLI runs on your machine with its normal filesystem access. Use `/cd <path>` to scope the working directory; `/ws` to save and switch named workspaces.
- **Stream output live.** Text, tool calls (`> ✅ **Bash** — pnpm test`), tool failures (inline `↳ AssertionError: …`), thinking panel — all stream into a single Lark card. ⏹ button stops the run mid-stream; `/stop` does the same.
- **Quote-reply attribution.** First card per turn replies the user's message, so the original gets a `N 条回复` badge and the card renders under `回复 <user>:` — groups stay legible.
- **Cross-message continuity.** The CLI's native session id is preserved per chat, so follow-ups remember what you were just discussing.
- **Slash commands in chat** — `/help`, `/new`, `/cd`, `/ws`, `/status`, `/stop`, `/timeout`, `/access`, `/sessions`, `/reconnect`, `/doctor`.
- **Attachment-aware groups.** @-mention to invoke in groups; reply-quote to point the bot at a specific message; the bridge expands `merge_forward` parents so the bot sees the actual thread context.

## When one bot isn't enough

Designed for **one developer's bots on one machine**, but inside that scope it scales cleanly:

- **Different backends side by side.** `claude-bot` + `codex-bot` + `gemini-bot` from one supervisor; each gets its own Lark identity, crash budget, and conversation state.
- **Same backend, multiple personas.** Run `claude-personal-bot` and `claude-team-bot` from separate Lark apps with their own access lists and cwds.
- **Same chat, multiple bots, no bleed.** SessionStore is keyed per `(chatId, botName)` — claude's UUID and codex's thread_id never cross-feed, so a single group can hold parallel conversations with different agents.
- **Per-bot `lark-cli` identity.** Every `lark-cli` call from inside the LLM subprocess routes to the calling bot's profile via a per-bot PATH shim (`--profile <app_id>` pinned). No identity leakage even with many bots active.

## Operational essentials

- **Crash recovery** — exponential back-off (1s → 30s); worker disabled after 5 crashes in 3 minutes, re-enabled with `lmcb restart <bot>`.
- **macOS launchd daemon** — `lmcb daemon install` for boot-time start. Linux works in foreground; systemd unit generation deferred.
- **Bots-dir hot-reload** — edit a `bots/*.yaml` and the worker restarts (500 ms debounce).
- **Preempt + 500 ms batch** — rapid follow-ups merge into a single CLI run rather than spawning a redundant one; the reply quote pins to the latest message in the batch.
- **Full SDK error visibility** — Lark SDK errors stream through pino with `util.inspect({depth: 10})`; nested API failures (`field_violations`, `response.data`) land in worker logs intact instead of being truncated to `[Object]`.
- **Access control per bot** — allowlist by user or chat; the app owner is implicit admin.
- **All state under `~/.lark-multi-cli-bridge/`** — config, bot YAMLs, sessions (per (chatId, botName)), logs, media, per-bot `lark-cli` shims.

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

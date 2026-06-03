# Quickstart

中文版: [quickstart.zh.md](quickstart.zh.md)

## 1. Prerequisites

- **Node.js >= 20** (check with `node --version`).
- **pnpm** (check with `pnpm --version`; install with `npm i -g pnpm` if missing).
- **macOS** — recommended for first-time setup (launchd daemon available). Linux works for foreground mode; the launchd daemon is macOS-only.
- A **real Lark / Feishu account** with access to a tenant. You do not need to create a Lark app in advance — the `lmcb init` wizard does it for you via QR scan.
- At least one CLI backend installed and reachable on your `$PATH` (e.g. `claude`, `codex`, or `gemini`).

## 2. Setup

```bash
git clone <this repo>
cd lark-multi-cli-bridge
pnpm install
pnpm build
```

After the build, the binary is at `./bin/lmcb.mjs`. You can run it directly with `node ./bin/lmcb.mjs` or link it globally:

```bash
npm link   # makes `lmcb` available everywhere
```

## 3. Add your first bot — `lmcb init`

`lmcb init` is an interactive wizard that does three things in one pass:

1. **Creates a PersonalAgent app** under your Lark tenant (60-second QR scan; no developer console required).
2. Writes the bot's config (`app_id` / `app_secret` / backend / cwd) to `~/.lark-multi-cli-bridge/bots/<name>.yaml`.
3. Installs **agent skills** that teach the LLM the bridge's protocol — strongly recommended; what happens if you skip is covered in Step 5.

```bash
node ./bin/lmcb.mjs init
# or, after npm link:
lmcb init
```

You'll see:

```
lmcb init — interactive bot setup
```

### Step 1 — Pick a backend

```
— Backend —
  1. claude
  2. codex
  3. gemini
Pick a backend (1/2/3 or name) [1]:
```

Enter `1` / `2` / `3` or the name. Empty defaults to `claude`. Pick whichever CLI you actually have installed (`which claude` / `which codex` / `which gemini` to check).

### Step 2 — Name the bot

```
Bot name [claude-bot]:
```

Default is `<backend>-bot`. Press Enter to accept, or type a custom name (must be `lowercase-kebab-case`, e.g. `claude-prod-bot`). If you plan to run multiple bots together in one chat for A2A collaboration, give them distinguishable names (`claude-dev` + `codex-dev` is clearer than `*-bot`).

### Step 3 — Pick how the app gets created

```
— Provisioning method —
  1. Scan a QR code with Lark mobile app to auto-create a new app under your tenant (recommended)
  2. Paste an existing App ID + App Secret manually
Pick [1]:
```

#### Option 1 (recommended) — QR scan, auto-create

Press Enter (or type `1`); the terminal shows:

```
Starting Lark scan-to-create flow...

Scan this QR code with the Lark mobile app to create a new internal-use application:

  █▀▀▀▀▀█ ▄▀▄▀█ █▀▀▀▀▀█
  █ ███ █ ▀█▄▀▄ █ ███ █
  █ ▀▀▀ █ █▀█▀▀ █ ▀▀▀ █
  ▀▀▀▀▀▀▀ █ █ █ ▀▀▀▀▀▀▀
  ...(ASCII QR art)...

QR code expires in about 5 minute(s).
You can also open this URL directly: https://...
```

Then:
1. **Open Lark / Feishu on your phone**, tap the scanner, point at the terminal QR.
2. Lark pops a confirmation page: "lark-multi-cli-bridge wants to create a PersonalAgent app for you." Confirm.
3. Lark **auto-creates an internal-use application** — default name `lark-multi-cli-bridge`, bound to your tenant. Permissions (`im:message`, `im:resource`, …) are pre-granted, WebSocket is enabled, `im.message.receive_v1` is subscribed.
4. The moment the app exists, credentials flow back to lmcb:

```
✓ App registered successfully.
  App ID:  cli_xxxxxxxxxxxxxxxx
  Secret:  abcd****
  Tenant:  lark

Bot "claude-bot" added.
```

**If the scan fails** — the QR may have expired (5 min), or the confirmation in the Lark app didn't go through (transient network). The terminal asks:

```
Scan-to-create failed: <error>
Retry scan (r) or switch to manual entry (m)? [r]:
```

`r` mints a fresh QR; `m` switches to manual mode (see Option 2).

#### Option 2 — Paste an existing app's credentials

Type `2`. First pick the tenant:

```
Tenant (lark/feishu) [lark]:
```

`lark` = international; `feishu` = mainland China. This determines API domains. Then the terminal prints what you need to do in the developer console:

```
To get an app_id / app_secret:
  1. Visit https://open.larksuite.com/app    (or https://open.feishu.cn/app for feishu)
  2. Create a "Custom App for Internal Use"
  3. Open the app, go to "Credentials & Basic Info" to see App ID + App Secret
  4. Under "Events & Callbacks" enable WebSocket and subscribe `im.message.receive_v1`
  5. Under "Permissions" grant `im:message`, `im:message:send_as_bot`, `im:resource`
  6. Publish a version of the app

Open the developer console in your browser now? [y/N]:
```

`y` opens the console for you. Once you've completed the six steps there, return to the terminal and paste:

```
App ID (cli_...): cli_aa9.....................
App Secret (hidden input): *********************
```

The secret is hidden as you type (`*` chars only) so it can't leak via screen-record.

When to use Option 2: scan-flow is disabled for your tenant, you want to reuse an app you already configured by hand, or you're running `init` in CI / a headless terminal.

### Step 4 — Write to disk + chain more bots

The bot config is written to `~/.lark-multi-cli-bridge/bots/<name>.yaml`, `chmod 600` (only your user can read). Then:

```
Add another bot? [y/N]:
```

- `y` loops back to Step 1 to add another bot — common pattern is to register `claude-bot` / `codex-bot` / `gemini-bot` all in one go, then drop them into the same group for instant A2A.
- `n` (or Enter) proceeds to Step 5.

### Step 5 — Install agent skills (strongly recommended)

```
— Agent skills —
Install agent skills globally? (recommended)
  - lark-bridge-overlay: bridge-only conventions (injected blocks, card callbacks, OAuth)
  - lark-im, lark-shared: upstream lark-cli usage guides
Without these, your bot may echo bridge XML metadata to users or mishandle cards.
Install now? [Y/n]:
```

**What this does**: the bridge injects a few "bridge-only" XML blocks when talking to the LLM (`<bridge_context>` describes the current chat, `<quoted_message>` represents the message a user is reply-quoting, `<interactive_card>` represents a card the user is quoting, etc.). If the LLM doesn't know these conventions it may:
- Echo the XML metadata back to users (you'll see your bot output raw `<chatId>...` in chat)
- Fail to use `__claude_cb` for card-button callbacks
- Mishandle `lark-cli auth login` device flow (the device-code poll must run foreground-blocking)

The `lark-bridge-overlay` skill teaches the LLM these. Paired with upstream `larksuite/cli` skills like `lark-im` / `lark-shared`, the LLM also learns how to call `lark-cli` correctly to send cards, images, query group members, etc.

**Default Enter = install**:

```
Running: bash /Users/.../scripts/install-skills.sh -g -y

✓ installed lark-bridge-overlay → ~/.claude/skills/
✓ installed lark-im → ~/.claude/skills/
✓ installed lark-shared → ~/.claude/skills/
...
```

Skills install into `~/.claude/skills/`, `~/.agents/skills/`, `~/.codex/skills/`, and `~/.gemini/skills/` (so whichever backend you run, they're picked up).

**If you skip** (type `n`), the terminal says:

```
Skipped. You can install later with: pnpm skills:install -g -y
```

Install later from the repo dir:

```bash
pnpm skills:install -g -y                      # minimal: overlay + lark-im + lark-shared
UPSTREAM_SKILLS='*' pnpm skills:install -g -y  # all 26 upstream domains (lark-base, lark-calendar, lark-doc, …)
```

Or pick specific domains:

```bash
UPSTREAM_SKILLS=lark-im,lark-base,lark-calendar pnpm skills:install -g -y
```

**Already installed**: if lmcb detects `lark-bridge-overlay` in any agent dir, it silently skips this step and prints:

```
Agent skills already installed (lark-bridge-overlay detected). Skipping.
```

### Done

```
Done. Next steps:
  node ./bin/lmcb.mjs start --foreground   # for first-time debugging
  node ./bin/lmcb.mjs ps                   # see worker state
  In Lark, message the bot to see streaming reply.
```

## 4. Start the supervisor

For first-time debugging, use `--foreground` so you can see live logs:

```bash
lmcb start --foreground
```

You will see something like:

```
[supervisor] Starting worker: claude-bot
[claude-bot] Worker ready
```

To run in the background (quiet):

```bash
lmcb start
```

## 5. Test in Lark

1. Open Lark and go to your workspace's **Internal Apps** tab (or search for your bot by name).
2. Start a private conversation with your new bot.
3. Send a message. You should see a streaming card appear with the CLI's response updating in real time.
4. Try `/help` to list all slash commands.

## 6. Manage running bots

| Command | What it does |
|---------|--------------|
| `lmcb ps` | List workers and their status |
| `lmcb restart <bot>` | Restart a single worker |
| `lmcb stop` | Stop the supervisor and all workers |
| `lmcb daemon status` | Check launchd service status (macOS) |

**Slash commands (in Lark chat):**

| Slash command | Effect |
|---------------|--------|
| `/help` | List all slash commands |
| `/new` | Start a fresh session (new chat context) |
| `/cd <path>` | Change working directory (session preserved) |
| `/ws <name>` | Switch named workspace (session reset) |
| `/status` | Show current session info |
| `/stop` | Cancel the running CLI command |
| `/timeout <secs>` | Override idle timeout for this session |
| `/access` | Show or modify bot access list (admin only) |
| `/sessions` | List active sessions |
| `/reconnect` | Force WebSocket reconnect |
| `/doctor` | Report CLI availability and session state |

## 7. Promote to daemon (macOS)

To have the supervisor start automatically at login:

```bash
lmcb daemon install
```

Check status:

```bash
lmcb daemon status
```

Remove the daemon:

```bash
lmcb daemon uninstall
```

After upgrading code, reinstall the daemon:

```bash
lmcb daemon uninstall && pnpm build && lmcb daemon install
```

## 8. Troubleshooting

**`99992402 field validation failed` on startup**

Harmless. `fetchAppOwnerOpenId` calls an SDK endpoint whose request shape varies across SDK versions; lmcb catches the error and falls back to no-owner behavior, so your bot still works. The full SDK error payload (including `field_violations`) is logged through pino with depth-10 inspect — to inspect, tail `~/.lark-multi-cli-bridge/logs/workers/<bot>/<date>.log*` and filter for `src=lark-sdk`. Fixing the call shape itself is a follow-up.

**Log locations**

```
~/.lark-multi-cli-bridge/logs/supervisor.log
~/.lark-multi-cli-bridge/logs/workers/<bot>/YYYY-MM-DD.log
```

**Worker keeps crashing**

If a worker crashes 5 times in 3 minutes it gets disabled. Fix the underlying issue (usually a bad CLI path or missing credentials) then run:

```bash
lmcb restart <bot-name>
```

**Reset and start over**

```bash
rm -rf ~/.lark-multi-cli-bridge/bots/* ~/.lark-multi-cli-bridge/state/sessions.json
lmcb init
```

**Add a second bot for a different backend**

```bash
lmcb init
# choose a different backend (e.g. codex) when prompted
```

Or, if you prefer the CLI directly:

```bash
lmcb bot add codex-bot --app-id cli_yyy --app-secret hex_yyy --backend codex
lmcb restart codex-bot
```

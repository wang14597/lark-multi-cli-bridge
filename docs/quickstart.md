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

Run the interactive wizard:

```bash
node ./bin/lmcb.mjs init
# or, after npm link:
lmcb init
```

The wizard proceeds as follows:

**Step 1 — Pick a backend**

```
? Backend (1=claude, 2=codex, 3=gemini): 1
```

**Step 2 — Name your bot**

```
? Bot name [claude-bot]:
```

Press Enter to accept the default or type a custom name.

**Step 3 — Provisioning method**

```
? Provisioning method (1=scan QR to create app, 2=paste app_id/secret): 1
```

Option 1 (default) — QR scan flow:
- A QR code appears in your terminal.
- Open Lark / Feishu on your mobile device.
- Scan the QR code.
- Lark creates a new internal-use application under your tenant automatically.
- `app_id` and `app_secret` are returned directly to lmcb — no browser visit needed.

Option 2 — Manual paste:
- Paste your existing `app_id` and `app_secret` when prompted.

**Step 4 — Confirmation**

After credentials are verified the wizard prints:

```
✓ App registered: app_id=cli_xxxxxxxx
```

It then writes `~/.lark-multi-cli-bridge/bots/<name>.yaml` (chmod 600).

**Step 5 — Chain more bots**

```
? Add another bot? (y/N):
```

Type `y` to loop back to step 1 and add a codex or gemini bot in the same session.

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

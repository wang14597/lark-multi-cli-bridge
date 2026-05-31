# Quickstart

## 1. Build & link

```bash
git clone <this repo>
cd lark-multi-cli-bridge
pnpm install
pnpm build
npm link   # exposes the `lmcb` command globally (or run via `node ./bin/lmcb.mjs`)
```

## 2. Configure your first bot

## Option A: interactive wizard (recommended for first-time setup)

```bash
node ./bin/lmcb.mjs init
```

The wizard:
1. Asks you to pick a backend (claude / codex / gemini).
2. Defaults the bot name to `<backend>-bot` (you can change it).
3. Tells you how to get `app_id` and `app_secret` from the Lark developer console, and offers to open the browser for you.
4. Validates and stores everything to `~/.lark-multi-cli-bridge/bots/<name>.yaml` (chmod 600).
5. Asks whether to add another bot — you can chain three bots in one wizard run.

## Option B: manual `bot add` (for scripts / automation)

You need a Lark app with `app_id` + `app_secret` and a bot identity attached.

```bash
lmcb bot add claude-bot --app-id cli_xxx --app-secret hex_xxx --backend claude
```

This writes `~/.lark-multi-cli-bridge/bots/claude-bot.yaml`. Edit it manually if you want to tweak `access`, `behavior`, or backend-specific options.

## 3. Start the supervisor

For first-time debugging, run in the foreground:

```bash
lmcb start --foreground
```

In Lark, message your bot. You should see a streaming card with Claude's response.

`Ctrl+C` to stop.

## 4. Promote to background daemon (macOS)

```bash
lmcb start          # background mode
lmcb daemon install # boots on login via launchd
```

## 5. Add more bots

```bash
lmcb bot add codex-bot --app-id cli_yyy --app-secret hex_yyy --backend codex
lmcb bot add gemini-bot --app-id cli_zzz --app-secret hex_zzz --backend gemini
```

When you edit or add a YAML in `bots/`, the supervisor hot-reloads the corresponding worker automatically (debounced 500 ms).

To kick a worker manually: `lmcb restart codex-bot`.

## Useful commands

| Command | What it does |
|---|---|
| `lmcb ps` | List workers and their state |
| `lmcb restart <bot>` | Restart a worker |
| `lmcb stop` | Stop the supervisor (and all workers) |
| `lmcb daemon status` | Check launchd status |
| `lmcb daemon uninstall` | Remove launchd plist |

In Lark chats, use `/help` to list available slash commands.

## Troubleshooting

- `lmcb doctor` (run inside a Lark chat) reports CLI availability and current session state.
- Logs at `~/.lark-multi-cli-bridge/logs/supervisor.log` and `~/.lark-multi-cli-bridge/logs/workers/<bot>/YYYY-MM-DD.log`.
- If a worker keeps crashing (5 times in 3 minutes), it gets disabled. Use `lmcb restart <bot>` to re-enable after fixing the root cause.

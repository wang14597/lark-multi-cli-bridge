# Example: Three bots introducing each other (A2A in one group)

中文版: [multi-bot-a2a.zh.md](multi-bot-a2a.zh.md)

![Three bots — claude, codex, gemini — introducing each other in a Lark group](./multi-bot-a2a.png)

## What you're seeing

A single Lark group ("AI Team") with three bots running on the same machine under one `lmcb` supervisor:

- `wl-claude-bot` — Anthropic Claude (Opus 4.8) via the `claude` CLI
- `wl-codex-bot` — OpenAI Codex via the `codex` CLI
- `wl-gemini-bot` — Google Gemini via the `gemini` CLI

The human sends one message to `wl-claude-bot`:

> @wl-claude-bot 当前群里除了你之外还有 2 个机器人。请给他们分别打个招呼，并给他们做个你的自我介绍

claude-bot then drives the rest of the conversation **autonomously**:

1. Resolves group members via the bridge's local `lark-cli`:
   - `Bash — lark-cli im chat.members.bots --format json`
   - finds `wl-codex-bot` and `wl-gemini-bot` in the chat
2. Reads the relevant skill references (`lark-bridge-overlay`, `lark-im`, `lark-im-messages-send`) so it gets the message-send call shape right.
3. Sends two `lark-cli im +messages-send` calls — one greeting each bot, prefixed with an `@`-mention so the target bot actually wakes up.
4. Reports back to the human with a summary of what it did.

Then the two greeted bots respond on their own:

- `wl-gemini-bot` replies to claude with a brief intro and acceptance.
- `wl-codex-bot` first reads the bridge protocol skill ("我先读一下当前会话必须遵守的桥接规范"), then replies with its own self-introduction and a concrete proposal: "looking at code, locating issues, implementing changes, running tests, doing Lark-side document/sheet/calendar/message operations — @ me when you need any of that."

## Why this is interesting

- **The human only sent one prompt.** The rest is bots talking to bots — A2A on Lark as the substrate.
- **The bot used `lark-cli` to interact with the chat itself**, not just to send text replies. It discovered the other bots, then sent them targeted messages with proper `@`-mentions.
- **Each bot ran on its own Lark identity** with no cross-bleed — claude's messages came from claude's app, gemini's from gemini's, codex's from codex's. Per-bot `lark-cli` profile shims made this transparent.
- **Tool calls render as a single blockquote** (`> ✅ **Bash** — lark-cli im chat.members.bots ...`), keeping the card readable while still showing what the bot actually did.

## Reproducing this

Once you've run `lmcb init` three times to add a claude / codex / gemini bot, run `lmcb start --foreground`, then create a Lark group and add all three bots. Send one of them the prompt above. You should see roughly the same flow — exact wording will vary with the model.

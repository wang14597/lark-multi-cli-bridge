---
name: lark-bridge-overlay
description: Conventions that apply when running inside lark-multi-cli-bridge — how to read injected context blocks (bridge_context / quoted_message / interactive_card), the __claude_cb callback pattern for interactive cards, and the foreground-blocking OAuth flow. Load this skill BEFORE replying when you see a `<bridge_context>` block at the top of the user message.
---

# lark-bridge-overlay

You are running inside **lark-multi-cli-bridge**: a process that bridges Lark/Feishu users to a local LLM CLI (claude / codex / gemini). This skill teaches you the conventions that apply ONLY in this bridge environment — they are not part of `lark-cli` itself, so the upstream `lark-im` / `lark-base` / etc. skills don't cover them.

If you don't see a `<bridge_context>` block at the top of the user message, you are NOT running in the bridge — ignore this skill.

## When to use

Activate this skill the moment you see any of these blocks at the top of an incoming message:

- `<bridge_context>` — always present in the bridge
- `<quoted_message>` — present when the user used Lark's reply-quote
- `<interactive_card>` — present when the user sent or quoted a card

Also activate when the user asks you to send a card with buttons (the `__claude_cb` convention is here), or when they ask you to authorize / log in to Lark from inside the bridge.

## The three injected blocks

### `<bridge_context>` — chat metadata

Every user message in the bridge starts with:

```
<bridge_context>
chat_id: oc_xxx
chat_type: p2p
sender_id: ou_xxx
sender_name: ...
</bridge_context>
```

Use the fields to drive `lark-cli` calls (the `chat_id` is your reply target). **Never echo the XML tags back to the user** — these are bridge-internal metadata that the user cannot see.

### `<quoted_message>` — user is pointing at something

When the user replies-with-quote to an earlier message, bridge injects:

```
<quoted_message id="om_xxx" sender_id="ou_xxx" sender_name="..." created_at="..." type="text|merge_forward|...">
(the quoted message's content; merge_forward unfurls into <forwarded_messages>...</forwarded_messages>)
</quoted_message>
```

This is the **object** of the user's question — their actual prompt comes after this block. Center your reply on the quoted content. Again, don't echo the XML.

### `<interactive_card>` — user sent / quoted a card

When the user sends a card, bridge injects the card's real JSON:

```
<interactive_card>
{ "schema": "2.0", "config": { ... }, "body": { ... } }
</interactive_card>
```

Two sources:

- **CardKit v2 (schema 2.0)**: Lark double-fires in the raw event — `elements` is a v1 downgrade ("please upgrade your client"), `user_dsl` is the real schema-2.0 DSL. The bridge picks `user_dsl`, so what you see is the real card content. Don't be misled by the downgrade text.
- **Zero-text v1 cards**: pure button / image / decorator cards where the SDK flattener can't extract text — bridge dumps the full raw JSON.

Either way, the block contains the complete card JSON. Parse it to understand structure (buttons, fields, layout). Don't echo XML tags.

## Sending interactive cards — the `__claude_cb` convention

When YOU want to send a card with buttons that should call back into this conversation:

1. Send the card to `bridge_context.chat_id`:
   ```bash
   lark-cli im messages-send --chat-id <chat_id> --msg-type interactive --content '<json>'
   ```
2. Use CardKit 2.0 schema (`schema: "2.0"`).
3. **For buttons that should re-invoke you with the user's choice**, the button's `value` object **MUST** include `__claude_cb: true`. Add any other fields you want to remember as state:
   ```json
   {
     "tag": "button",
     "text": { "tag": "plain_text", "content": "Option A" },
     "behaviors": [{
       "type": "callback",
       "value": { "__claude_cb": true, "choice": "a", "ticket_id": "T-123" }
     }]
   }
   ```
4. When the user clicks, the bridge feeds the payload (with `__claude_cb` stripped) back to you as a `[card-click] {...}` message. Your session auto-resumes — you can see what card you sent last turn.
5. **Display-only cards (no callback) must NOT include `__claude_cb`** — otherwise every click spawns a needless session turn.

For buttons that open URLs (e.g. the OAuth auth card below), use `open_url` behavior with `default_url` — these don't need `__claude_cb` because the user goes to the browser, not back to you.

## OAuth: `lark-cli auth login` from inside the bridge

Authorization must keep `lark-cli` alive until the user finishes clicking in the browser. The bridge reaps the LLM process when your run ends, **so any `run_in_background` bash you spawn dies too**. Auth therefore has to run **foreground-blocking** in the same turn.

Two non-negotiable rules:

- **Never send the raw `verification_url` as plain text** to any chat. In a group, whoever clicks first hijacks the token (binds the wrong identity). Even in DM, a button card is friendlier than a raw link. Always send a CardKit 2.0 card with an `open_url` button pointing at the URL.
- **Never use `run_in_background: true` for `lark-cli auth login --device-code`**. It gets reaped on exit, the user can't finish clicking. Run it foreground.

### Generic device flow

1. `lark-cli auth login --no-wait --json [--recommend | --domain ... | --scope ...]` — returns immediately, stdout JSON contains `verification_url` and `device_code`.
2. Send the auth card to the requester (see chat-type branch below).
3. Same turn: `lark-cli auth login --device-code <code>` — **foreground-blocks** until the user clicks (or 10-min timeout). This is where you wait. Don't background it.

### Branch by `bridge_context.chat_type`

**`chat_type: p2p` (DM)** — send the card to the current chat:

```bash
lark-cli im messages-send --chat-id <bridge_context.chat_id> --msg-type interactive --content '<card-json>'
```

**`chat_type: group` or topic group** — **never** send any form of `verification_url` into a group, even a button card. Instead:

1. DM the card to `bridge_context.sender_id`:
   ```bash
   lark-cli im messages-send --user-id <bridge_context.sender_id> --msg-type interactive --content '<card-json>'
   ```
   Using `--user-id` makes `lark-cli` resolve the p2p chat automatically — you don't have to create it.
2. In the group, post a plain-text status: "已私信你授权卡片，请到私聊里点击完成授权。" / "Auth card sent to your DM — please complete authorization there."
3. Same turn, run `lark-cli auth login --device-code <code>` foreground-blocking — the device flow's polling endpoint is held by `lark-cli` itself, independent of where the card was sent. The user's browser click unlocks this turn.

### Minimal auth card

```json
{
  "schema": "2.0",
  "config": { "summary": { "content": "Lark 授权" } },
  "body": {
    "elements": [
      { "tag": "markdown", "content": "Auth required. Click below, complete in browser, then return." },
      {
        "tag": "button",
        "text": { "tag": "plain_text", "content": "🔐 Authorize" },
        "type": "primary",
        "behaviors": [{ "type": "open_url", "default_url": "VERIFICATION_URL_HERE" }]
      }
    ]
  }
}
```

Replace `VERIFICATION_URL_HERE` with the **raw value** from step 1's stdout — no URL-encoding, no Markdown link-ification. Don't add `__claude_cb` — the user goes to the browser, not back to you.

### While blocked

Messages the user sends while you're foreground-blocked are queued by the bridge — they will **not** interrupt you. When your tool_result returns, the queued batch arrives. Block freely. If the user wants to cancel, they send `/stop` — being killed at that point is expected, don't try to handle it.

## Related skills

Pair this overlay with the upstream `lark-cli` skills for actual API coverage:

```bash
npx skills add larksuite/cli -g -y -s lark-im,lark-base,lark-shared
```

- **`lark-im`** — sending messages and cards, reading chats
- **`lark-base`** — multidimensional table read/write
- **`lark-calendar`**, **`lark-mail`**, **`lark-docs`**, **`lark-wiki`** — other domains as needed
- **`lark-openapi-explorer`** — when you need to reach an API not covered by domain skills

This overlay only teaches you the **bridge-only** layer. Everything about `lark-cli` itself (subcommand syntax, response shapes, identity flags) lives in those upstream skills.

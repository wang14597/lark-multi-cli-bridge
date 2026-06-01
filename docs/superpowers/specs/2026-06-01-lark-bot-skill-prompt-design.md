# Lark Bot Skill Prompt + Card Callback — Design Spec

**Date**: 2026-06-01
**Author**: Lei (with Claude as co-author)
**Status**: Draft — pending user review

---

## 1. Background & Motivation

`lark-multi-cli-bridge` currently relays user messages from Feishu/Lark into a
local CLI (`claude` / `codex` / `gemini`) and renders the CLI's streamed output
back as Lark cards. The bridge already injects a `<bridge_context>` block with
`chat_id` / `chat_type` / `sender_id` / `sender_name` ahead of every prompt.

**Gap demonstrated in production** (user-reported on 2026-06-01):
The LLM has no idea it's running inside a Lark bot environment. It does not
know:

- It can shell out to the pre-installed `lark-cli` to call any Feishu Open API
  (list group members, build `<at user_id="...">` mentions, post interactive
  cards, etc.).
- Buttons in cards it sends out can call back to it via the `__claude_cb`
  marker convention (so it can ask the user to choose between options inside a
  multi-turn flow).
- How OAuth `lark-cli auth login` device flow should be driven from inside a
  bridged session (in particular: foreground-block vs background, p2p vs group
  flow).

The open-source reference project `feishu-claude-code-bridge` has solved all
of the above by injecting a ~138-line `BRIDGE_SYSTEM_PROMPT` into every
`claude` invocation via `--append-system-prompt`. Our project supports the
same flag at the adapter layer (`ClaudeAdapter.appendSystemPrompt`) but the
config schema does not expose it, so nothing ever gets injected.

This spec ports the open-source skill prompt verbatim (with project-name
replacement only), routes it through all three backends, and implements the
`__claude_cb` card-callback re-entry mechanism it depends on.

## 2. Goals

1. Every bot, regardless of backend (`claude` / `codex` / `gemini`), gets the
   skill prompt injected by default.
2. The injected prompt is **textually 1:1 identical** to the open-source
   `BRIDGE_SYSTEM_PROMPT`, with only the product name replaced
   (`lark-channel-bridge` → `lark-multi-cli-bridge`) and any references to
   `claude` CLI generalised where appropriate.
3. Card buttons whose `value` contains `__claude_cb: true` re-enter the LLM
   session with the payload as a `[card-click] {...}` text message. Buttons
   that lack the marker fall through to the existing `CommandRouter` dispatch
   path (so `/status`, `⏹ stop`, etc. are unaffected).
4. Bot YAML can opt out (`backend.injectSkillPrompt: false`) or append an
   extra prompt (`backend.appendSystemPrompt: <text>`). Default is opt-in.

## 3. Non-Goals

- **No changes** to `bridge_context` injection content. It already carries
  every field the LLM needs (`chat_id`, `chat_type`, `sender_id`,
  `sender_name`, `quoted_message`, `interactive_card`).
- **No** bundling of `lark-cli`. The user is responsible for installing it
  (already globally present on the target machine: `~/.nvm/.../bin/lark-cli`).
- **No** i18n. Prompt stays in Chinese, matching the open-source source of
  truth.
- **No new** slash commands. The existing `/status` `/help` `/ws` `/access`
  surface stays as-is.
- **No** rewrite of the open-source prompt content (e.g., shortening,
  re-organising). 1:1 port only.

## 4. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Worker process (one per bot)                                │
│                                                              │
│  ┌─────────────────────┐                                     │
│  │ Lark WSClient       │── card.action.trigger ──┐           │
│  │                     │── im.message.receive ─┐ │           │
│  └─────────────────────┘                       │ │           │
│                                                ▼ ▼           │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ card-action handler (worker/index.ts)               │     │
│  │   if value.__claude_cb === true:                    │     │
│  │     enqueue([card-click] {...payload-without-marker})│     │
│  │   elif value.cmd === 'stop':                        │     │
│  │     dispatcher.abort(chatId)                        │     │
│  │   elif value.cmd:                                   │     │
│  │     router.dispatch(`/${value.cmd}`, ctx)           │     │
│  └─────────────────────────────────────────────────────┘     │
│                                │                             │
│                                ▼                             │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ Dispatcher (queue+batch)                            │     │
│  └─────────────────────────────────────────────────────┘     │
│                                │                             │
│                                ▼                             │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ Adapter (claude | codex | gemini)                   │     │
│  │   - resolveSystemPrompt(bot)                        │     │
│  │       = bundled BOT_SKILL_PROMPT (default)          │     │
│  │       + bot.backend.appendSystemPrompt              │     │
│  │       (or empty if injectSkillPrompt=false)         │     │
│  │   - inject via native flag or prompt-prepend        │     │
│  └─────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────┘
```

## 5. Components

### 5.1 Prompt source-of-truth — `src/prompts/lark-bot-skill.ts`

A new module exports a single string constant:

```ts
export const BOT_SKILL_PROMPT: string = `# lark-multi-cli-bridge 运行约定
...
`;
```

Content is byte-for-byte identical to `feishu-claude-code-bridge`'s
`BRIDGE_SYSTEM_PROMPT` (in `src/agent/claude/adapter.ts` lines 15–152) with
exactly these substitutions:

| Open-source token | Our replacement |
|---|---|
| `lark-channel-bridge` | `lark-multi-cli-bridge` |
| `本地 \`claude\` CLI` (in opening sentence) | `本地 CLI（claude / codex / gemini）` |
| `__claude_cb` | `__claude_cb` (unchanged — even though we run multi-CLI, we keep the marker name to avoid breaking any community convention) |

No other edits. Comments, headings, code blocks, line breaks preserved.

### 5.2 Config schema — `src/config/schema.ts`

Extend each backend sub-schema (`ClaudeBackendSchema`, `CodexBackendSchema`,
`GeminiBackendSchema`) with two new optional fields:

```ts
injectSkillPrompt: z.boolean().optional().default(true),
appendSystemPrompt: z.string().optional(),
```

Behaviour:

- `injectSkillPrompt: true` (default) — bridge prepends `BOT_SKILL_PROMPT`.
- `injectSkillPrompt: false` — bridge prepends nothing.
- `appendSystemPrompt: "..."` — bridge concatenates this **after** the skill
  prompt (if injected) or uses it standalone (if not).

### 5.3 Adapter registry — `src/adapters/registry.ts`

`buildAdapter(bot)` resolves the effective system prompt once at adapter
construction, computing:

```
effectivePrompt =
  (bot.backend.injectSkillPrompt ?? true ? BOT_SKILL_PROMPT : '')
  + (bot.backend.appendSystemPrompt ? '\n\n' + bot.backend.appendSystemPrompt : '')
```

Then passes it to the relevant adapter via that adapter's option.

### 5.4 Adapter injection strategies

| Backend | Native flag (preferred) | Fallback |
|---|---|---|
| `claude` | `--append-system-prompt <text>` (already supported) | n/a |
| `codex`  | `codex exec` has no native system-prompt flag at time of writing. **Prepend** `effectivePrompt + '\n\n---\n\n'` to `ctx.prompt`. | (this *is* the fallback) |
| `gemini` | `gemini --prompt` has no native system-instruction flag. **Prepend** as above. | (same) |

Implementation detail: prepending happens inside each adapter's `run()`,
NOT inside `RunContext.prompt` (the bridge-context block from
`bridge-context.ts` is built separately by the worker and stays unchanged).
The order in the final prompt text sent to the CLI is:

```
[system prompt prepended by adapter]
---
<bridge_context>
...
</bridge_context>

<quoted_message>...</quoted_message>
<interactive_card>...</interactive_card>

[user's actual message]
```

For claude, the system prompt goes through `--append-system-prompt` and is
NOT prepended to the user message.

### 5.5 Card-action handler — `src/worker/index.ts`

Currently in `worker/index.ts` line 141–158:

```ts
ws.on('card-action', async (act) => {
  // access check ...
  switch (act.cmd) {
    case 'stop': { dispatcher.abort(act.chatId); break; }
    default: log.info({ cmd }, 'unknown card action');
  }
});
```

**New behaviour** (in priority order):

1. **Access check** — unchanged.
2. **Check `value.__claude_cb === true`** — if true:
   - Strip the `__claude_cb` key from a clone of `value`.
   - Build a synthetic `IngressMessage`:
     - `text = '[card-click] ' + JSON.stringify(stripped)`
     - `chatId = act.chatId`
     - `senderOpenId = act.operatorOpenId`
     - `senderName` undefined (we don't fetch user names for callbacks)
     - `messageId = act.messageId`
     - `chatType` — resolved from session store (existing helper), or default `'p2p'` if absent
   - Call `dispatcher.enqueue(...)` — same path as a real message; the
     existing queue+batch logic handles concurrency.
3. **Fallback on `value.cmd`** — unchanged `stop` / unknown branches.

Why this order: `__claude_cb` is the LLM's own marker for "this button was
mine, hand it back to me". Our internal slash-command buttons (which use
`value.cmd`) MUST NOT accidentally have `__claude_cb` set, and we control
all of them, so the priority is safe. If the LLM ever emits a button with
both `__claude_cb: true` AND `cmd: 'stop'`, the LLM wins (which is the safe
default — don't preempt user-authored LLM flows).

### 5.6 Card-action parser — `src/lark/card-action.ts`

The parser currently requires `value.cmd` to be present:

```ts
const cmd = asStr(value['cmd']);
if (!cmd) return undefined;
```

This will silently drop `__claude_cb` buttons because they may have no
`cmd`. Change:

- Make `cmd` **optional** in the parsed event (`cmd?: string`).
- Drop the early-return on missing `cmd`.
- Still require `chatId`, `messageId`, `operator.open_id`, `action.value`.

The handler (5.5) is responsible for deciding what to do based on the
parsed event's shape.

## 6. Data Flow Examples

### 6.1 LLM sends a callback card, user clicks

```
LLM (in claude run)
  └─ Bash: lark-cli im send-card --chat-id oc_X --card '{... "value": {"__claude_cb": true, "choice": "A"}}'
  └─ exit (run done)

[user taps "方案 A" button in Lark]

Lark WS → bridge: card.action.trigger
       { open_chat_id: oc_X, operator.open_id: ou_U,
         action.value: {__claude_cb: true, choice: "A"} }

worker/index.ts card-action handler:
  - value.__claude_cb === true → strip marker → '{"choice":"A"}'
  - synth IngressMessage { text: '[card-click] {"choice":"A"}', chatId: oc_X, senderOpenId: ou_U }
  - dispatcher.enqueue(...)

Dispatcher:
  - resumes session for chat oc_X
  - new claude run sees prompt with bridge_context + "[card-click] {"choice":"A"}"
  - LLM continues the flow
```

### 6.2 User clicks our internal `/status` card button

```
[user taps "新会话" button — value.cmd === "new"]

Lark WS → bridge: card.action.trigger
       { ..., action.value: {cmd: "new"} }

worker card-action handler:
  - value.__claude_cb !== true → fall through
  - switch (act.cmd): case 'stop' → dispatcher.abort(chatId)
                       default     → log + drop (unchanged)
```

Scope note: this spec preserves the **existing** stop-only fallback. The
only new branch added to the handler is `__claude_cb`. Generalising the
`value.cmd → /${cmd}` router dispatch is tracked in §10 Open Items and is
**out of scope** for v0.7.0.

## 7. Schema Changes

### 7.1 `BackendSchema` discriminated union

Each sub-schema (`claude` / `codex` / `gemini`) gains:

```ts
injectSkillPrompt: z.boolean().optional(),
appendSystemPrompt: z.string().optional(),
```

These are **per-backend** (not in a shared parent) because each backend may
want a different prompt later (e.g., codex/gemini disabling the OAuth section
because they can't reasonably use it). The default `true` is applied in
`registry.ts`, not in the zod schema, to keep config files clean (an absent
field is the same as `true`).

### 7.2 Bot YAML example

```yaml
name: my-codex-bot
app:
  id: cli_xxx
  secret: yyy
backend:
  type: codex
  cliPath: /usr/local/bin/codex
  injectSkillPrompt: true        # default; can omit
  appendSystemPrompt: |          # optional extra
    Additional instructions specific to this bot.
```

## 8. Error Handling

- **Prompt file missing at build time** — unit-test asserts the constant is
  non-empty; bundler will fail at build time if the import path is wrong.
- **Adapter prepend fails (e.g., final prompt exceeds CLI's max-arg-length)**
  — fail loud with an `error` event. Mitigation: keep prompt under 4 KB
  (open-source one is ~3.5 KB; well under macOS `ARG_MAX` of 1 MB).
- **`__claude_cb` payload too large** — `JSON.stringify` and let the CLI
  handle it; same path as any user message.
- **`bridge_context.chat_type` missing in card-action context** — default
  `'p2p'` (most common case; group bots can leak text but won't crash).

## 9. Testing Strategy

| Layer | Test |
|---|---|
| Prompt content | `prompts/lark-bot-skill.test.ts` — assert string contains key markers: `lark-multi-cli-bridge`, `bridge_context`, `__claude_cb`, `lark-cli auth login`. Snapshot-test the SHA-256 of the constant to detect accidental edits. |
| Schema | `config/schema.test.ts` — new bot YAML with `injectSkillPrompt: false` parses; absent field defaults via registry to `true`. |
| Registry | `adapters/registry.test.ts` — given a bot with `injectSkillPrompt: false`, the constructed adapter's `appendSystemPrompt` opt is `''` (or undefined); given default config, it equals `BOT_SKILL_PROMPT`. |
| Card-action parser | `lark/card-action.test.ts` — new case: parser accepts `value: {__claude_cb: true}` without `cmd`. |
| Card-action handler | `worker/card-action-callback.test.ts` (new) — fake dispatcher; feeding a `__claude_cb` event enqueues a `[card-click] {...}` IngressMessage. |
| End-to-end | Manual smoke test in Lark (group + p2p) — covered in user acceptance, not CI. |

## 10. Open Items (deferred to plan stage)

- Whether to fold the generalised "dispatch any `value.cmd` through router"
  into this work. Spec says **NO** — scope creep — but may be lifted if
  trivial during implementation.
- Whether to add a `lmcb doctor` check for `lark-cli` presence in PATH.
  Decision: **NO**, document in README instead.

## 11. Rollout

Single PR / single tag `v0.7.0` once merged. No phased rollout — the change
is fully additive (default-on for fresh installs; existing bot YAMLs without
the new fields pick up the prompt automatically on next start).

## 12. Acceptance Criteria

1. After upgrading, an unchanged `claude-bot.yaml` causes the bot to
   correctly answer "请列出群里所有机器人" with a real lark-cli-based
   member lookup.
2. An LLM-emitted callback card with `__claude_cb: true` triggers a follow-up
   LLM turn when the user clicks it. The same card without the marker stays
   inert.
3. Setting `backend.injectSkillPrompt: false` in a bot YAML reverts that bot
   to pre-v0.7.0 behaviour (no skill knowledge, no callback re-entry).
4. All 111 existing tests still pass, plus the new tests in §9.

---

## Source-of-Truth References

- Open-source prompt original: `feishu-claude-code-bridge/src/agent/claude/adapter.ts` lines 15–152
- Our adapter contract: `src/adapters/types.ts`, `src/adapters/claude.ts:81-87`
- bridge_context format: `src/worker/bridge-context.ts`
- Current card-action wiring: `src/worker/index.ts:141-158`, `src/lark/card-action.ts`

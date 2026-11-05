# Conclusion Mode (+ Codex item events) — Design Spec

**Date**: 2026-11-05
**Author**: Lei (with Claude as co-author)
**Status**: Draft — pending user review

---

## 1. Background & Motivation

Every run today streams into one Lark card: reasoning, each tool call, and
all intermediate text, rendered live (`src/lark/card-builder.ts`). That is
right for coding work, where the user watches the process.

But the user also sends **errand tasks** — "在 jira 上建一个 story 卡",
send a message, look something up. For those they fire the message and go do
something else. They want none of the process (tools, skills, intermediate
text); they want one conclusion, e.g. "卡片 WIZLYNN-123 已创建：<标题> <链接>",
and they want their phone to buzz when it lands.

The user does **not** mix errands and watched coding work in the same chat,
so the mode is a per-chat setting, not per-message.

### Why not "take the last text segment"

Claude's own final `result` (and plain `claude -p` output) is only the text
after the last tool call. Measured over 1002 tool-using turns in real
sessions: 6% have an empty last segment, ~9% have substantial text before it
(a conclusion split by a tool call loses its first half). Not reliable.

Both CLIs can instead be **forced to write a dedicated conclusion**:

- Claude: `--json-schema '<schema>'` → the run ends with a `StructuredOutput`
  tool call; the `result` stream line carries `structured_output` (object).
- Codex: `codex exec [resume] --output-schema <file>` → the last
  `agent_message` item's `text` is the JSON string.

Both verified on 2026-11-05 (claude 2.1.283, codex-cli 0.162.1), including
that the **next** turn resumed *without* a schema answers normally in prose
with context intact. Gemini has no equivalent.

### Codex card bug (fixed in the same branch, per the user)

`parseCodexJsonLine` handles only `item.completed` / `agent_message`. All
other items (`command_execution`, etc.) are dropped, so Codex cards never
show tool calls, and consecutive agent messages are glued into one text block
with no separator (`appendText` concatenates while the block is streaming).
The adapter's `finalText` is likewise every message concatenated.

## 2. Goals / Non-goals / Anti-goals

**Goals**
- A per-chat **conclusion mode**, toggled by command, default off.
- In conclusion mode: while running, a minimal status card (one "处理中" line
  + the existing stop button); when done, the conclusion arrives as a **new
  message** (so it triggers a push notification) and the status card is
  recalled. One task leaves exactly one message in the chat.
- Conclusion comes from the CLI's structured output (Claude, Codex); Gemini
  falls back to a prompt instruction.
- Codex streaming cards show tool calls and keep agent messages as separate
  paragraphs, like Claude's.

**Non-goals**
- No per-message override (prefix/flag). Decided by the user.
- No process kept anywhere in the conclusion-mode output — no collapsed
  "过程" panel. If the conclusion is wrong, the user asks the bot in chat
  (the session continues). Decided by the user.
- No change to stream-mode rendering for Claude/Gemini.

**Anti-goals** (would be a failure even if it "works")
- A conclusion-mode run that ends with **no message** (empty / unparsable
  structured output must still produce a visible message).
- Breaking session continuity (`--resume` / `exec resume`) for later turns.
- Leaking the raw JSON (`{"conclusion": …}`) into the chat.

## 3. Design

### 3.1 Storage & command — `/mode`

- New optional field on `ChatSession`: `outputMode?: 'stream' | 'final'`.
  Absent = `stream`. Same semantics as `idleTimeoutMs`: a per (chatId,
  botName) chat preference that **survives `/new` and `/cd`** and is
  preserved across `upsert`. Setter mirrors `setIdleTimeout`.
- New command `/mode` (not admin-only, like `/timeout`):
  - `/mode` → show current mode.
  - `/mode final` → conclusion mode. `/mode stream` → back to default.
  - Anything else → usage line.
  - If no session slot exists yet, upsert one first (as `/cd` does).
- Per-bot slot (my call): in a group with several bots, each bot's mode is set
  separately via that bot. Matches how `/timeout` and `/cd` already work.

### 3.2 Adapter contract

- `RunContext` gains `conclusion?: boolean`.
- `done` event gains `conclusion?: string` — the extracted conclusion text,
  present only when `ctx.conclusion` was set and extraction succeeded.
- Every adapter must still emit all other events as today; the worker
  decides what to render. Update `docs/architecture.md` + `.zh.md`.

Schema (shared constant; same for both CLIs):

```json
{
  "type": "object",
  "properties": {
    "conclusion": {
      "type": "string",
      "description": "<guidance below>"
    }
  },
  "required": ["conclusion"],
  "additionalProperties": false
}
```

Guidance text (Chinese, in `description`): a self-contained conclusion for
the user in 1–5 sentences, Markdown allowed; on success state the key result
(IDs, links, titles); on failure say where it got stuck and what the user
needs to do; don't rely on anything said earlier in the run.

**Claude** (`src/adapters/claude.ts`): when `ctx.conclusion`, add
`--json-schema <JSON string>`. Parse `structured_output.conclusion` from the
`result` line into `done.conclusion`.

**Codex** (`src/adapters/codex.ts`): when `ctx.conclusion`, write the schema
to a file and pass `--output-schema <file>` (on both `exec` and
`exec resume`). File location/lifetime is the builder's call (a fixed file
under the bridge state dir written once is fine). On `done`,
`JSON.parse` the **last** `agent_message` text and take `.conclusion`.

**Gemini** (`src/adapters/gemini.ts`): no schema flag. When `ctx.conclusion`,
append a short instruction to the prompt asking it to end with a
self-contained 1–5 sentence conclusion; `done.conclusion` = the text emitted
**after the last tool call** (my call). Not `finalText` — Gemini's `finalText`
is every text delta joined, which would leak the process. Gemini is the
weakest backend for this mode; accepted.

**Fallback** (all backends): if `done.conclusion` is missing or empty, the
worker uses `done.finalText`; if that's empty too, "已完成，但没有返回结论".
Never print raw schema JSON — if Codex's last message fails to parse, use it
as plain text only if it doesn't look like JSON, else use the fallback line.

### 3.3 Codex item events (stream mode fix)

Map codex `--json` items to the existing 7-variant contract:

- `item.started` of a tool-like item (`command_execution`, and whatever
  other tool-like types the recorded fixture shows — e.g. file changes, MCP
  tool calls, web search) → `tool-call` (callId = item id, name = item type
  or a readable label, input = command/args).
- `item.completed` of the same → `tool-result` (ok from exit code / status,
  summary = output excerpt).
- `reasoning` item → `thinking`. The dispatcher has no `thinking` case
  today, so it stays unrendered (my call) — consistent with Claude, and no
  stream-mode change for other backends.
- `agent_message` → `text-delta`, kept as its own paragraph: a following
  message must not glue onto the previous one (e.g. emit a paragraph break
  between consecutive messages, or close the text block).
- Adapter `finalText` = the **last** `agent_message` text, not the
  concatenation.

Exact item type names and fields must come from a **recorded fixture**
(`scripts/record-cli-fixture.sh codex <scenario> "<prompt that runs a
command>"`), not memory. Keep the existing `json-0130.jsonl` test passing.

### 3.4 Worker rendering in conclusion mode

The worker reads the chat's `outputMode` when dispatching and, for `final`:

1. passes `conclusion: true` in `RunContext`;
2. uses a conclusion streamer instead of `CardStreamer` (same interface the
   dispatcher already calls — `start / onTextDelta / onToolCall /
   onToolResult / onError / onDone / onInterrupted`):
   - `start`: send a minimal status card — "处理中…" + the existing stop
     button — as a reply to the user's message (same anchoring as today).
     Ignore text/tool events (no patches).
   - `onDone`: send the conclusion as a **new** message (reply to the user's
     message), then recall the status card. In a **group**, `@` the sender
     in the conclusion so they get a push even if the group is muted
     (my call). Card `summary` = the conclusion's first line, so the push
     preview shows it.
   - `onError` / idle timeout: same as done but the message is
     "⚠️ 没办成：<error>" (the user isn't watching, so it needs a push).
   - **Exactly one terminal outcome per run** (my call): a run can yield both
     `done` and `error` (e.g. Claude's `is_error` result line becomes a
     `done`, then the non-zero exit becomes an `error`). The conclusion
     streamer settles on the first terminal event and ignores the rest. A
     `done` from an errored result counts as a failure: the Claude adapter
     carries `is_error` through (e.g. emit `error` instead of `done` for
     `is_error` results, or a flag on `done`) — builder's call which, but
     test it.
   - `onInterrupted` (user pressed stop): patch the status card to
     "已停止"; no new message (the user is present).
3. `LarkCardSink` gains a way to recall a message (`im.message.delete` on the
   bot's own message). If recall fails, patch the status card to "已完成"
   instead and log — never fail the run over it.

Message format for the conclusion (card vs post) is the builder's call;
it must render Markdown links and support `<at>` in groups.

### 3.5 Docs

- `/help` picks up `/mode` automatically via the router; check it does.
- Change doc + CHANGELOG + architecture (adapter contract, `ChatSession`
  field, worker rendering path) — bilingual, per `CLAUDE.md`.

## 4. Testing

- Claude parser: `result` line with `structured_output` → `done.conclusion`;
  without it → no `conclusion`. Args include `--json-schema` only when
  `ctx.conclusion`.
- Codex: recorded fixture with tool calls → expected `tool-call` /
  `tool-result` / `thinking` / separate `text-delta`s; `finalText` = last
  message; schema-mode fixture (recorded with `--output-schema`) →
  `done.conclusion`; args include `--output-schema` on both exec and resume.
- Gemini: prompt gets the instruction only when `ctx.conclusion`.
- Store: `outputMode` persists, survives `reset`/`setCwd`/`upsert`.
- `/mode` handler: show / set / usage.
- Conclusion streamer: done → new message + recall; empty conclusion →
  fallback text; error → failure message; stop → patch "已停止"; recall
  failure → patch fallback; group → `<at>` sender.
- Manual: in a p2p chat, `/mode final`, ask claude-bot and codex-bot an
  errand; confirm one message, push received, `/mode stream` restores cards.

## 5. Risks

- The model may write a weak conclusion; the user asked to accept that and
  ask follow-ups in chat.
- Codex item schema can change across CLI versions; the fixture pins today's.
- Schema mode adds one tool call / constrained final message per run — small
  extra latency/tokens.

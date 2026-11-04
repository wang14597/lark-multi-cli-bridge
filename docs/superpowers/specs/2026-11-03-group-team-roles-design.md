# Group Team Roles — Design Spec

**Date**: 2026-11-03
**Author**: Lei (with Claude as co-author)
**Status**: Draft — pending user review

---

## 1. Background & Motivation

A typical dev group holds the user plus the three bots (claude-bot, codex-bot,
gemini-bot). Today the user directs each bot separately; the bots are
independent and don't know each other exist. The user wants them to work as a
team: e.g. A develops and `@B` to review; B reviews, then `@A` with findings or
`@C` to start docker and test; C reports back. The user has confirmed that bots
**can `@` each other** in a Lark group.

What's missing is shared context: a bot doesn't know its **role** in this
group or **who else is here and what they do**. The underlying CLIs are
capable of deciding *how* to collaborate once they have that context.

## 2. Goals / Non-goals

**Goals**
- A per-group **team roster** (bot → role), set and changed by a command.
- Every bot sees the roster + its own role in every turn, so adding or
  removing a member takes effect on the next message, with no restart.
- A short collaboration convention in the overlay skill (how to hand off).

**Non-goals (explicitly decided by the user, 2026-11-03)**
- No loop brake / hop limit on bot-to-bot exchanges. *Accepted risk.*
- No tightening of `allowed_users`.
- No constraints on repo/cwd, round counts, or what C may run — the CLIs decide.
- No auto-sync from Lark join/leave events (see §7); membership is maintained
  by command.

## 3. Design

### 3.1 Storage — `TeamStore`

New shared file `state/teams.json`:

```json
{ "<chatId>": { "members": { "claude-bot": { "role": "开发" } } } }
```

Keyed by `chatId`, then by lmcb **bot name**. Three workers write it, so it
follows `WorkspaceStore`: read-through (no cache), each mutation is a
read-modify-write of its own chat key, atomic file write. Same known limit
(cross-process RMW isn't atomic; acceptable for an interactive command).

### 3.2 Command — `/team` (admin only)

| Command | Effect |
|---|---|
| `/team set <bot-name> <role…>` | add the bot, or update its role |
| `/team rm <bot-name>` | remove a member (bot kicked / role dropped) |
| `/team list` | show this group's roster |
| `/team clear` | drop the whole roster for this group |

Because storage is shared, running the command once (via whichever bot
receives it) updates all three. `adminOnly` because it changes every bot's
behaviour in the group (same stance as `/access`). Registered next to the other
handlers in `src/worker/index.ts`; listed in `/help`.

### 3.3 Prompt injection

`prefixPrompt` (called per run by the dispatcher) appends a block after
`<bridge_context>` when the chat has a roster:

```
<team_roster>
you: claude-bot — 开发
members:
- codex-bot — review
- gemini-bot — docker 启动 / 测试 / 日志排查
</team_roster>
```

If this bot isn't in the roster it still sees the members, with `you: (no role
assigned)`. No roster → no block (behaviour unchanged for every existing chat).
`prefixPrompt` becomes async-capable (`string | Promise<string>`); the
dispatcher already runs inside an async function, so it just `await`s it.

### 3.4 Collaboration convention (overlay + one prompt clause)

`lark-bridge-overlay` gets a "Working as a team" section, used when a
`<team_roster>` block is present:

- Act within your role; defer other work to the teammate whose role fits.
- **Hand off with a separate message containing a real `@`** (via `lark-cli`),
  not just text inside your streaming card. Say: what was done, where (path /
  branch / files), the requirement, what you expect back, and the two possible
  next steps if applicable (e.g. reviewer: problems → `@dev`; clean → `@ops`).
- The last bot in a chain ends with `@<user>`: conclusion + key evidence. That
  is how the user knows the chain finished.

`BOT_SKILL_PROMPT` gets one clause pointing at it (ceiling: < 900 chars;
snapshot hash updated). `<team_roster>` is added to the list of injected,
don't-echo blocks.

## 4. Open technical risk — gate before implementation

Two platform behaviours are **unverified** and must be checked with a 15-minute
spike before writing code, because they decide how §3.4 hands off:

1. **Cross-app `open_id` of a bot.** Lark `open_id` is app-scoped. A's view of
   B's `open_id` may differ from B's own. Spike: from claude-bot, list the
   group's members with `lark-im` and see whether bots appear and whether an
   `@` built from that id actually reaches codex-bot.
2. **`@` inside a card.** Bot replies are streamed as interactive cards; it is
   unknown whether an `@` in card markdown triggers a message event for the
   other bot. §3.4 assumes a separate plain message; the spike confirms it works.

**Result (2026-11-04):** (1) works — each app's `members/list?member_types=bot`
returns bots with `ou_` ids and display names, and `@` between bots works live;
ids stay app-scoped, so each worker resolves them itself and the roster carries
a per-viewer `mention:` tag (needs `im:chat.members:read` on the app). (2) is
still unverified; handoffs stay plain messages.

If (1) fails, fallback: `/team set` also records the `open_id` as seen by the
worker that received the command from an `@` mention, stored per-bot. That
would be a spec revision, not a silent change.

## 5. Testing

- `TeamStore` unit tests: per-chat isolation, set/update/rm/clear, read-through
  sees another instance's write, missing/corrupt file → empty.
- `/team` handler tests: usage errors, each subcommand, non-admin rejected.
- Prompt assembly test: block present with roster (own role, others), absent
  without; async `prefixPrompt` awaited.
- `lark-bot-skill` snapshot hash and length guard.

## 6. Docs obligations (at implementation time)

Change doc `.md` + `.zh.md`, INDEX rows, CHANGELOG `[Unreleased]`, and
`architecture.md` + `.zh.md` (new on-disk file `state/teams.json`, new
`/team` command, new injected `<team_roster>` block, `prefixPrompt` becoming
async), including the version marker.

## 7. Deferred

- Auto-maintaining the roster from `im.chat.member.bot.added_v1` /
  `im.chat.member.bot.deleted_v1`. Needs those events subscribed in each Lark
  app's console, so it's a per-app platform change; `/team` covers it for now.
- Loop brake and hop counter (user declined; revisit if bots start ping-ponging).
- Per-role tool/permission limits.

---
date: 2026-11-03
type: feat
slug: group-team-roles
---

# Per-group team roster so bots know their role and each other

**Type:** feat

## Motivation

In a dev group the user plus claude-bot / codex-bot / gemini-bot work as
independent bots the user directs one by one. The user wants them to work as a
team (A develops and `@B` to review; B reports back to A or `@C` to run docker
and test; C reports to the user). Bots can already `@` each other in Lark; what
was missing was shared context — a bot didn't know its role in the group or who
else was there.

## What changed

- **`TeamStore`** (`src/session/team.ts`, file `state/teams.json`): per-group
  roster, `chatId → bot name → role`. Shared by all workers, so it copies
  `WorkspaceStore`'s read-through design (no cache; each mutation is a
  read-modify-write of one chat key; atomic write).
- **`/team`** (admin only): `set <bot> <role…>`, `rm <bot>`, `list`, `clear`.
  One run in the group updates every bot because storage is shared. Membership
  is maintained by command; it is not synced from Lark join/leave events.
- **`<team_roster>` block**: `prefixPrompt` appends it after `<bridge_context>`
  on every run (`you: <bot> — <role>` plus the other members). No roster → no
  block, so chats that never ran `/team` are unchanged. `prefixPrompt` is now
  `string | Promise<string>` and the dispatcher awaits it (the roster is read
  from disk).
- **Collaboration convention**: new "Working as a team" section in
  `lark-bridge-overlay` (stay in role; hand off with a separate message holding
  a real `@`; last bot in a chain `@`s the user), `<team_roster>` added to
  `BOT_SKILL_PROMPT`'s block list and trigger clause (still < 900 chars).
- `CommandCtx` / `DispatchCommandDeps` gain `teams`.
- **Mention tags in the roster (follow-up, same branch)**: live testing showed a
  bot spent ~4 tool calls looking up teammates' ids before every handoff. Lark
  `open_id`s are app-scoped, so they can't be stored once at `/team set` time
  (only the `@`-ed bot's worker receives the command, and it only knows its own
  view). Instead each worker calls `GET /im/v1/chats/{id}/members/list`
  (`member_types=bot`) with its own app (`fetchChatBots`, cached per chat by
  `makeChatBotsLookup`: 10 min on success, 1 min on failure), matches Lark
  display names (`wl-codex-bot`) to lmcb names (`codex-bot`) by substring, and
  adds `mention: <at user_id="ou_…">name</at>` to each teammate line. No match /
  API failure → line without the tag (bot falls back to `lark-im`). Needs the
  `im:chat.members:read` (or `im:chat:readonly`) scope on each bot app — probe
  found codex-bot's app lacks it.
- **Silent handoffs (follow-up)**: overlay now says send handoffs with no
  preamble and no recap of text / message id; final reply ≤ one line. The
  "Report after sending" rule of "Acting for the user" explicitly excludes team
  handoffs (it was the source of the narration). The streamed card still shows
  the final text and tool calls, so it can't be fully silent.

Deliberately **not** done (user decision, 2026-11-03): loop brake / hop limit,
`allowed_users` tightening, any cwd / round / permission limits on the bots.
Without a brake, two bots can keep replying to each other until the user stops
them (`/stop` is per bot).

## Files touched

- `src/session/team.ts`, `src/worker/team-roster.ts`, `src/commands/handlers/team.ts` — new.
- `src/config/paths.ts` — `teamsJson`.
- `src/commands/types.ts`, `src/worker/dispatch-command.ts` — `teams` in ctx / deps.
- `src/worker/index.ts` — build `TeamStore`, register `/team`, async roster-aware `prefixPrompt`.
- `src/worker/dispatcher.ts` — await `prefixPrompt`.
- `src/prompts/lark-bot-skill.ts`, `skills/lark-bridge-overlay/SKILL.md` — team convention.
- Tests: `tests/session/team.test.ts`, `tests/worker/team-roster.test.ts`,
  `tests/commands/team.test.ts`, `tests/worker/dispatcher-prefix.test.ts`; `teams`
  added to existing ctx fixtures; prompt snapshot hash updated.

## Verification

`pnpm typecheck`, `pnpm lint`, `pnpm test` (50 files, 333 tests) pass. **Not yet
verified live** (spec §4 gate): whether a bot's view of another bot's `open_id`
is usable for an `@` across apps, and whether an `@` inside a streamed card
reaches the other bot. The overlay therefore tells bots to hand off with a
separate plain message.

## Architecture impact

Updated `docs/architecture.md` / `.zh.md`: module map (`worker/` prefix block,
`commands/` count 11 → 12, `session/` adds `TeamStore`) and State on disk
(`state/teams.json`).

## Links

- Spec: `docs/superpowers/specs/2026-11-03-group-team-roles-design.md`
- Plan: `docs/superpowers/plans/2026-11-03-group-team-roles.md`
- Commits: see branch `feat/group-team-roles`
- CHANGELOG: `[Unreleased]` → Added

# Group Team Roles — Implementation Plan

Spec: `docs/superpowers/specs/2026-11-03-group-team-roles-design.md`

Ordered so each step is testable on its own. TDD: test first within each step.

1. **`TeamStore`** (`src/session/team.ts`, `paths.teamsJson`) — read-through, modeled on
   `WorkspaceStore`. API: `get(chatId)`, `set(chatId, bot, role)`, `remove(chatId, bot)`,
   `clear(chatId)`. Test: `tests/session/team.test.ts`.
2. **Roster block** (`src/worker/team-roster.ts`) — pure `buildTeamRoster(botName, members)`
   → `<team_roster>…</team_roster>` or `''`. Test: `tests/worker/team-roster.test.ts`.
3. **`/team` command** (`src/commands/handlers/team.ts`, `adminOnly`) — `set|rm|list|clear`.
   Add `teams: TeamStore` to `CommandCtx`; update `makeDispatchCommand` and the existing
   test ctx literals. Test: `tests/commands/team.test.ts`.
4. **Wire the worker** (`src/worker/index.ts`) — construct `TeamStore`, register handler,
   pass `teams` to ctx, `prefixPrompt` returns `string | Promise<string>` and appends the
   roster; `Dispatcher` awaits it.
5. **Overlay + prompt** — "Working as a team" section in `lark-bridge-overlay`; one clause in
   `BOT_SKILL_PROMPT` (< 900 chars); update snapshot hash; refresh the installed overlay copy.
6. **Docs** — change doc (`.md` + `.zh.md`), both INDEX files, CHANGELOG (both), and
   `architecture.md` + `.zh.md` (new state file, command, injected block, async `prefixPrompt`).
7. **Checks** — `pnpm typecheck && pnpm test && pnpm lint`.

Gate carried from the spec (§4): the cross-app `open_id` / card-`@` behaviour is verified by
the user with the live bots; the overlay hands off with a separate plain message until then.

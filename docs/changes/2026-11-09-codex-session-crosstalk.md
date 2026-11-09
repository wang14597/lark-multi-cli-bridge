---
date: 2026-11-09
type: fix
slug: codex-session-crosstalk
---

# Codex chats no longer resume each other's session

**Type:** fix

## Motivation

With nine work groups running codex-bot at once, the groups' conversations
bled into each other. `state/sessions/codex-bot.json` showed 8 chats all
pointing at the same codex thread `01a1be65-…`. Its rollout file holds
messages from 6 different groups.

## What changed

`parseCodexJsonLine` kept the most recent `thread.started` id in a
module-level `lastThreadId` and stamped it onto `turn.completed`'s `done`
event, because codex's `turn.completed` doesn't echo the thread id. Every chat
in the codex-bot worker shares that variable. When runs overlapped, chat A's
`done` carried chat B's thread id. `run()` preferred it (`ev.sessionId ||
sessionId`), so `onSessionUpdate` saved B's thread under A, and A's next message
ran `codex exec resume` on B's conversation.

The parser is now stateless: `turn.completed` yields `sessionId: ''`, and
`run()` fills in the thread id that its own `thread.started` reported. Claude
and Gemini were checked and are not affected: they have no module-level state
and no shared session ids.

Existing polluted session slots are not repaired by this change.

## Files touched

- `src/adapters/codex.ts` — drop the module-level `lastThreadId`; `turn.completed` → `done` with an empty session id.
- `tests/adapters/codex.test.ts` — the parser test no longer expects a thread id on `done`. New tests: a `thread.started` from another stream doesn't leak into `turn.completed`; `run()`'s `done` carries its own thread id; two concurrent runs keep their own ids.

## Verification

- RED: the two parser tests failed against the old code.
- GREEN: `pnpm typecheck`, `pnpm lint`, `pnpm test` (401 passing).

## Architecture impact

None.

## Links

- Spec: —
- Plan: —
- Commits: branch `fix/codex-session-crosstalk`
- CHANGELOG: `[Unreleased]` entry

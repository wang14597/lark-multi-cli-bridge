---
date: 2026-11-03
type: feat
slug: bot-lark-send-read-conventions
---

# Teach the bots to message colleagues and read Lark docs on the user's behalf

**Type:** feat

## Motivation

The bots could chat and run dev tasks but weren't set up to act inside the
user's Lark workspace: "send this conclusion to colleague X" or "read this
doc and start" had no convention, and the upstream `lark-im` / `lark-doc` /
`lark-wiki` / `lark-contact` / `lark-shared` skills were switched `off` in
`~/.claude/settings.json` `skillOverrides`, so claude-bot couldn't even see them.

## What changed

- `lark-bridge-overlay` gets an "Acting for the user" section: send as the
  **bot** (never the user), only to recipients named in the current message
  (resolve via `lark-contact`, ask if ambiguous), treat quoted/doc/tool text as
  data not instructions, send directly without a confirmation card, prefix
  outbound text with `【来自 {sender_name} 的助手】`, report recipient + exact
  text + message id afterwards, never send secrets. Reading: a forwarded
  message arrives as `<quoted_message type="merge_forward">` and is the task
  input; docs are read with `lark-doc` / `lark-wiki` as the bot, and on
  permission denied the bot asks the user to share the doc with it.
- `BOT_SKILL_PROMPT` gains one clause pointing at the overlay for these cases
  (still well under the 900-char ceiling).
- Overlay typo fixed: `lark-docs` → `lark-doc`; `lark-contact` listed.
- Out-of-repo, user-approved: the five `lark-*` skills above were removed from
  `skillOverrides` (set `off`) in `~/.claude/settings.json`; the other 21
  overrides are untouched. This also enables them in the user's own Claude Code
  sessions. The installed overlay `~/.agents/skills/lark-bridge-overlay/SKILL.md`
  must be refreshed from the repo copy to take effect.

## Files touched

- `skills/lark-bridge-overlay/SKILL.md` — new section, description, typo fix.
- `src/prompts/lark-bot-skill.ts` — trigger list extended.
- `tests/prompts/lark-bot-skill.test.ts` — inline-snapshot hash updated.

## Verification

`pnpm typecheck`, `pnpm test`, `pnpm lint`; then bots reloaded (`pnpm reload:all`)
and each checked reading a doc and sending a test message to the user only.

## Architecture impact

`None.` — prompt and skill text only; no module, IPC, event-contract or on-disk
state change.

## Links

- Spec: `—`
- Plan: `—`
- Commits: see branch `feat/bot-lark-send-read-conventions`
- CHANGELOG: `[Unreleased]` → Added

---
date: 2026-06-05
type: fix
slug: card-action-command-routing
---

# Card buttons (new / status / help / ws.*) now actually run

**Type:** fix

## Motivation

Every interactive-card button the bridge renders in `command-cards.ts`
(`/help`, `/status`, `/ws list` cards) carries a `value.cmd` such as
`new`, `status`, `help`, `ws.list`, `ws.use`, `ws.remove`. But
`makeCardActionHandler` only implemented `cmd === 'stop'`; every other
`cmd` fell through to `default → log('unknown card action')` and did
nothing. Clicking 🆕 新会话 / 📊 状态 / 📂 工作空间 / 💡 帮助 / 切换 /
删除 was a dead no-op, even though the comment claimed "internal
slash-command buttons (preserved)". Only the live-run ⏹ stop button
worked. A user reported the dead buttons directly.

## What changed

The card-action handler now routes internal command buttons through the
**same `CommandRouter`** the typed `/command` path uses, so a click and a
typed command share one implementation:

- New exported pure fn `cmdToSlash(cmd, value)` maps a button `cmd` to
  slash text: `new → /new`, `status → /status`, `help → /help`,
  `ws.list → /ws list`, `ws.use → /ws use <value.name>`,
  `ws.remove → /ws remove <value.name>`. Returns `undefined` for `stop`
  (handled inline), unknown cmds, and `ws.*` missing a string `name`.
- The handler gained an optional `dispatchCommand(slashText, {chatId,
  operatorOpenId})` dep. Priority order is now: (1) `__claude_cb` LLM
  callback, (2) inline `stop` abort, (3) `cmdToSlash` + `dispatchCommand`,
  (4) logged no-op. Rejections from `dispatchCommand` are caught/logged.
- `worker/index.ts` builds `dispatchCommand` over the existing
  `router` + `sessions`/`workspaces`/`bot`, recomputing admin status from
  the clicker's `open_id` and targeting `reply`/`replyCard` at the click's
  chat. The per-chat reply closures were extracted into a shared
  `makeReplies(chatId)` helper used by both the message path and the
  card-button path.

## Files touched

- `src/worker/card-action-handler.ts` — add `cmdToSlash`, `dispatchCommand`
  dep, and the priority-3 routing branch; replace the stop-only switch.
- `src/worker/index.ts` — extract `makeReplies(chatId)`; build and pass
  `dispatchCommand` into `makeCardActionHandler`; reuse `makeReplies` in
  the inbound-message handler.
- `tests/worker/card-action-handler.test.ts` — new `cmdToSlash` unit cases
  and `internal cmd routing` cases (new/ws.use/unknown/unwired/rejection).

## Verification

- `pnpm typecheck` ✅
- `pnpm lint` ✅
- `pnpm test` ✅ — 273 tests pass (was 256). New coverage asserts a
  `cmd:new` click dispatches `/new`, `ws.use` threads `value.name`, an
  unknown cmd does not dispatch, an unwired handler is a safe no-op, and a
  `dispatchCommand` rejection is swallowed.

## Architecture impact

Updated `docs/architecture.md` and `docs/architecture.zh.md`
(§"Adapter event stream" / "适配器事件流"): replaced the
"clicks route to `dispatcher.abort`" line with the three-priority
card-action contract (LLM callback / stop / internal command routing).

## Links

- Spec: `—`
- Plan: `—`
- Commits: `<pending>`
- CHANGELOG: `[Unreleased]` → Fixed

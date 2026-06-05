---
date: 2026-06-05
type: fix
slug: card-action-routing-hardening
---

# Card command routing: structured args + visible failures

**Type:** fix

## Motivation

Two follow-up defects in the just-landed card-action command routing
([card-action-command-routing](2026-06-05-card-action-command-routing.md)),
surfaced by code review:

1. **Lossy round-trip on workspace names.** `cmdToSlash` re-serialized a
   structured button payload (`value.name`) back into a slash string
   (`/ws use ${name}`). The router then re-split it on `\s+` and
   `wsHandler` read only the second token, so a workspace name containing
   whitespace/newlines (e.g. `foo bar`) clicked from a `/ws list` card
   resolved to a truncated prefix (`foo`) — the wrong target if both
   `foo` and `foo bar` exist. The card displays the full name (escaped),
   so what you see ≠ what you click.
2. **Silent click failures.** The card path caught every `dispatchCommand`
   rejection and only logged it; in a group chat nobody sees the worker
   log, so any router-handler or Lark-SDK reply error degraded right back
   to the "dead button" symptom the original PR set out to fix.

## What changed

- **Structured routing, no string round-trip.** `CommandRouter` gained
  `dispatchParsed({name, args}, ctx)`; `dispatch(text, ctx)` now parses
  then delegates to it. `card-action-handler.ts`'s `cmdToSlash` is replaced
  by `cmdToCommand`, which returns a structured `ParsedCommand`
  (`ws.use` + `value.name` → `{ name: 'ws', args: ['use', <name>] }`).
  The free-form name travels as one discrete arg and is never re-split, so
  a whitespace-bearing name routes to the exact workspace the card showed.
- **Visible failures.** The inline `dispatchCommand` closure in
  `worker/index.ts` is extracted into `makeDispatchCommand`
  (`src/worker/dispatch-command.ts`). On any throw from `dispatchParsed`
  it sends a best-effort `⚠️ command failed: /<cmd>` fallback reply
  instead of swallowing; only if that fallback reply also throws does it
  fall back to logging. The card-action handler keeps a last-resort catch
  so a rejection can still never escape into the WS event loop.

The `dispatchCommand` dependency contract changed from
`(slashText: string, meta)` to `(cmd: ParsedCommand, meta)`.

**Review-driven quality refinements** (a second code-review pass on this same
change):

- The callback contract and the reply-closure shape are now **single exported
  types** in `dispatch-command.ts` — `DispatchCommand`, `CardClickMeta`, and
  `ChatReplies` — imported by the producer (`makeDispatchCommand`), the consumer
  (`card-action-handler.ts` dep), and the wiring (`worker/index.ts` `makeReplies`
  return). Previously each was hand-declared in two places; structural typing
  would not have flagged a drift at the wiring site.
- `makeDispatchCommand`'s docstring no longer overclaims. The fallback reply
  realistically rescues a handler that throws **before** producing its reply
  (a store write that fails, an exception building the card); it does **not**
  promise to cover a hard transport outage (the fallback send to the same chat
  would fail too), and it fires after any successful state change, so it means
  "did not complete cleanly", not "nothing happened".

The two open questions the review raised are **by design, not fixed**:
admin-only commands (`/access`, `/sessions`, `/reconnect`) have no card
buttons, so `cmdToCommand` deliberately doesn't map them; and the
`/timeout` end-to-end wiring is already covered by the store + handler
unit tests.

## Files touched

- `src/commands/router.ts` — add `dispatchParsed`; `dispatch` delegates to it.
- `src/worker/card-action-handler.ts` — `cmdToSlash` → `cmdToCommand`
  (returns `ParsedCommand`); `dispatchCommand` dep now takes a
  `ParsedCommand`; priority-3 branch updated.
- `src/worker/dispatch-command.ts` — **new.** `makeDispatchCommand` factory
  with admin recompute + best-effort fallback reply; exports the shared
  `DispatchCommand` / `CardClickMeta` / `ChatReplies` types.
- `src/worker/index.ts` — replace the inline `dispatchCommand` closure with
  `makeDispatchCommand({...})`; annotate `makeReplies` with `ChatReplies`.
- `tests/commands/router.test.ts` — `dispatchParsed` keeps a whitespace arg whole.
- `tests/worker/card-action-handler.test.ts` — `cmdToCommand` cases incl.
  whitespace/newline regression; routing asserts structured payloads.
- `tests/worker/dispatch-command.test.ts` — **new.** structured pass-through,
  admin recompute, **no fallback on success**, fallback reply on router throw,
  no-throw when the fallback reply itself throws. Mocks are typed (no `as never`).
- `tests/worker/card-command-e2e.test.ts` — **new.** End-to-end regression:
  `cmdToCommand → makeDispatchCommand → real CommandRouter → real wsHandler →
  real WorkspaceStore/SessionStore`. A `foo bar` workspace plus a `foo` decoy
  proves a whitespace name lands on the exact target through the real handler,
  closing the seam-by-seam gap (a future wsHandler re-truncation would fail here).

## Verification

- `pnpm typecheck` ✅
- `pnpm lint` ✅
- `pnpm test` ✅ — 282 tests pass (was 273; +9). New coverage:
  `cmdToCommand` keeps `foo bar` / `a\nb` as one arg; `dispatchParsed`
  doesn't re-split; `makeDispatchCommand` sends `⚠️ command failed: …` on
  a router throw, stays silent on success, and never re-throws; and an
  end-to-end test routes a whitespace name to the exact workspace through the
  real router + wsHandler (with a decoy prefix that the old bug would have hit).

## Architecture impact

Updated `docs/architecture.md` and `docs/architecture.zh.md`
(§"Adapter event stream" / "适配器事件流"): priority-3 now describes
structured `cmdToCommand` + `router.dispatchParsed` via
`makeDispatchCommand`, the whitespace-fidelity guarantee, and the
best-effort fallback reply.

## Links

- Spec: `—`
- Plan: `—`
- Commits: `<pending>`
- CHANGELOG: `[Unreleased]` → Fixed

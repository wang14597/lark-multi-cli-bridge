---
date: 2026-06-03
type: fix
slug: bot-self-open-id-resolution
---

# Fix bot self open_id / app owner resolution failing on every worker startup

**Type:** fix

## Motivation

Every worker start logged two silent failures:

1. `bot self open_id NOT resolved; group @-mention will not strip prefix` —
   `fetchBotSelfOpenId` called `GET /open-apis/bot/v3/info` through the SDK's
   **raw `httpInstance`**, which has no auth interceptor and no domain
   baseURL. A relative-URL request through it always throws; the helper
   swallowed the error and returned `undefined`. Group @-mention prefixes
   were therefore never stripped from inbound text.
2. A logged 400 from `GET /application/v6/applications/<app_id>` —
   `fetchAppOwnerOpenId` omitted the **mandatory `lang` query param**
   (`field_violations: [{field: "lang", description: "lang is required"}]`),
   so the app-owner fallback in access control silently never resolved
   either.

Both verified against the live API with real bot credentials: `bot/v3/info`
returns the open_id fine when authenticated, and the application API
succeeds once `lang` is supplied (owner id arrives as `owner.owner_id`,
with `creator_id` as an always-populated fallback).

## What changed

- `fetchBotSelfOpenId` now goes through `client.request({method, url})` —
  the SDK's authenticated path that injects the tenant token and prefixes
  the domain. Response parsing (unwrapped `bot` / wrapped `data.bot`)
  unchanged.
- `fetchAppOwnerOpenId` now passes `params: { lang: 'zh_cn' }` and falls
  back `owner.open_id → owner.owner_id → app.creator_id` (empty strings
  skipped), matching the real payload shape.

## Files touched

- `src/lark/client.ts` — both helpers rewritten as above, with comments
  explaining why the raw `httpInstance` could never work and why `lang` is
  required.
- `tests/lark/client.test.ts` — new test file (TDD, red first): asserts the
  authenticated `client.request` is used with the right method/url, the
  wrapped shape parses, the `lang` param is always sent, `creator_id`
  fallback works, and both helpers return `undefined` on API errors.

## Verification

- New tests observed failing (4 red) against the old implementation, green
  after the fix.
- `pnpm typecheck` — pass. `pnpm test` — 39 files / 239 tests pass.
- Live reproduction before the fix: raw HTTP call with the bot's tenant
  token returns `open_id` from `bot/v3/info`; the application API 400s
  without `lang` and succeeds with it (worker log 2026-06-03 shows the 400
  on every startup).

## Architecture impact

None.

## Links

- Spec: `—`
- Plan: `—`
- Commits: see branch `worktree-fix-ws-ping-timeout`
- CHANGELOG: `[Unreleased]` → Fixed

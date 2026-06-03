---
date: 2026-06-03
type: fix
slug: profile-provision-verify
---

# Verify lark-cli profile add actually landed (guard against lost writes)

**Type:** fix

## Motivation

`ensureLarkProfile` trusted `profile add`'s exit code 0 and logged
"provisioned". But `profile add` is a read-modify-write on a shared config
file (`~/.lark-cli/config.json`), so the success report can lie:

- All workers provision concurrently at startup; concurrent adds can clobber
  each other (lost update — last writer wins).
- Env markers can silently point the CLI at a **different config home**:
  `LARK_CHANNEL=1` (set by the predecessor bridge for its LLM children)
  makes lark-cli use `~/.lark-cli/lark-channel/` instead. A profile added
  there is invisible to processes without the marker, and vice versa.

Either way the worker boots "successfully" while its bot's lark-cli profile
is missing — every later lark-cli call from the LLM fails with
"profile not found", far from the root cause.

(Investigation note: an apparent "codex/gemini profiles missing" symptom on
2026-06-03 turned out to be exactly the config-home divergence — observed
from a shell carrying `LARK_CHANNEL=1`. The worker-side config was intact.
The guard makes any real future loss loud at startup.)

## What changed

After a successful `profile add`, `ensureLarkProfile` re-runs
`profile list` and throws if the bot's `app_id` still isn't present. The
error message names both suspected causes (concurrent config write /
diverging config home via `LARK_CHANNEL` / `LARK_CLI_HOME`). The list
parsing is extracted into a `listProfiles` helper used by both calls.

## Files touched

- `src/lark/lark-cli-provision.ts` — extract `listProfiles`; verify-after-add
  with a descriptive error.
- `tests/lark/lark-cli-provision.test.ts` — the happy-path add test now uses
  a stateful mock (profile appears in `list` only after `add`) and asserts
  the verification re-list; new test for the lost-write case
  (`add` exits 0 but the profile never lands → throws `missing after add`).

## Verification

- New/updated tests observed failing against the old implementation
  (no re-list, no throw), green after the change.
- `pnpm typecheck` — pass. `pnpm test` — 39 files / 239 tests pass.
- Manual sanity: sequential `profile add` against the real CLI persists and
  is visible to the same config home.

## Architecture impact

None (provisioning flow unchanged; it only gained a postcondition check).

## Links

- Spec: `—`
- Plan: `—`
- Commits: see branch `worktree-fix-ws-ping-timeout`
- CHANGELOG: `[Unreleased]` → Fixed

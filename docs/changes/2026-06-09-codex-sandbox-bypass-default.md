---
date: 2026-06-09
type: feat
slug: codex-sandbox-bypass-default
---

# Codex bots bypass the OS sandbox by default (parity with claude)

**Type:** feat

## Motivation

A user noticed their codex bot could not reach the network, `git push`, or
run `lark-cli`, while the claude bot on the same machine could do all of it.
The cause was an asymmetry in adapter defaults, not a missing feature:

- `ClaudeAdapter` spawns with `--permission-mode bypassPermissions` by
  default (`claude.ts`), so the claude subprocess runs with full machine +
  network access.
- `CodexAdapter` spawned `codex exec --json --skip-git-repo-check …` with
  **no** sandbox flag, so codex fell back to its own OS sandbox
  (Apple Seatbelt / Landlock), which by default blocks network egress and
  restricts writes to the workspace. Network-dependent commands
  (`lark-cli`, `git push`) therefore failed inside the codex sandbox.

The bridge's whole model is "a trusted local CLI acting as you," and claude
already ships full access by default. Codex should match so a freshly
`lmcb init`-ed codex bot works out of the box like a claude bot — without
the operator hand-editing `extra_args`.

## What changed

A new `bypass_sandbox` switch for codex, **defaulting ON**, mirroring claude's
`bypassPermissions` default and the existing `skip_git_repo_check` pattern:

- When enabled (the default), `CodexAdapter` passes
  `--dangerously-bypass-approvals-and-sandbox` to `codex exec`, granting the
  same full access claude has.
- **Dedupe guard:** if the bot's `extra_args` already carries a
  sandbox/approval flag (`--dangerously-bypass-approvals-and-sandbox`,
  `--sandbox`/`-s`, `--ask-for-approval`/`-a`, `--full-auto`, `--yolo`), the
  adapter does **not** force the bypass flag on top — the operator's explicit
  choice wins, avoiding conflicts and double flags.
- Set `bypass_sandbox: false` to keep codex's native sandbox (no network,
  workspace-only writes).

The default lives at the **adapter level** (`bypassSandbox ?? true`), so even a
bare `codex: {}` block bypasses — exactly how `skipGitRepoCheck ?? true`
already works. `lmcb bot add` / `lmcb init` also writes `bypass_sandbox: true`
explicitly into the generated codex yaml for transparency, the same way it
writes `permission_mode: bypassPermissions` for claude.

## Files touched

- `src/config/schema.ts` — added `bypass_sandbox: z.boolean().optional()` to
  the codex sub-block.
- `src/adapters/codex.ts` — added `bypassSandbox?: boolean` opt (default on);
  injects `--dangerously-bypass-approvals-and-sandbox` unless `extra_args`
  already carries a sandbox/approval flag (`CODEX_SANDBOX_FLAGS` guard).
- `src/adapters/registry.ts` — passes `cfg.bypass_sandbox` through to the
  adapter opts (conditional, like `skip_git_repo_check`).
- `src/cli/commands/bot.ts` — `botAdd` writes `{ bypass_sandbox: true }` into
  the codex backend block of newly created bots.
- `tests/adapters/codex.test.ts` — new `sandbox bypass` describe: default
  injects the flag, `true` injects, `false` omits, no double-add, defers to a
  user `--sandbox` flag.
- `tests/config/schema.test.ts` — codex accepts `bypass_sandbox`; undefined
  when omitted.
- `tests/adapters/registry.test.ts` — passthrough + undefined-when-omitted.
- `docs/configuration.md` / `.zh.md` — documented the new field.
- `docs/architecture.md` / `.zh.md` — noted the per-backend default security
  posture in the adapter section.

## Verification

- `pnpm typecheck` — passes.
- `pnpm test` — all 308 tests pass, including 9 new ones (5 adapter sandbox
  cases + 2 schema + 2 registry).
- `pnpm lint` — clean.
- Red-first: confirmed the new tests fail before the implementation, then pass
  after.

## Architecture impact

Updated `docs/architecture.md` / `.zh.md` (§Module map / adapters): added a
one-line note that adapter defaults grant full access per backend
(claude `bypassPermissions`, codex `bypass_sandbox`), which is what lets the
LLM subprocess call `lark-cli`. No process-topology / IPC / event-contract
change.

## Links

- Spec: `—`
- Plan: `—`
- Commits: `<pending>`
- CHANGELOG: `[Unreleased]` entry

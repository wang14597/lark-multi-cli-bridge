---
date: 2026-11-04
type: fix
slug: codex-lark-cli-profile-pin
---

# Keep the per-bot lark-cli shim first on codex's PATH

**Type:** fix

## Motivation

codex-bot reported `keychain Get failed: cipher: message authentication failed`
from `lark-cli`. Cause: codex runs shell commands through a login shell
(`zsh -lc`); macOS login-shell `PATH` reordering put the per-bot shim dir behind
nvm / homebrew, so `command -v lark-cli` resolved to the real binary and codex
used the default lark profile — wrong identity, and on this machine its stored
credential couldn't be decrypted. Reproduced with `codex exec` under the shim
`PATH`; also visible in an earlier codex session log. Claude and gemini were
unaffected.

## What changed

`CodexAdapter` adds `-c allow_login_shell=false` (skipped if `extraArgs` already
sets `allow_login_shell=`), so codex uses a non-login shell and keeps the
inherited `PATH` (shim first).

## Files touched

- `src/adapters/codex.ts` — add the `-c` flag.
- `tests/adapters/codex.test.ts` — assert the flag.
- Docs: this change doc (+ `.zh.md`), INDEX, CHANGELOG, `architecture` (shim section).

## Verification

`codex exec` under the codex-bot shim `PATH`: without the flag
`command -v lark-cli` → real nvm binary; with `-c allow_login_shell=false` → the
shim. `pnpm typecheck` / `lint` / `test` pass.

## Architecture impact

Updated `docs/architecture.md` / `.zh.md` (identity shim section).

## Links

- Spec: —
- Plan: —
- Commits: see branch `fix/codex-lark-cli-profile-pin`
- CHANGELOG: `[Unreleased]` → Fixed

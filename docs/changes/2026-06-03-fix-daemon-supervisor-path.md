---
date: 2026-06-03
type: fix
slug: fix-daemon-supervisor-path
---

# Fix background `lmcb start`: supervisor entry resolved outside `dist/`

**Type:** fix

## Motivation

`lmcb start` (background mode, the default) spawns the supervisor as a
detached Node child process, computing the entry path relative to the
running module's directory. The path `../../supervisor/index.js` was
written against the **source** layout (`src/cli/commands/start.ts`), but
tsup bundles `src/cli/index.ts` into a flat `dist/cli/index.js` — the
`commands/` level disappears. At runtime `HERE` is `dist/cli/`, so the
old path resolved to `<repo>/supervisor/index.js`, which does not exist.

Worse, the failure was **silent**: the child is spawned with
`detached: true, stdio: 'ignore'`, so it died instantly while the CLI
still printed `supervisor started (background)`. Foreground mode
(`--foreground`) was unaffected because it uses a static `import()` that
tsup resolves at build time.

## What changed

- `resolve(HERE, '../../supervisor/index.js')` →
  `resolve(HERE, '../supervisor/index.js')`, now correctly pointing at
  the sibling `dist/supervisor/index.js` bundle.
- Extracted the resolution into an exported helper
  `resolveSupervisorEntry(fromDir)` (matching the testable-helper
  pattern used by `init.ts`), with a comment explaining the
  built-bundle-relative semantics so nobody "fixes" it back.
- Added a loud guard before the detached spawn: if the resolved entry
  does not exist, print `supervisor entry not found: … (build layout
  changed?)` and exit 1 instead of lying about success. Any future
  build-layout drift now fails visibly.

## Files touched

- `src/cli/commands/start.ts` — path fix, `resolveSupervisorEntry`
  helper, pre-spawn existence guard.
- `tests/cli/start.test.ts` — new; pins the one-level-up resolution and
  verifies it against a simulated `dist/` layout on disk.

## Verification

- Red-green: with the old `../../` path the new tests fail 2/2; with the
  fix they pass 2/2.
- Built-output check: `dist/cli/index.js` contains the corrected
  `resolve(HERE, "../supervisor/index.js")` and the guard string;
  `node -e` confirms the old path does not exist on disk while the new
  one does.
- `pnpm build` ✓ · `pnpm typecheck` ✓ · `pnpm test` 230/230 ✓ ·
  `eslint` clean on both touched files (repo-wide lint has 31
  pre-existing errors, identical on `main` — tracked separately).
- Note: verification initially blocked by pnpm 11's build-script
  approval; fixed in the companion commit adding
  `pnpm-workspace.yaml` `allowBuilds` for esbuild/protobufjs.

## Architecture impact

None. Process topology, module responsibilities, IPC, and on-disk state
are unchanged; this corrects a path constant inside the existing
`lmcb start` flow.

## Links

- Spec: —
- Plan: —
- Commits: see branch `fix/daemon-supervisor-path`
- CHANGELOG: `[Unreleased]` → Fixed

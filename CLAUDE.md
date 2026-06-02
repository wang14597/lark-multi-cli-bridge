# CLAUDE.md

## What this project is

`lark-multi-cli-bridge` (`lmcb`) is a Lark/Feishu chat bridge that routes
inbound messages to **Claude Code / OpenAI Codex / Google Gemini** CLIs —
one bot per backend, many bots under one supervisor. TypeScript, ESM,
Node ≥ 20.

## Read these before you start, in order

1. `CLAUDE.md` (this file) — rules + navigation.
2. `docs/architecture.md` — current full picture: process topology,
   module map, adapter event contract, IPC, on-disk state.
3. `docs/changes/INDEX.md` — chronological history of every change and
   why it was made.

Keep all three current as you work. They are the project's context; do
not let them go stale.

## Prime Directive — every change ships with a change doc

Do not treat a logical change — **a feature, a bug fix, or a refactor** —
as complete until you have recorded it under `docs/changes/`. Never let
code run ahead of the docs.

### For each change

1. Create **both** `docs/changes/YYYY-MM-DD-<slug>.md` **and**
   `docs/changes/YYYY-MM-DD-<slug>.zh.md` by copying
   `docs/changes/TEMPLATE.md` / `TEMPLATE.zh.md`.
2. Fill the template: Motivation / What changed / Files touched /
   Verification / Architecture impact / Links.
3. Prepend a row to `docs/changes/INDEX.md` **and** `INDEX.zh.md`
   (newest first).
4. Add or extend the matching `CHANGELOG.md` `[Unreleased]` entry and
   link it back to the change doc.
5. **Architecture sync rule (mandatory).** If the change touches anything
   `docs/architecture.md` describes — module responsibilities, process
   topology, the adapter event contract, IPC, or on-disk state — update
   `architecture.md` **and** `architecture.zh.md` in the same change,
   including the version marker near the top.

### Skip the change doc only for

- Pure formatting / lint-only edits.
- Typo fixes with no behavior change.
- Dependency version bumps with no behavior change.
- Documentation-only edits (including edits inside `docs/changes/`).

When in doubt, write the doc.

## Branch & PR workflow

Do all feature / bug fix / refactor work on a branch — never commit
directly to `main`. Branch off `main`, develop there, then open a PR or
merge back to `main`. Before merging to `main`, confirm the docs for the
merged work are complete: the change doc (`.md` + `.zh.md`), its
`docs/changes/INDEX` row, the `CHANGELOG.md` `[Unreleased]` entry, and any
`architecture.md` / `architecture.zh.md` updates the change requires.

## Spec/plan flow

- **Large feature:** write a spec (`docs/superpowers/specs/`), then a plan
  (`docs/superpowers/plans/`), implement, then write the change doc
  (`docs/changes/`) and the CHANGELOG entry. Link the change doc back to
  its spec/plan.
- **Small fix / refactor:** skip spec and plan; write only the change doc
  and the CHANGELOG entry.

## Definition of Done

Ship a change only when all of these hold:

- [ ] `pnpm typecheck` passes.
- [ ] `pnpm test` passes (add/adjust tests + fixtures for behavior changes).
- [ ] `pnpm lint` passes.
- [ ] Change doc written (`.md` + `.zh.md`) and INDEX updated — unless skippable.
- [ ] `CHANGELOG.md` `[Unreleased]` updated.
- [ ] `architecture.md` + `.zh.md` updated if you touched architecture.
- [ ] Commit message follows conventional commits
      (`feat:` / `fix:` / `refactor:` / `docs:` / `chore:` …).

## Conventions

- **Stack:** TypeScript, ESM (`"type": "module"`), Node ≥ 20. Build with
  `tsup`, test with `vitest`.
- **Commands:** `pnpm build` · `pnpm test` · `pnpm lint` · `pnpm typecheck`
  · `pnpm format`.
- Start every source file with `// SPDX-License-Identifier: MIT`.
- Keep user-facing docs bilingual: `X.md` + `X.zh.md` (README, CHANGELOG,
  architecture, `docs/*`, `docs/changes/*`).
- **Adapter contract:** every CLI adapter exposes
  `run(ctx): AsyncIterable<AdapterEvent>` over a 7-variant event union
  (`session-start` / `text-delta` / `tool-call` / `tool-result` /
  `thinking` / `error` / `done`). Handle every variant — see
  `src/adapters/types.ts`.
- **Parser changes:** record real CLI output as a fixture under
  `tests/adapters/__fixtures__/` (`scripts/record-cli-fixture.sh`) instead
  of hand-writing JSON.

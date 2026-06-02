---
date: 2026-06-02
type: docs
slug: introduce-change-tracking
---

# Introduce per-change documentation tracking

**Type:** docs

## Motivation

The project had three layers of documentation (`CHANGELOG.md`,
`docs/superpowers/specs|plans/`, `docs/architecture.md`) but no rule tying
*every* change to a durable record. The drift was already visible:
`docs/architecture.md` was marked "updated through v0.4.0" while the
package was at v0.7.1. The goal is that the repository itself is the full
context — any AI agent that clones it can understand the whole project
from the docs alone, without code archaeology.

## What changed

Established a change-tracking convention, documented as rules in a new
root `CLAUDE.md`:

- A new `docs/changes/` ledger. Every logical change (feature / bug fix /
  refactor) gets a bilingual change doc `YYYY-MM-DD-<slug>.{md,zh.md}`
  from a fixed, deliberately short template, plus a row in
  `docs/changes/INDEX.{md,zh.md}`.
- A mandatory **architecture sync rule**: changes touching module
  responsibilities, process topology, the adapter event contract, IPC, or
  on-disk state must update `architecture.{md,zh.md}` (incl. its version
  marker) in the same change.
- An exemption whitelist (formatting, typos, no-op dep bumps, doc-only
  edits) so the ledger stays signal, not noise.
- A Definition-of-Done checklist and the spec/plan ↔ change-doc linkage.

This change dogfoods the convention: it is itself the first ledger entry.

## Files touched

- `CLAUDE.md` — new. The convention and navigation entry point.
- `docs/changes/TEMPLATE.md`, `TEMPLATE.zh.md` — new. Change-doc template.
- `docs/changes/INDEX.md`, `INDEX.zh.md` — new. Chronological index.
- `docs/changes/2026-06-02-introduce-change-tracking.{md,zh.md}` — new.
  This baseline entry.
- `docs/architecture.md`, `architecture.zh.md` — version marker bumped
  v0.4.0 → v0.7.1; pointer to `docs/changes/` added.

## Verification

Docs-only change; no code touched. Verified internal links resolve
(`CLAUDE.md` → architecture → INDEX → this doc) and that the bilingual
pairs mirror each other.

## Architecture impact

Updated `docs/architecture.md` and `docs/architecture.zh.md`: corrected
the stale version marker (v0.4.0 → v0.7.1) and added a pointer to the
`docs/changes/` ledger for granular per-change history. No structural
change to the system itself.

## Links

- Spec: — (brainstormed live; user opted to skip a written spec)
- Plan: —
- Commits: <this commit>
- CHANGELOG: see `[Unreleased]` › Internal

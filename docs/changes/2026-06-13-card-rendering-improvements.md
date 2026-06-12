---
date: 2026-06-13
type: feat
slug: card-rendering-improvements
---

# Full-width run card + collapsible long answers

**Type:** feat

## Motivation

Two usability problems in busy group chats:

1. **Narrow cards.** The agent run card rendered at Lark's default width, which
   is narrower than the chat pane. Long code blocks and tool-call lists were
   cramped or wrapped unnecessarily.

2. **Long answers dominate the timeline.** A verbose agent answer (tens of
   lines of explanation, code, or logs) pushed every earlier message off screen
   in a busy group. Users had no native way to collapse it once read.

## What changed

Both changes are scoped to `renderRunCard` in `src/lark/card-builder.ts`.
Command cards (`src/lark/command-cards.ts`) are untouched. No config schema
change.

### 1 — Full-width card

`renderRunCard` now sets `config.width_mode: 'fill'` on the card root. This
makes the card span the full width of the chat pane (Lark's `fill` mode)
instead of the default fixed/narrow width.

### 2 — Collapsible long answers

A new constant `ANSWER_FOLD_LINE_THRESHOLD = 10` (raw lines) gates the
behaviour:

- **Short answers (≤ 10 lines):** rendered exactly as before — a plain
  `markdown` element in the answer column.
- **Long answers (> 10 lines):** the markdown element is wrapped in a
  `collapsible_panel` (via the new private `answerPanel` helper) with
  `expanded: true` (default-open, so the answer is readable immediately) and
  the fixed header text `📄 回答（点击可折叠）` as the panel header. Users can collapse the panel with the
  native Lark chevron.

`answerPanel` deliberately does **not** reuse the existing `collapsiblePanel`
helper, which forces `notation`-size text on the panel header. `answerPanel`
omits the text-size override so the panel header renders at normal body size.

## Files touched

- `src/lark/card-builder.ts` — added `config: { width_mode: 'fill' }` to the
  card root in `renderRunCard`; added `ANSWER_FOLD_LINE_THRESHOLD` constant and
  `answerPanel` helper; `renderRunCard` wraps long answer text groups through
  `answerPanel`.
- `tests/lark/card-builder.test.ts` — new tests covering: (a) full-width
  config is present on every rendered run card, (b) short answers (≤ 10 lines)
  are not wrapped in a collapsible panel, (c) long answers (> 10 lines) are
  wrapped in a default-expanded `collapsible_panel`, (d) command cards are
  unaffected.

## Verification

- `pnpm typecheck` — passes.
- `pnpm test` — all tests pass, including new card-builder cases.
- `pnpm lint` — clean.

## Architecture impact

`None.` The card-builder is already described as a rendering helper in
`docs/architecture.md`; no module responsibilities, process topology, adapter
event contract, IPC, or on-disk state changed.

## Links

- Spec: `docs/superpowers/specs/2026-06-13-card-rendering-improvements-design.md`
- Plan: `docs/superpowers/plans/2026-06-13-card-rendering-improvements.md`
- Commits: `125937c`, `c137b30`
- CHANGELOG: `[Unreleased]` entry

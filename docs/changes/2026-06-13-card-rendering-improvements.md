---
date: 2026-06-13
type: feat
slug: card-rendering-improvements
---

# Full-width run card + collapsible long messages

**Type:** feat

## Motivation

Two usability problems in busy group chats:

1. **Narrow cards.** The agent run card rendered at Lark's default width, which
   is narrower than the chat pane. Long code blocks and tool-call lists were
   cramped or wrapped unnecessarily.

2. **Long messages dominate the timeline.** A verbose run (tens of lines of
   explanation, code, logs, plus the tool-call process) pushed every earlier
   message off screen in a busy group. Users had no native way to collapse it
   once read.

## What changed

Both changes are scoped to `renderRunCard` in `src/lark/card-builder.ts`.
Command cards (`src/lark/command-cards.ts`) are untouched. No config schema
change.

### 1 — Full-width card

`renderRunCard` now sets `config.width_mode: 'fill'` on the card root. This
makes the card span the full width of the chat pane (Lark's `fill` mode)
instead of the default fixed/narrow width.

### 2 — Collapsible long messages

Once a run has **finished**, a long message is folded whole — the **tool-call
process and the answer text together** — into a single collapsible panel the
user can expand or collapse:

- `renderRunCard` collects all body elements (answer-text markdown + tool-call
  blockquotes) into one list. If the run is finalized (`terminal !== 'running'`)
  and the body exceeds `ANSWER_FOLD_LINE_THRESHOLD` (10) rendered lines, the
  whole list is wrapped in a default-open `collapsible_panel` via the private
  `answerPanel` helper, with the fixed header `展开/折叠`.
- **While streaming** (or for **short** messages, ≤ 10 lines) the body renders
  flat — so live progress and the in-flight tool panel stay visible, and short
  replies aren't boxed.
- Line count (`bodyLineCount`) approximates rendered height: raw text lines
  (not the blank lines `normalizeMarkdown` inserts) plus one per tool call.

`answerPanel` deliberately does **not** reuse the existing `collapsiblePanel`
helper, which forces `notation`-size (small) text on the panel **body**;
`answerPanel` omits that override so the answer renders at normal body size.
Lark panel headers are static, so the `展开/折叠` label does not flip per state —
the chevron indicates open/closed.

**Design notes (decided during iteration):** a per-text-group fold left the
tool-call process rendered *outside* the panel, and a "first-3-lines preview +
show-more" variant read as visually disjointed — both were rejected in favour
of folding the whole finished message as one unit. Relying on Lark's native
tall-card fold (plain markdown, no panel) was also tried and rejected: it looks
plainer than the bordered panel the user wanted. A bottom-anchored collapse
control was considered but is not possible with `collapsible_panel` (its toggle
is always at the top) without a stateful callback round-trip, so the top toggle
was kept.

## Files touched

- `src/lark/card-builder.ts` — added `config: { width_mode: 'fill' }` to the
  card root in `renderRunCard`; `renderRunCard` now collects the body elements
  and, when finalized and long, folds the whole body through `answerPanel`;
  added the `bodyLineCount` helper and the `ANSWER_FOLD_LINE_THRESHOLD`
  constant; `answerPanel` takes the body element list and uses the `展开/折叠`
  header at normal text size.
- `tests/lark/card-builder.test.ts` — new tests covering: (a) full-width
  config on every rendered run card (streaming + terminal), (b) short messages
  (≤ 10 lines) render flat with no fold panel, (c) long messages (> 10 lines)
  fold whole into one default-open `展开/折叠` panel at normal text size, (d) the
  tool-call process folds together with the answer text in one panel, (e) the
  10-vs-11 line boundary.

## Verification

- `pnpm typecheck` — passes.
- `pnpm test` — all 314 tests pass, including the new card-builder cases.
- `pnpm lint` — clean.
- Manual: verified in a live Lark chat that a finished long message folds the
  tool-call process + answer into one `展开/折叠` panel; short messages render
  flat; the card is full-width.

## Architecture impact

`None.` The card-builder is already described as a rendering helper in
`docs/architecture.md`; no module responsibilities, process topology, adapter
event contract, IPC, or on-disk state changed.

## Links

- Spec: `docs/superpowers/specs/2026-06-13-card-rendering-improvements-design.md`
- Plan: `docs/superpowers/plans/2026-06-13-card-rendering-improvements.md`
- Commits: `125937c`, `c137b30`, `e327245`, `7f02a96`, `a0d2f50`
- CHANGELOG: `[Unreleased]` entry

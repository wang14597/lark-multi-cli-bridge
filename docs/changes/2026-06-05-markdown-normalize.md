---
date: 2026-06-05
type: feat
slug: markdown-normalize
---

# Card text is normalized so dense agent output stops collapsing into a wall

**Type:** feat

## Motivation

The codex bot's cards looked markedly worse than claude's — large sections
ran together into a wall of text. Investigation (and a read of the reference
project `zarazhangrui/lark-coding-agent-bridge`) showed it is **not** a bridge
rendering bug and **not** caused by codex emitting its whole answer in one
block:

- The bridge passed the agent's text **verbatim** into Lark's card `markdown`
  widget (`card-builder.ts` `markdown(content)`) — no newline handling.
- Lark's `markdown` widget needs a **blank line** (`\n\n`) to separate
  block-level pieces; a single `\n` renders as a tight soft-break.
- claude's output uses blank-line-separated paragraphs + lists, so it renders
  airy; codex's output is denser (single newlines between labeled lines, fewer
  blank lines), so the same widget collapses it.
- The reference project's codex parser and card renderer are essentially
  identical to ours (one `agent_message` → one text block, verbatim
  `markdown()`), and it does **no** normalization either — so "one-shot
  emission" is not the differentiator.

The real lever is markdown normalization, which neither project did. This
change adds it on our side.

## What changed

New pure function `normalizeMarkdown(md)` (`src/lark/markdown-normalize.ts`)
re-inserts the blank lines Lark expects, applied to the agent answer text
groups in `renderRunCard`.

Rule: between two adjacent non-blank lines insert exactly one blank line UNLESS
they belong to the same **tight** block (two list items, two blockquote lines,
two table rows). Everything else — prose↔prose, paragraph↔list, list↔paragraph,
around headings and code fences — gets a blank line. Specifics:

- Fenced code blocks (```` ``` ````/`~~~`) are passed through **verbatim** —
  internal blank lines and indentation untouched — with blank padding added
  only around the fence.
- Table rows (lines containing `|`) are treated as a tight block, so a table
  body is never split; a blank line is added before/after the table.
- Runs of blank lines collapse to a single blank line; leading/trailing blank
  lines are trimmed.
- Idempotent: normalizing already-normalized text is a no-op.

Applied in `card-builder.ts` to text groups only (not tool bodies / reasoning
panels). It runs for **all** backends — harmless for claude (already
blank-line-separated; idempotent) and the fix for codex/gemini density.

**Known limitation (documented in the source):** the prose↔prose rule assumes
agents do not hard-wrap a single paragraph across multiple single-newline
lines. claude/codex emit one line per logical paragraph, so this holds; a
backend that soft-wraps prose would see those wraps promoted to paragraphs.

## Files touched

- `src/lark/markdown-normalize.ts` — **new.** `normalizeMarkdown` + line classifier.
- `src/lark/card-builder.ts` — wrap text-group content in `normalizeMarkdown`.
- `tests/lark/markdown-normalize.test.ts` — **new.** 13 unit cases (prose split,
  tight lists w/ blank-before & blank-after, ordered lists, headings,
  blockquotes, fenced-code verbatim, table preservation, blank collapse, trim,
  idempotency, empty/single-line).
- `tests/lark/card-builder.test.ts` — integration case asserting a dense
  text block renders normalized in the card.

## Verification

- `pnpm typecheck` ✅
- `pnpm lint` ✅
- `pnpm test` ✅ — 296 tests pass (was 282; +14).

## Architecture impact

Updated `docs/architecture.md` and `docs/architecture.zh.md`: noted the new
`markdown-normalize.ts` module under `lark/` and that `renderRunCard`
normalizes text-group markdown before emitting it.

## Links

- Spec: `—`
- Plan: `—`
- Commits: `<pending>`
- CHANGELOG: `[Unreleased]` → Changed

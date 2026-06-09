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
doing so would change structure — two items of the same **tight** block (list /
blockquote / table) stay tight, and a continuation line stays attached to its
block (see below). Everything else — prose↔prose, paragraph→list/heading/quote,
around headings and code fences — gets a blank line. Specifics:

- Fenced code blocks (```` ``` ````/`~~~`) are passed through **verbatim** —
  internal blank lines and indentation untouched — with blank padding added
  only around the fence.
- **Real** markdown tables are detected by a GFM **delimiter row**
  (`| --- | --- |`) plus its header, not by the mere presence of a `|`. The
  header + delimiter + contiguous body rows are kept tight (never split), with a
  blank line before/after the table. Prose/code that merely contains a pipe
  (shell `a | b`, TS unions `A | B`, regex alternation) is **not** a table and
  is separated like normal prose.
- An **indented** paragraph right after a list item is treated as that item's
  continuation (wrapped bullet text) and kept attached, so a list is never split
  apart; an unindented paragraph after a list is still separated. A paragraph
  after a blockquote is kept attached as a CommonMark lazy continuation.
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

The first iteration was tightened after a codex code review flagged two
semantic risks: (1) list-item continuation lines were forced out of the list,
and (2) any line with a `|` was treated as a table, gluing pipe-bearing prose.
Both are fixed above and covered by regression tests.

## Files touched

- `src/lark/markdown-normalize.ts` — **new.** `normalizeMarkdown` + line classifier.
- `src/lark/card-builder.ts` — wrap text-group content in `normalizeMarkdown`.
- `tests/lark/markdown-normalize.test.ts` — **new.** 16 unit cases (prose split,
  tight lists w/ blank-before, indented list-continuation attached, ordered
  lists, headings, blockquote tight + lazy continuation, pipe-prose separated,
  real GFM-delimiter table detection + preservation, fenced-code verbatim, blank
  collapse, trim, idempotency, empty/single-line).
- `tests/lark/card-builder.test.ts` — integration case asserting a dense
  text block renders normalized in the card.

## Verification

- `pnpm typecheck` ✅
- `pnpm lint` ✅
- `pnpm test` ✅ — 299 tests pass (was 282; +17).

## Architecture impact

Updated `docs/architecture.md` and `docs/architecture.zh.md`: noted the new
`markdown-normalize.ts` module under `lark/` and that `renderRunCard`
normalizes text-group markdown before emitting it.

## Links

- Spec: `—`
- Plan: `—`
- Commits: `<pending>`
- CHANGELOG: `[Unreleased]` → Changed

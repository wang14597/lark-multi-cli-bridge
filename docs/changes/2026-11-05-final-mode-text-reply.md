---
date: 2026-11-05
type: feat
slug: final-mode-text-reply
---

# `/mode final` replies with a plain message instead of a card

**Type:** feat

## Motivation

After comparing with another team's bot that simply replies with a plain message, the user decided `/mode final` should not use any card. The
in-place card edit from [conclusion-mode](2026-11-05-conclusion-mode.md) also sent no
Lark push notification (only new messages do); a new reply message brings the phone push back.

## What changed

- **No card in final mode.** While a run is going, the bot adds an `OnIt` emoji
  reaction to the user's message (`im.v1.message.reaction` create/delete; verified
  live that `emoji_type: OnIt` works). When the run ends it sends **one** `post`
  (rich text) quote-reply to that message: in group chats an `at` paragraph first,
  then a single `md` paragraph with the conclusion (capped at 8000 chars), and then
  removes the reaction.
- **Errors** → a "⚠️ 没办成：…" reply. **`/stop`** → only the reaction is removed
  (the `/stop` command itself replies "aborted current run"). Runs synthesized
  without a user message (card-click) get no reaction and a top-level post.
- **Failures never throw:** react / send / unreact failures are logged only; the
  reaction is still cleared after a failed send.
- **Trade-offs accepted by the user:** no stop button (use `/stop`) and no progress
  visible while running (just the reaction).
- **Code:** `src/lark/conclusion-card.ts` → `src/lark/conclusion-post.ts`
  (`renderConclusionPost`); `lark-sink.ts` gains the `ReplySink` interface and
  `LarkReplySink`; `ConclusionStreamer` takes a `ReplySink` (no more `CardSink`);
  `card-builder.ts` `stopButton` is private again; the worker builds a
  `LarkReplySink` for final mode and a `LarkCardSink` for stream mode.

- **No prompt text for the conclusion (user decision).** The conclusion used to come with written guidance (a JSON-schema field description, first capped at 1–5 sentences — in trial a requested list of 24 items got squeezed into one paragraph) and Gemini got a closing hint appended to its prompt. The user wants no extra prompt at all: `CONCLUSION_SCHEMA` is now a bare `{conclusion: string}` with no description, `CONCLUSION_GUIDANCE` / `CONCLUSION_PROMPT_HINT` are removed, and Gemini's prompt is untouched (its conclusion is still the text after its last tool call). Verified live with claude 2.1.283: the bare schema still yields the full answer with its Markdown list and line breaks.

- **Headings and tables are rewritten for the post message.** A post's `md` element renders bold, lists, links, quotes and code but not headings or tables — in trial a conclusion with `#` headings and GFM tables showed up raw. `toPostMarkdown` (`src/lark/conclusion-post.ts`) now turns a heading into a bold line and a table into a bold header line plus one bullet per row (cells joined with ` · `); fenced code is untouched.

## Files touched

- `src/lark/conclusion-post.ts` — new: `renderConclusionPost`; replaces the deleted `conclusion-card.ts`.
- `src/worker/lark-sink.ts` — `ReplySink` + `LarkReplySink` (react / unreact / sendPost).
- `src/worker/conclusion-streamer.ts` — reaction + single post flow, takes a `ReplySink`.
- `src/worker/index.ts` — picks `LarkReplySink` (final) or `LarkCardSink` (stream).
- `src/lark/card-builder.ts` — `stopButton` no longer exported.
- `tests/lark/conclusion-post.test.ts` (new, replaces `conclusion-card.test.ts`), `tests/worker/conclusion-streamer.test.ts`, `tests/worker/lark-sink.test.ts`.
- Docs: this change doc (+ `.zh.md`), INDEX, CHANGELOG, `architecture`.

## Verification

`pnpm typecheck`, `pnpm lint` clean; `pnpm test` 396 passing. The `OnIt`
reaction create/delete was verified live against the Lark API. A full
end-to-end `/mode final` check on the running bots is a manual follow-up.

## Architecture impact

Updated `docs/architecture.md` / `.zh.md` (§ adapter event contract / worker
rendering path, `lark/` and `worker/` module rows, version marker): final-mode
streamer is now reaction + one `post` reply.

## Links

- Spec: —
- Plan: —
- Previous change: [2026-11-05-conclusion-mode](2026-11-05-conclusion-mode.md)
- Commits: branch `feat/final-mode-text-reply`
- CHANGELOG: `[Unreleased]` → Changed

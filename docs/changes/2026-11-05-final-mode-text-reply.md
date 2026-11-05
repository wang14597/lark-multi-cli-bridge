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

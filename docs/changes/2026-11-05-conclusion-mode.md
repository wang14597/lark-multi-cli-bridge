---
date: 2026-11-05
type: feat
slug: conclusion-mode
---

# Conclusion mode: `/mode final` shows one conclusion instead of a streaming card

**Type:** feat

## Motivation

A streaming card is noisy for long errands. Users wanted to hand off a task and
get one message with the result. Separately, Codex cards never showed tool calls (the adapter dropped
every non-`agent_message` item) and glued consecutive agent messages together.

## What changed

- **`/mode stream|final`** stores `ChatSession.outputMode` per (chat, bot). It
  survives `/new` and `/cd` and is not admin-only. Default is `stream`.
- **Final mode** (`ConclusionStreamer`, chosen per run by `resolveOutputMode`):
  a "处理中…" status card with a stop button; when the run ends, that same card
  is **rewritten in place** into the conclusion card (groups still prefix
  `<at id=sender></at>`; the stop button goes away). Error / `is_error` →
  "⚠️ 没办成：…" in the same card; user stop → "已停止" in the same card.
  Fallbacks: the in-place patch fails → the conclusion is sent as a new
  message (the streamer never throws); empty → "已完成，但没有返回结论"; raw JSON
  is never shown. The streamer settles on the first terminal event.
- **No-recall decision (user, 2026-11-05, after trying it):** the first version
  sent a new conclusion message and recalled the status card, but the "bot
  recalled a message" notice was jarring, so recall was dropped
  (`LarkCardSink.recall` and the `ConclusionSink` interface removed;
  `ConclusionStreamer` takes a plain `CardSink`). Trade-off the user accepted:
  an in-place card update does not trigger a Lark push notification (only new
  messages do), so final mode no longer pushes.
- **Conclusion source** (`RunContext.conclusion` → `done.conclusion`):
  Claude `--json-schema` → `structured_output.conclusion`; Codex
  `--output-schema <tmp file>` → last `agent_message` JSON (the file is
  `$TMPDIR/lmcb-conclusion-schema-<pid>.json`, per process and re-created before
  every run if the OS temp cleaner removed it); Gemini prompt hint →
  text after the last tool call. Verified 2026-11-05 on claude 2.1.283 /
  codex-cli 0.162.1 that a later turn resumed without the schema answers
  normally.
- **Claude `is_error` finding:** an invalid `--resume` yields a result line with
  `is_error: true`, `subtype: error_during_execution`, the message in `errors[]`
  (no `result`) and exit code 1. The adapter now sets `finalText` from `errors[]`
  and `done.isError`; both a `done{isError}` and an `error` event can occur.
- **Review hardening:** a final-mode run whose stream ends with neither `done`
  nor `error` now shows "⚠️ 没办成：运行结束但没有返回结果" instead of a stuck
  "处理中…" card; conclusion card bodies are capped at 8000 chars; a raw-JSON
  `finalText` on an `is_error` result shows "未知错误"; Codex messages around an
  unrendered `reasoning` item stay separated.
- **Claude stream-mode side effect:** on an `is_error` result with empty
  `result`, `finalText` now comes from `errors[]`, so the stream card shows the
  real error text.
- **Codex fix (stream mode too):** `command_execution` → `tool-call` /
  `tool-result`, `reasoning` → `thinking` (unrendered), messages separated,
  `finalText` = last message. `scripts/record-cli-fixture.sh` now closes stdin
  (`codex exec` hung waiting on it).

## Known limitations

- The worker's group/p2p mention branch has no unit test.
- Gemini's conclusion is best-effort (prompt hint only, no schema support).

## Files touched

- `src/adapters/conclusion.ts` — shared schema + parser; `types.ts` — `RunContext.conclusion`, `done.conclusion` / `done.isError`.
- `src/adapters/claude.ts` / `codex.ts` / `gemini.ts` — per-CLI conclusion extraction; codex tool-call/message mapping.
- `src/commands/handlers/mode.ts` — `/mode`; `src/session/{types,store}.ts` — `outputMode`.
- `src/worker/conclusion-streamer.ts`, `src/lark/conclusion-card.ts` — new streamer + cards; `card-streamer.ts`, `card-builder.ts`, `dispatcher.ts`, `index.ts` — mode routing.
- `scripts/record-cli-fixture.sh` — close stdin; new fixtures under `tests/adapters/__fixtures__/`; tests for each of the above.
- Docs: this change doc (+ `.zh.md`), INDEX, CHANGELOG, `architecture`.

## Verification

`pnpm typecheck`, `pnpm lint`, `pnpm test` pass. Fixtures recorded from real
CLI output (claude `structured-output.jsonl`, codex `json-schema.jsonl` /
`json-tools.jsonl`). Live check on the running bots is a manual follow-up.

## Architecture impact

Updated `docs/architecture.md` / `.zh.md`: adapter event contract (`done`
fields, conclusion extraction), worker rendering path (two streamers), on-disk
state (`outputMode`), commands count 12 → 13, version marker.

## Links

- Spec: `docs/superpowers/specs/2026-11-05-conclusion-mode-design.md`
- Plan: `docs/superpowers/plans/2026-11-05-conclusion-mode.md`
- Commits: `95af287..f2f95f8` plus the review-fix commits `fix: harden conclusion mode per final review` (branch `feat/conclusion-mode`)
- CHANGELOG: `[Unreleased]` → Added, Fixed

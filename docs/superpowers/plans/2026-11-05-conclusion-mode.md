# Conclusion Mode (+ Codex item events) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-chat `/mode final` that hides the run process and delivers one pushed conclusion message, plus Codex cards that show tool calls.

**Architecture:** Adapters get `ctx.conclusion` and return `done.conclusion` (Claude `--json-schema`, Codex `--output-schema`, Gemini prompt hint). The dispatcher picks a `ConclusionStreamer` instead of `CardStreamer` when the chat's `outputMode` is `final`; it shows a "处理中" card, then sends the conclusion as a new message and recalls the status card.

**Tech Stack:** TypeScript ESM, Node ≥ 20, vitest, `@larksuiteoapi/node-sdk`.

**Spec:** `docs/superpowers/specs/2026-11-05-conclusion-mode-design.md`

## Global Constraints

- Every new source file starts with `// SPDX-License-Identifier: MIT`.
- Default mode is `stream`; stream-mode rendering for Claude/Gemini must not change.
- Conclusion mode leaves exactly one message per run (status card recalled), except user stop (status card patched to "已停止", no new message).
- Raw schema JSON (`{"conclusion": …}`) never reaches the chat.
- Codex parser changes are driven by **recorded** fixtures, never hand-written JSON.
- Schema (verbatim): `{"type":"object","properties":{"conclusion":{"type":"string","description":<CONCLUSION_GUIDANCE>}},"required":["conclusion"],"additionalProperties":false}`.
- Fallback text when no conclusion and no finalText: `已完成，但没有返回结论`. Failure prefix: `⚠️ 没办成：`. Status card text: `处理中…`. Stopped text: `已停止`.

## Review Focus

1. Claude result with `is_error: true` followed by a non-zero exit → exactly one "⚠️ 没办成" message, not a conclusion plus an error. (Task 5 test `settles once on done(isError) then error`.)
2. Codex last message is not valid JSON (schema ignored / truncated) → no raw `{` text in chat; fallback used. (Task 1 truncated-JSON test, Task 4 truncated-last-message test, Task 5 JSON-looking finalText test.)
3. Recall API fails (permission / >24h edge) → run still succeeds, status card patched to "已完成". (Task 5 test `recall failure patches status card`.)
4. `/new` or `/cd` after `/mode final` → mode still `final`. (Task 2 store tests.)
5. Card-button callback (`[card-click]`) in a final-mode chat → also conclusion mode, since mode is resolved per chat in the dispatcher, not at enqueue. (Task 6 test `resolveOutputMode applies to every request on the lane`.)

---

### Task 1: Shared conclusion helpers

**Files:**
- Create: `src/adapters/conclusion.ts`
- Test: `tests/adapters/conclusion.test.ts`

**Interfaces:**
- Produces:
  - `CONCLUSION_SCHEMA: Record<string, unknown>` (shape in Global Constraints)
  - `CONCLUSION_GUIDANCE: string` — Chinese: self-contained conclusion for the user, 1–5 sentences, Markdown allowed; success → key result (IDs, links, titles); failure → where it got stuck and what the user must do; don't rely on earlier text in the run.
  - `CONCLUSION_PROMPT_HINT: string` — the guidance phrased as an instruction to end the reply with such a conclusion (for Gemini).
  - `parseConclusionJson(text: string): string | undefined` — returns trimmed `.conclusion` if `text` parses to an object with a non-empty string `conclusion`, else `undefined`.
  - `looksLikeJson(text: string): boolean` — trimmed text starts with `{` or `[`.

- [ ] **Step 1: Write failing tests** — `parseConclusionJson('{"conclusion":" 好了 "}') === '好了'`; returns `undefined` for `'{"conclusion":""}'`, `'{"x":1}'`, `'{"conclusion":'` (truncated), `'plain text'`; `looksLikeJson(' {"a"')` true, `looksLikeJson('卡片已建')` false; `CONCLUSION_SCHEMA.additionalProperties === false` and `required` equals `['conclusion']`.
- [ ] **Step 2:** `pnpm vitest run tests/adapters/conclusion.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement `src/adapters/conclusion.ts`.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** `git commit -m "feat(adapters): shared conclusion schema + parser"`

---

### Task 2: `outputMode` on ChatSession + `/mode` command

**Files:**
- Modify: `src/session/types.ts` (`ChatSession`), `src/session/store.ts` (`upsert`, new setter)
- Create: `src/commands/handlers/mode.ts`
- Modify: `src/worker/index.ts:225` (register handler next to `timeoutHandler`)
- Test: `tests/session/store.test.ts`, `tests/commands/mode.test.ts`

**Interfaces:**
- Produces:
  - `ChatSession.outputMode?: 'stream' | 'final'` (absent = stream)
  - `SessionStore.setOutputMode(chatId: string, botName: string, mode: 'stream' | 'final'): Promise<void>` — throws `chat not initialized` if slot missing (same as `setIdleTimeout`); storing `'stream'` removes the field.
  - `upsert` preserves `outputMode` like `idleTimeoutMs`.
  - `modeHandler: CommandHandler` — name `mode`, not admin-only. No arg → reply `mode: <stream|final>`; `final`/`stream` → set, reply `mode: final (applies on next run)` / `mode: stream (applies on next run)`; else reply `usage: /mode [stream|final]`. Missing slot → `upsert` with `cwd: resolveCwd(ctx.bot.behavior.default_cwd)` first (copy `timeoutHandler`'s pattern).

- [ ] **Step 1: Failing store tests** — `setOutputMode('final')` persists across a reload; survives `reset`, `setCwd(…, true)`, and a later `upsert` without the field; `setOutputMode('stream')` leaves no `outputMode` key; throws on a missing slot.
- [ ] **Step 2: Failing handler tests** (model on `tests/commands/timeout.test.ts`) — show default `mode: stream`; set final on a chat with no slot creates it; bad arg → usage.
- [ ] **Step 3:** Run `pnpm vitest run tests/session/store.test.ts tests/commands/mode.test.ts` → FAIL.
- [ ] **Step 4:** Implement; register in the worker's handler list; confirm `/help` lists `mode` (router builds help from registered handlers — check `tests/commands/router.test.ts` style, add an assertion if a help test exists).
- [ ] **Step 5:** Tests PASS; `git commit -m "feat(commands): /mode stream|final per-chat output mode"`

---

### Task 3: Adapter contract + Claude

**Files:**
- Modify: `src/adapters/types.ts`, `src/adapters/claude.ts`
- Create fixture: `tests/adapters/__fixtures__/claude/structured-output.jsonl` (record: `claude -p "运行 ls，告诉我有几个文件" --output-format stream-json --verbose --permission-mode bypassPermissions --json-schema "$(node -e …CONCLUSION_SCHEMA…)" </dev/null` in a temp dir; trim to the lines needed)
- Test: `tests/adapters/claude.test.ts`

**Interfaces:**
- Produces:
  - `RunContext.conclusion?: boolean`
  - `done` variant: `{ type: 'done'; finalText: string; sessionId: string; usage?: TokenUsage; conclusion?: string; isError?: boolean }`
  - Claude: `--json-schema JSON.stringify(CONCLUSION_SCHEMA)` appended only when `ctx.conclusion`; `done.conclusion = structured_output.conclusion` (trimmed, non-empty only); `done.isError = true` when the result line has `is_error: true`.

- [ ] **Step 1: Failing tests** — fixture → `done.conclusion` equals the recorded conclusion string; `simple-text.jsonl` → no `conclusion` key; a result line `{"type":"result","is_error":true,"result":"boom","session_id":"s"}` → `done.isError === true`; args via `echo-args.sh` contain `--json-schema` only when `conclusion: true`.
- [ ] **Step 2:** `pnpm vitest run tests/adapters/claude.test.ts` → FAIL.
- [ ] **Step 3:** Implement. Also once, manually: run a Claude prompt that errors (e.g. invalid `--resume` id) and note whether it exits non-zero after an `is_error` result — record the finding in the change doc (Task 5 handles both cases anyway).
- [ ] **Step 4:** PASS; `git commit -m "feat(adapters): conclusion + isError on done; claude --json-schema"`

---

### Task 4: Codex item events + `--output-schema`; Gemini hint

**Files:**
- Modify: `scripts/record-cli-fixture.sh` (add `</dev/null` to codex/gemini runs — codex otherwise blocks on stdin; pass through extra args after the prompt)
- Create fixtures: `tests/adapters/__fixtures__/codex/json-tools.jsonl` (prompt: "先用一句话说计划，再运行 ls，最后说文件数量"), `codex/json-schema.jsonl` (same prompt + `--output-schema <file>`)
- Modify: `src/adapters/codex.ts`, `src/adapters/gemini.ts`
- Test: `tests/adapters/codex.test.ts`, `tests/adapters/gemini.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers, Task 3 types.
- Produces (Codex):
  - `parseCodexJsonLine`: `item.started` of each tool-like item type seen in `json-tools.jsonl` (at least `command_execution`) → `tool-call { callId: item.id, name: <'Bash' for command_execution, else item.type>, input: item }`; matching `item.completed` → `tool-result { callId: item.id, name, ok: exit_code === 0 / status not failed, summary: aggregated output (trim to existing summary conventions) }`; `reasoning` → `thinking { text }`; `agent_message` unchanged.
  - `run()`: prefix `'\n\n'` to an agent_message `text-delta` when the previous yielded event was also an agent_message `text-delta` (keeps paragraphs apart; stateless parser can't). `finalText` = last agent_message text only.
  - When `ctx.conclusion`: write `CONCLUSION_SCHEMA` once per process to `join(tmpdir(), 'lmcb-conclusion-schema.json')`, push `--output-schema <file>` before the positional session id/prompt (both `exec` and `exec resume`). On `done`: `conclusion = parseConclusionJson(lastMessage)`; if undefined and `!looksLikeJson(lastMessage)`, `conclusion = lastMessage`; else leave unset.
- Produces (Gemini): when `ctx.conclusion`, append `CONCLUSION_PROMPT_HINT` to the prompt; track text since the last `tool-call`; `done.conclusion` = that text trimmed (unset if empty).

- [ ] **Step 1:** Fix the script; record both fixtures (`bash scripts/record-cli-fixture.sh codex json-tools "<prompt>"` etc.) in a scratch cwd; inspect item types/fields and note them in the test file header.
- [ ] **Step 2: Failing Codex tests** — `json-tools.jsonl` yields ≥1 `tool-call`/`tool-result` pair with equal `callId`; text deltas from two consecutive agent messages render separated by a blank line through `run()` (use `cliPath` pointing at a script that cats the fixture, as existing run() tests do); `done.finalText` equals the last agent_message; `json-schema.jsonl` + `conclusion: true` → `done.conclusion` is the plain conclusion string; a last message `{"conclusion":` (truncated) → no `conclusion`; args contain `--output-schema` on fresh and resumed runs only with `conclusion: true`; existing `json-0130`/`json-simple` tests still pass.
- [ ] **Step 3: Failing Gemini tests** — prompt arg contains the hint only with `conclusion: true`; `stream-json-tools.jsonl` → `done.conclusion` equals the text after the last tool call.
- [ ] **Step 4:** `pnpm vitest run tests/adapters` → FAIL, implement, → PASS.
- [ ] **Step 5:** `git commit -m "fix(codex): surface tool calls + separate messages; feat: conclusion for codex/gemini"`

---

### Task 5: Conclusion cards, recall, `ConclusionStreamer`

**Files:**
- Create: `src/lark/conclusion-card.ts`, `src/worker/conclusion-streamer.ts`
- Modify: `src/worker/lark-sink.ts` (add `recall`)
- Test: `tests/worker/conclusion-streamer.test.ts`, `tests/worker/lark-sink.test.ts`

**Interfaces:**
- Consumes: `done.conclusion` / `done.isError` (via `onDone` opts, Task 6), the existing stop button shape (`{ cmd: 'stop' }` callback — export `stopButton` from `card-builder.ts` rather than duplicating).
- Produces:
  - `renderPendingCard(): object` — `处理中…` + stop button, `streaming_mode` false.
  - `renderNoteCard(text: string): object` — single-line card (used for `已停止` / `已完成`).
  - `renderConclusionCard(text: string, mentionOpenId?: string): object` — Markdown body; when `mentionOpenId`, body starts with `<at id=${mentionOpenId}></at> `; `config.summary.content` = first non-empty line of `text` (≤ 60 chars).
  - `LarkCardSink.recall(messageId: string): Promise<void>` → `client.im.message.delete({ path: { message_id } })`.
  - `interface ConclusionSink extends CardSink { recall(messageId: string): Promise<void> }`
  - `class ConclusionStreamer` with the same methods the dispatcher calls (`start, onTextDelta, onToolCall, onToolResult, onError, onDone, onInterrupted`); constructor `{ sink: ConclusionSink; mentionOpenId?: string; log?: { warn(o: object, m: string): void } }`. `onDone(opts: { finalText: string; durationMs: number; usage?: …; conclusion?: string; isError?: boolean })`.
  - Behavior: settles on the **first** of done/error/interrupted, ignores later ones. done → text = `conclusion || finalText.trim() || '已完成，但没有返回结论'` (if `finalText` is used and `looksLikeJson`, use the fallback line); `isError` → `⚠️ 没办成：${finalText || '未知错误'}`; error(msg) → `⚠️ 没办成：${msg}`. Send via `sink.create(renderConclusionCard(...))`, then `sink.recall(statusId)`; if recall throws, `sink.patch(statusId, renderNoteCard('已完成'))` and log. interrupted → `sink.patch(statusId, renderNoteCard('已停止'))`, no create. Text/tool events: no-ops.

- [ ] **Step 1: Failing tests** with a fake sink recording calls: `done with conclusion → create(conclusion card) then recall(status)`; `empty conclusion + empty finalText → fallback text`; `finalText that looks like JSON → fallback text`; `settles once on done(isError) then error` → one create containing `⚠️ 没办成`; `error → failure card + recall`; `interrupted → patch 已停止, no extra create`; `recall failure patches status card` with `已完成`; `mentionOpenId → body contains <at id=ou_x></at>`; `text/tool events cause no sink calls`; sink test: `recall` calls `im.message.delete` with the id.
- [ ] **Step 2:** `pnpm vitest run tests/worker/conclusion-streamer.test.ts tests/worker/lark-sink.test.ts` → FAIL; implement → PASS.
- [ ] **Step 3:** `git commit -m "feat(worker): conclusion streamer + pending/conclusion cards + message recall"`

---

### Task 6: Wire mode through dispatcher and worker

**Files:**
- Modify: `src/worker/dispatcher.ts`, `src/worker/index.ts:189-217`
- Test: `tests/worker/dispatcher.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 5.
- Produces:
  - `DispatcherOpts.resolveOutputMode?: (chatId: string) => 'stream' | 'final' | undefined`
  - `makeStreamer(chatId, replyTo?, mode?: 'stream' | 'final')` — worker returns `ConclusionStreamer` for `final` (mention = last ingress sender's open id **only when** the chat is a group; take it from `lastIngressByChat`), `CardStreamer` otherwise.
  - `dispatchOne`: resolve mode once per run; pass `conclusion: mode === 'final'` into `adapter.run`; forward `ev.conclusion` / `ev.isError` to `streamer.onDone` when present.
  - Worker: `resolveOutputMode: (chatId) => sessions.get(chatId, bot.name)?.outputMode`.

- [ ] **Step 1: Failing tests** — fake adapter records `RunContext`; with `resolveOutputMode → 'final'` the ctx has `conclusion: true` and `makeStreamer` receives `'final'`; default → no `conclusion` and mode `stream`/undefined; `done { conclusion: 'x', isError: true }` reaches `onDone` opts; `resolveOutputMode applies to every request on the lane` (enqueue two requests without any mode field → both runs get `conclusion: true`).
- [ ] **Step 2:** `pnpm vitest run tests/worker` → FAIL; implement → PASS (all existing worker tests too).
- [ ] **Step 3:** `git commit -m "feat(worker): route final-mode chats to the conclusion streamer"`

---

### Task 7: Docs, full verification, manual check

**Files:**
- Create: `docs/changes/2026-11-05-conclusion-mode.md` + `.zh.md` (from TEMPLATE; link spec + plan; note the Claude `is_error` exit-code finding from Task 3)
- Modify: `docs/changes/INDEX.md` + `INDEX.zh.md` (prepend row), `CHANGELOG.md` (+ `.zh.md` if present) `[Unreleased]` → Added: conclusion mode; Fixed: Codex cards drop tool calls / glue messages
- Modify: `docs/architecture.md` + `.zh.md` — adapter event contract (`RunContext.conclusion`, `done.conclusion/isError`), `ChatSession.outputMode` in on-disk state, worker rendering path (two streamers), commands count (13, incl. `/mode`), bump version marker.
- Modify: `src/prompts/` / overlay skill only if `/help` text lists commands by hand (check; don't add otherwise).

- [ ] **Step 1:** Write the docs.
- [ ] **Step 2:** `pnpm typecheck && pnpm lint && pnpm test` → all pass.
- [ ] **Step 3:** `pnpm reload:all`; `node ./bin/lmcb.mjs ps` → all bots `ready`.
- [ ] **Step 4 (manual, user):** p2p with claude-bot and codex-bot: `/mode final`, send an errand; expect status card → one pushed conclusion, status card gone; `/mode stream` restores streaming; a codex stream-mode run shows tool lines.
- [ ] **Step 5:** `git commit -m "docs: conclusion mode change doc, changelog, architecture"`

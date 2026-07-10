# Card Rendering Improvements Implementation Plan

> **Revision (post-implementation).** Tasks 1 (full-width) and 3 (docs) shipped
> as planned. Task 2 evolved during live iteration: the final behaviour folds
> the **whole finished message (tool-call process + answer text) into one
> default-open `展开/折叠` `collapsible_panel`**, rather than folding each long
> answer text group separately. See
> [`docs/changes/2026-06-13-card-rendering-improvements.md`](../../changes/2026-06-13-card-rendering-improvements.md)
> for the authoritative final design.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the agent run card full-width and let users collapse long answers, both via localized changes to `renderRunCard`.

**Architecture:** Two independent tweaks in `src/lark/card-builder.ts`: (1) add `config.width_mode: 'fill'` to the run card; (2) wrap any answer text group longer than 10 lines in a default-expanded `collapsible_panel` (native client-side collapse, normal text size), leaving short answers as plain markdown.

**Tech Stack:** TypeScript, ESM, vitest. Lark CardKit 2.0 (`collapsible_panel`, `config.width_mode`).

**Spec:** `docs/superpowers/specs/2026-06-13-card-rendering-improvements-design.md`

---

## File Structure

- **Modify:** `src/lark/card-builder.ts` — add `width_mode: 'fill'` to the run-card `config`; add `ANSWER_FOLD_LINE_THRESHOLD` constant and an `answerPanel(body)` helper; branch the text-group rendering on line count.
- **Modify (tests):** `tests/lark/card-builder.test.ts` — width assertion + collapsible long-answer cases.
- **Docs:** `docs/changes/2026-06-13-card-rendering-improvements.md` + `.zh.md`, `docs/changes/INDEX.md` + `.zh.md`, `CHANGELOG.md` + `.zh.md`.

---

## Task 1: Full-width run card (`config.width_mode: 'fill'`)

**Files:**
- Modify: `src/lark/card-builder.ts` (the `return { schema, config, body }` in `renderRunCard`, ~line 53-60)
- Test: `tests/lark/card-builder.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside the `describe('renderRunCard', …)` block in `tests/lark/card-builder.test.ts`:

```ts
it('run card is full-width (config.width_mode = fill) while running', () => {
  const s = createRunState();
  appendText(s, 'partial');
  const card = renderRunCard(s) as Record<string, unknown>;
  const config = card['config'] as Record<string, unknown>;
  expect(config['width_mode']).toBe('fill');
});

it('run card stays full-width in terminal state', () => {
  const s = createRunState();
  appendText(s, 'done text');
  finalize(s, { kind: 'done' });
  const card = renderRunCard(s) as Record<string, unknown>;
  const config = card['config'] as Record<string, unknown>;
  expect(config['width_mode']).toBe('fill');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/lark/card-builder.test.ts -t "full-width"`
Expected: FAIL — `config['width_mode']` is `undefined`.

- [ ] **Step 3: Add `width_mode` to the run-card config**

In `src/lark/card-builder.ts`, in `renderRunCard`, change the returned config from:

```ts
  return {
    schema: '2.0',
    config: {
      streaming_mode: state.terminal === 'running',
      summary: { content: summaryText(state) },
    },
    body: { elements },
  };
```

to:

```ts
  return {
    schema: '2.0',
    config: {
      width_mode: 'fill',
      streaming_mode: state.terminal === 'running',
      summary: { content: summaryText(state) },
    },
    body: { elements },
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/lark/card-builder.test.ts -t "full-width"`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add src/lark/card-builder.ts tests/lark/card-builder.test.ts
git commit -m "feat(card): full-width run card via config.width_mode=fill"
```

---

## Task 2: Collapsible long answers (> 10 lines)

**Files:**
- Modify: `src/lark/card-builder.ts` (text-group branch ~line 25-35; add constant + `answerPanel` helper)
- Test: `tests/lark/card-builder.test.ts`

- [ ] **Step 1: Write the failing tests**

Add inside the `describe('renderRunCard', …)` block:

```ts
it('short answer (<=10 lines) stays a plain markdown element, no panel', () => {
  const s = createRunState();
  const short = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n');
  appendText(s, short);
  finalize(s, { kind: 'done' });
  const card = renderRunCard(s) as Record<string, unknown>;
  const body = card['body'] as Record<string, unknown>;
  const elements = body['elements'] as Array<Record<string, unknown>>;
  // The answer is a plain markdown element containing the text…
  const md = elements.find(
    (e) => e['tag'] === 'markdown' && (e['content'] as string)?.includes('line 1'),
  );
  expect(md).toBeDefined();
  // …and there is no answer collapsible_panel.
  const answerPanels = elements.filter(
    (e) =>
      e['tag'] === 'collapsible_panel' &&
      JSON.stringify(e).includes('回答'),
  );
  expect(answerPanels).toHaveLength(0);
});

it('long answer (>10 lines) is wrapped in a default-expanded collapsible panel at normal text size', () => {
  const s = createRunState();
  const long = Array.from({ length: 11 }, (_, i) => `line ${i + 1}`).join('\n');
  appendText(s, long);
  finalize(s, { kind: 'done' });
  const card = renderRunCard(s) as Record<string, unknown>;
  const body = card['body'] as Record<string, unknown>;
  const elements = body['elements'] as Array<Record<string, unknown>>;
  const panel = elements.find(
    (e) =>
      e['tag'] === 'collapsible_panel' &&
      JSON.stringify(e['header']).includes('回答'),
  ) as Record<string, unknown> | undefined;
  expect(panel).toBeDefined();
  // Visible by default — user collapses it themselves.
  expect(panel!['expanded']).toBe(true);
  // Body is normal size, NOT the small 'notation' size used by reasoning/tool panels.
  const panelEls = panel!['elements'] as Array<Record<string, unknown>>;
  const bodyMd = panelEls[0]!;
  expect(bodyMd['tag']).toBe('markdown');
  expect(bodyMd['text_size']).toBeUndefined();
  // The content is present and normalized inside the panel.
  expect((bodyMd['content'] as string)).toContain('line 11');
});

it('threshold boundary: exactly 10 lines plain, 11 lines folds', () => {
  const make = (n: number): Record<string, unknown> => {
    const s = createRunState();
    appendText(s, Array.from({ length: n }, (_, i) => `L${i + 1}`).join('\n'));
    finalize(s, { kind: 'done' });
    return renderRunCard(s) as Record<string, unknown>;
  };
  const has回答Panel = (card: Record<string, unknown>): boolean => {
    const els = (card['body'] as { elements: Array<Record<string, unknown>> }).elements;
    return els.some(
      (e) => e['tag'] === 'collapsible_panel' && JSON.stringify(e['header']).includes('回答'),
    );
  };
  expect(has回答Panel(make(10))).toBe(false);
  expect(has回答Panel(make(11))).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/lark/card-builder.test.ts -t "answer"`
Expected: FAIL — no `collapsible_panel` with a `回答` header exists yet; long answers currently render as plain markdown.

- [ ] **Step 3: Add the threshold constant**

In `src/lark/card-builder.ts`, near the top constants (after `const REASONING_MAX = 1500;`), add:

```ts
// Answer text longer than this many lines is wrapped in a default-expanded
// collapsible panel so the user can collapse it. Short answers stay plain.
const ANSWER_FOLD_LINE_THRESHOLD = 10;
```

- [ ] **Step 4: Add the `answerPanel` helper**

In `src/lark/card-builder.ts`, add this function next to `reasoningPanel` / `toolPanel` (it deliberately does NOT reuse `collapsiblePanel`, because that helper forces `text_size: 'notation'` — the answer must render at normal size):

```ts
function answerPanel(body: string): object {
  return {
    tag: 'collapsible_panel',
    expanded: true,
    header: panelHeader('📄 回答（点击可折叠）'),
    border: { color: 'grey', corner_radius: '5px' },
    vertical_spacing: '8px',
    padding: '8px 8px 8px 8px',
    elements: [{ tag: 'markdown', content: body }],
  };
}
```

- [ ] **Step 5: Branch the text-group rendering on line count**

In `renderRunCard`, replace the text-group branch:

```ts
    if (group.kind === 'text') {
      if (group.content.trim()) {
        // Re-insert the blank lines Lark's markdown widget needs so dense
        // single-newline agent output (esp. codex) doesn't collapse into a wall.
        elements.push(markdown(normalizeMarkdown(group.content)));
      }
    } else {
```

with:

```ts
    if (group.kind === 'text') {
      if (group.content.trim()) {
        // Re-insert the blank lines Lark's markdown widget needs so dense
        // single-newline agent output (esp. codex) doesn't collapse into a wall.
        const md = normalizeMarkdown(group.content);
        // Long answers get a default-expanded collapsible panel so the user
        // can collapse them; short answers stay as a plain markdown element.
        // Count raw lines (what the agent wrote), not the blank lines
        // normalizeMarkdown inserts.
        if (group.content.split('\n').length > ANSWER_FOLD_LINE_THRESHOLD) {
          elements.push(answerPanel(md));
        } else {
          elements.push(markdown(md));
        }
      }
    } else {
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm vitest run tests/lark/card-builder.test.ts -t "answer"`
Expected: PASS (all three cases).

- [ ] **Step 7: Run the full card-builder suite to check for regressions**

Run: `pnpm vitest run tests/lark/card-builder.test.ts`
Expected: PASS — existing tests (dense-text normalization, tool rendering, streaming flags) still green; the dense-text test uses 2-line input so it stays a plain markdown element.

- [ ] **Step 8: Commit**

```bash
git add src/lark/card-builder.ts tests/lark/card-builder.test.ts
git commit -m "feat(card): collapsible panel for answers longer than 10 lines"
```

---

## Task 3: Change docs + CHANGELOG + final verification

**Files:**
- Create: `docs/changes/2026-06-13-card-rendering-improvements.md`
- Create: `docs/changes/2026-06-13-card-rendering-improvements.zh.md`
- Modify: `docs/changes/INDEX.md`, `docs/changes/INDEX.zh.md`
- Modify: `CHANGELOG.md`, `CHANGELOG.zh.md`

- [ ] **Step 1: Write the change doc (`.md`)**

Create `docs/changes/2026-06-13-card-rendering-improvements.md` by copying `docs/changes/TEMPLATE.md` and filling it:
- **Type:** feat
- **Motivation:** Long agent answers dominated busy group chats and cards used the narrow default width. Users wanted (a) a way to collapse long answers themselves and (b) wider cards.
- **What changed:** `renderRunCard` now sets `config.width_mode: 'fill'`, and answer text groups longer than `ANSWER_FOLD_LINE_THRESHOLD` (10) lines are wrapped in a default-expanded `collapsible_panel` (`answerPanel`, normal text size) so the user can collapse them natively; short answers are unchanged. Both scoped to the agent run card; command cards untouched.
- **Files touched:** `src/lark/card-builder.ts`, `tests/lark/card-builder.test.ts`.
- **Verification:** `pnpm typecheck` / `pnpm test` / `pnpm lint` all pass.
- **Architecture impact:** `None.` (architecture.md describes card-builder responsibilities at a high level only; no module/contract/topology change.)
- **Links:** Spec `docs/superpowers/specs/2026-06-13-card-rendering-improvements-design.md`, Plan `docs/superpowers/plans/2026-06-13-card-rendering-improvements.md`.

- [ ] **Step 2: Write the change doc (`.zh.md`)**

Create `docs/changes/2026-06-13-card-rendering-improvements.zh.md` by copying `docs/changes/TEMPLATE.zh.md` and filling it with the same content in Chinese.

- [ ] **Step 3: Prepend INDEX rows (newest first)**

In `docs/changes/INDEX.md`, add directly under the `|------|...|` header row:

```
| 2026-06-13 | feat | [card-rendering-improvements](2026-06-13-card-rendering-improvements.md) | Long agent answers dominated group chats and cards used the narrow default width. `renderRunCard` now sets `config.width_mode: 'fill'` (full-width) and wraps answer text >10 lines in a default-expanded `collapsible_panel` (normal text size) so users can collapse it natively; short answers unchanged, command cards untouched. |
```

In `docs/changes/INDEX.zh.md`, add the Chinese equivalent row under its header.

- [ ] **Step 4: Add CHANGELOG `[Unreleased]` entries**

In `CHANGELOG.md`, under `## [Unreleased]` → `### Added`, add:

```
- **Full-width agent cards + collapsible long answers.** The run card now uses `config.width_mode: "fill"` so wide content (tables, code) has room, and any answer longer than 10 lines is wrapped in a default-expanded `collapsible_panel` (`answerPanel` in `src/lark/card-builder.ts`, normal text size) so users can collapse it with the native chevron — no auto-folding, short answers unchanged, command cards untouched. See [docs/changes/2026-06-13-card-rendering-improvements.md](docs/changes/2026-06-13-card-rendering-improvements.md).
```

Add the Chinese equivalent under `## [未发布]` → `### 新增` in `CHANGELOG.zh.md`.

- [ ] **Step 5: Full verification**

Run: `pnpm typecheck && pnpm test && pnpm lint`
Expected: typecheck clean, all tests pass, lint clean.

- [ ] **Step 6: Commit**

```bash
git add docs/changes CHANGELOG.md CHANGELOG.zh.md
git commit -m "docs(card): change doc + CHANGELOG for card rendering improvements"
```

---

## Done criteria

- [ ] `config.width_mode === 'fill'` on the run card (streaming + terminal).
- [ ] Answers > 10 raw lines render as a `collapsible_panel` with header `📄 回答（点击可折叠）`, `expanded: true`, normal text size; ≤ 10 lines render as plain markdown.
- [ ] `pnpm typecheck` / `pnpm test` / `pnpm lint` pass.
- [ ] Change doc (`.md` + `.zh.md`) + INDEX rows + CHANGELOG entries written.

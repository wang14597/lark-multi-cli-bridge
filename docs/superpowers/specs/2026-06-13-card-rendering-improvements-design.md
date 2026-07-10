# Card rendering improvements — collapsible long answers + full-width run cards

- **Date**: 2026-06-13
- **Status**: Superseded by implementation — see revision note
- **Author**: Lei (via Claude Code)
- **Scope**: `src/lark/card-builder.ts` (+ tests)

> **Revision (post-implementation).** This spec captures the original design.
> During live iteration the collapse behaviour changed materially: instead of
> folding each long *answer text group* on its own (this spec, §3.1), the
> **whole finished message — tool-call process + answer text together — folds
> into one default-open `collapsible_panel`** with the header **`展开/折叠`**
> (not `📄 回答（点击可折叠）`); streaming and short messages render flat. A
> "first-3-lines preview + show-more" variant and Lark's native tall-card fold
> were both tried and rejected. The full-width change (§3.2) shipped as
> designed. The authoritative record of what shipped is
> [`docs/changes/2026-06-13-card-rendering-improvements.md`](../../changes/2026-06-13-card-rendering-improvements.md).

## 1. Goal & Non-Goals

### Goal

Two independent, user-requested improvements to how the bridge renders the
streaming run card in Lark, both localized to `renderRunCard` in
`src/lark/card-builder.ts`:

1. **Collapsible long answers** — a long agent answer should stay fully
   visible by default but give the user a native control to collapse it, so
   busy group chats aren't dominated by one giant card. The user collapses it
   themselves; nothing folds automatically.
2. **Full-width run cards** — the agent answer card should fill the
   conversation width (`config.width_mode: "fill"`) instead of the client
   default, so wide content (tables, code) has more room.

### Non-Goals

- No auto-folding / threshold-based hiding of content. Default state is always
  **expanded** (visible). Folding is a user action only.
- No change to command/utility cards (`/status`, `/help`, `/ws`, …) built in
  `src/lark/command-cards.ts`. Width and folding apply to the agent run card
  only.
- No per-bot configuration or schema change. The fold threshold is a hardcoded
  constant.
- No change to the existing reasoning panel or tool panels — they already use
  collapsible panels and are out of scope.

## 2. Decisions (locked during brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| 1 | When to add the fold control | Only for **long** answer text (> 10 lines); short answers stay as plain markdown |
| 2 | Line threshold | **10 lines** (`> 10` folds; `<= 10` does not) |
| 3 | Line counting basis | Raw text-group content `split('\n').length`, measured **before** `normalizeMarkdown` (count what the agent actually wrote, not the blank lines normalization inserts) |
| 4 | Default panel state | `expanded: true` — answer is visible by default; user clicks the panel header chevron to collapse |
| 5 | Panel text size | **Normal** (not `notation`). The answer is primary content, unlike the small-text reasoning/tool panels |
| 6 | Panel border | `grey` (consistent with reasoning/tool panels) |
| 7 | Panel header text | `📄 回答（点击可折叠）` |
| 8 | Width mode | `config.width_mode: "fill"` (full conversation width) |
| 9 | Width scope | Agent run card only (`renderRunCard`); command cards unchanged |
| 10 | Granularity | Per text-group: each text block is judged independently against the threshold |

## 3. Design

### 3.1 Collapsible long answers

Today (`card-builder.ts:25-35`) each text group is rendered as a plain
markdown element:

```ts
elements.push(markdown(normalizeMarkdown(group.content)));
```

New behavior — wrap long text groups in a default-expanded collapsible panel:

```ts
const normalized = normalizeMarkdown(group.content);
const lineCount = group.content.split('\n').length;        // raw, pre-normalize
if (lineCount > ANSWER_FOLD_LINE_THRESHOLD) {
  elements.push(answerPanel(normalized));                  // collapsible, expanded
} else {
  elements.push(markdown(normalized));                     // unchanged
}
```

`ANSWER_FOLD_LINE_THRESHOLD = 10`.

The new `answerPanel(body)` is a sibling of the existing `collapsiblePanel`,
but **does not force `text_size: 'notation'`** — the answer body renders at
normal size. It reuses `panelHeader` for the chevron affordance:

```ts
function answerPanel(body: string): object {
  return {
    tag: 'collapsible_panel',
    expanded: true,
    header: panelHeader('📄 回答（点击可折叠）'),
    border: { color: 'grey', corner_radius: '5px' },
    vertical_spacing: '8px',
    padding: '8px 8px 8px 8px',
    elements: [{ tag: 'markdown', content: body }],   // no text_size override
  };
}
```

**One code path for streaming and terminal states.** While the run is
streaming, the panel is `expanded: true`, so growing text stays visible — the
header just appears once the content crosses 10 lines. The card stops being
patched once it reaches a terminal state, so when the user collapses the final
static card, no later patch re-expands it. Collapse/expand is handled natively
by the Lark client (client-side state, no `card.action` callback, no tokens).

**Per-group granularity.** When tool calls split the answer into multiple text
groups, each group is judged independently. This is the natural consequence of
the per-group loop; multi-panel answers are an accepted edge case, not
special-cased.

### 3.2 Full-width run card

`renderRunCard` returns a card whose `config` currently carries only
`streaming_mode` and `summary` (`card-builder.ts:53-60`). Add `width_mode`:

```ts
config: {
  width_mode: 'fill',
  streaming_mode: state.terminal === 'running',
  summary: { content: summaryText(state) },
},
```

`fill` makes the card span the conversation width. It requires Lark client
≥ 7.20; older clients silently fall back to default width (no error). Command
cards in `command-cards.ts` are untouched.

## 4. Testing

Add to the card-builder test suite:

- **Short answer** (≤ 10 lines) → rendered as a plain `markdown` element (no
  `collapsible_panel`), behavior unchanged.
- **Long answer** (> 10 lines) → rendered as a `collapsible_panel` with
  `expanded: true`, header text `📄 回答（点击可折叠）`, and a body markdown
  element that does **not** set `text_size: 'notation'`.
- **Threshold boundary** — exactly 10 lines → plain markdown; 11 lines → panel.
- **Width** — `renderRunCard` output has `config.width_mode === 'fill'` in both
  streaming and terminal states.

## 5. Files touched

- `src/lark/card-builder.ts` — `ANSWER_FOLD_LINE_THRESHOLD` const, `answerPanel`
  helper, the wrap decision in the text-group branch, and `width_mode: 'fill'`
  in the run-card config.
- `tests/lark/card-builder.test.ts` — the cases above.
- Change docs (`docs/changes/…` `.md` + `.zh.md`), INDEX, CHANGELOG per the
  project convention.

## 6. Open questions

None — all decisions locked in §2.

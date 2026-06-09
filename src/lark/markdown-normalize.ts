// SPDX-License-Identifier: MIT

/**
 * Lark's card `markdown` widget needs a **blank line** between block-level
 * pieces — a single `\n` between two lines renders as a tight soft-break, so
 * agent output that puts each point on its own single-newlined line (common
 * with the codex backend) collapses into a visual wall. This normalizer
 * re-introduces the blank lines Lark expects, without touching the inside of
 * fenced code blocks, splitting a real table, or detaching a list/quote
 * continuation line from its block.
 *
 * The rule: between two adjacent non-blank lines insert exactly one blank line
 * UNLESS doing so would change structure —
 *   - two items of the same tight block (list / blockquote / table) stay tight;
 *   - a `paragraph` line right after a `list`/`quote` line is treated as that
 *     block's continuation (CommonMark lazy continuation), so no blank is forced
 *     between them — otherwise a wrapped bullet would be split out of its list.
 * Everything else — prose↔prose, paragraph→list/heading/quote/table, around
 * headings and code fences — gets a blank line.
 *
 * Table detection requires a real GFM delimiter row (`| --- | --- |`), not just
 * the presence of a `|`, so prose/code with pipes (shell `a | b`, TS unions
 * `A | B`, regex alternation) is treated as normal prose and still separated.
 *
 * It is idempotent: running it on already-normalized text is a no-op.
 *
 * NOTE: the prose↔prose rule assumes agents do not hard-wrap a single
 * paragraph across multiple single-newline lines (claude/codex emit one line
 * per logical paragraph). A backend that soft-wraps prose would see those wraps
 * promoted to separate paragraphs.
 */

type LineClass = 'heading' | 'list' | 'quote' | 'table' | 'paragraph';

const FENCE_RE = /^\s*(```|~~~)/;
const HEADING_RE = /^\s{0,3}#{1,6}(\s|$)/;
const LIST_RE = /^\s*([-*+]\s+|\d+[.)]\s+)/;
const QUOTE_RE = /^\s*>/;

function rstrip(s: string): string {
  return s.replace(/\s+$/, '');
}

/** A GFM table delimiter row, e.g. `| --- | :--: |` or `a | b` -> `--- | ---`. */
function isDelimiterRow(line: string): boolean {
  const t = line.trim();
  if (!t.includes('|')) return false;
  const cells = t
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

/**
 * Mark which line indices belong to a real markdown table: a delimiter row,
 * the header row immediately above it, and the contiguous pipe-bearing body
 * rows below. Lines inside fenced code are never tables.
 */
function findTableLines(lines: string[], inFence: boolean[]): Set<number> {
  const table = new Set<number>();
  for (let i = 1; i < lines.length; i++) {
    if (inFence[i] || inFence[i - 1]) continue;
    if (!isDelimiterRow(lines[i]!)) continue;
    const header = lines[i - 1]!;
    if (header.trim() === '' || !header.includes('|')) continue;
    table.add(i - 1);
    table.add(i);
    for (let j = i + 1; j < lines.length; j++) {
      const body = lines[j]!;
      if (inFence[j] || body.trim() === '' || !body.includes('|')) break;
      table.add(j);
    }
  }
  return table;
}

/** Lines that are a fence delimiter or sit inside a fenced code block. */
function findFenceLines(lines: string[]): boolean[] {
  const fence = new Array<boolean>(lines.length).fill(false);
  let inside = false;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE_RE.test(rstrip(lines[i]!))) {
      fence[i] = true;
      inside = !inside;
      continue;
    }
    if (inside) fence[i] = true;
  }
  return fence;
}

function classify(line: string, index: number, tableLines: Set<number>): LineClass {
  if (tableLines.has(index)) return 'table';
  if (HEADING_RE.test(line)) return 'heading';
  if (LIST_RE.test(line)) return 'list';
  if (QUOTE_RE.test(line)) return 'quote';
  return 'paragraph';
}

/** Whether a blank line must separate prev (last emitted) from curr. */
function needsBlank(prev: LineClass, curr: LineClass, currIndented: boolean): boolean {
  // Two items of the same tight block stay glued.
  if (prev === curr && (curr === 'list' || curr === 'quote' || curr === 'table')) {
    return false;
  }
  // An *indented* paragraph after a list item is that item's continuation
  // (wrapped bullet text); keep it attached. An unindented paragraph is treated
  // as a new block and still separated.
  if (prev === 'list' && curr === 'paragraph' && currIndented) {
    return false;
  }
  // A paragraph right after a blockquote is its lazy continuation (CommonMark
  // allows it unindented), so keep it attached rather than splitting the quote.
  if (prev === 'quote' && curr === 'paragraph') {
    return false;
  }
  return true;
}

export function normalizeMarkdown(md: string): string {
  const lines = md.split('\n');
  const inFence = findFenceLines(lines);
  const tableLines = findTableLines(lines, inFence);

  const out: string[] = [];
  // Class of the last emitted non-blank, non-fence line; null before any content.
  let prevClass: LineClass | null = null;
  // A blank line seen in the input but not yet committed (lets us honour an
  // author blank while collapsing runs of them).
  let pendingBlank = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;

    if (inFence[i]) {
      const fenceLine = rstrip(rawLine);
      const isDelimiter = FENCE_RE.test(fenceLine);
      // Opening fence (delimiter following non-fence content) separates like a
      // block; everything else inside the fence is emitted verbatim.
      if (isDelimiter && (i === 0 || !inFence[i - 1])) {
        if (prevClass !== null) out.push('');
        out.push(fenceLine);
      } else {
        out.push(rawLine);
      }
      prevClass = i + 1 < lines.length && inFence[i + 1] ? prevClass : 'paragraph';
      // After the closing fence, force separation from following content by
      // treating the block boundary as a paragraph edge.
      pendingBlank = false;
      continue;
    }

    const line = rstrip(rawLine);
    if (line.trim() === '') {
      pendingBlank = true;
      continue;
    }

    const cls = classify(line, i, tableLines);
    if (prevClass !== null && (pendingBlank || needsBlank(prevClass, cls, /^\s/.test(line)))) {
      out.push('');
    }
    out.push(line);
    prevClass = cls;
    pendingBlank = false;
  }

  return out.join('\n');
}

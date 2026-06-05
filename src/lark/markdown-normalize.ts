// SPDX-License-Identifier: MIT

/**
 * Lark's card `markdown` widget needs a **blank line** between block-level
 * pieces — a single `\n` between two lines renders as a tight soft-break, so
 * agent output that puts each point on its own single-newlined line (common
 * with the codex backend) collapses into a visual wall. This normalizer
 * re-introduces the blank lines Lark expects, without touching the inside of
 * fenced code blocks or splitting the rows of a table.
 *
 * The rule is intentionally simple: between two adjacent non-blank lines insert
 * exactly one blank line UNLESS they belong to the same "tight" block (two list
 * items, two blockquote lines, two table rows) where a single newline is the
 * correct rendering. Everything else — prose↔prose, paragraph↔list,
 * list↔paragraph, around headings and code fences — gets a blank line.
 *
 * It is idempotent: running it on already-normalized text is a no-op.
 *
 * NOTE: this assumes agent output does not hard-wrap a single paragraph across
 * multiple lines (claude/codex emit one line per logical paragraph). If a
 * backend ever soft-wraps prose, those wraps would become separate paragraphs.
 */

type LineClass = 'heading' | 'list' | 'quote' | 'table' | 'fence' | 'paragraph';

const FENCE_RE = /^\s*(```|~~~)/;
const HEADING_RE = /^\s{0,3}#{1,6}(\s|$)/;
const LIST_RE = /^\s*([-*+]\s+|\d+[.)]\s+)/;
const QUOTE_RE = /^\s*>/;

function classify(line: string): LineClass {
  if (HEADING_RE.test(line)) return 'heading';
  if (LIST_RE.test(line)) return 'list';
  if (QUOTE_RE.test(line)) return 'quote';
  // A pipe almost always means a table row here; treating it as a tight block
  // keeps `| a | b |` rows from being split apart.
  if (line.includes('|')) return 'table';
  return 'paragraph';
}

/** Two adjacent lines of the same tight class keep their single newline. */
function isTightContinuation(prev: LineClass, curr: LineClass): boolean {
  return prev === curr && (curr === 'list' || curr === 'quote' || curr === 'table');
}

export function normalizeMarkdown(md: string): string {
  const out: string[] = [];
  let inFence = false;
  // Class of the last emitted non-blank line, or null before any content.
  let prevClass: LineClass | null = null;
  // A blank line seen in the input but not yet committed (lets us both honour
  // and collapse author blank lines).
  let pendingBlank = false;

  const pushSeparated = (cls: LineClass, line: string): void => {
    if (prevClass !== null && (pendingBlank || !isTightContinuation(prevClass, cls))) {
      out.push('');
    }
    out.push(line);
    prevClass = cls;
    pendingBlank = false;
  };

  for (const rawLine of md.split('\n')) {
    if (FENCE_RE.test(rawLine.replace(/\s+$/, ''))) {
      const fenceLine = rawLine.replace(/\s+$/, '');
      if (!inFence) {
        // Opening fence: separate it from preceding content like any block.
        pushSeparated('fence', fenceLine);
        inFence = true;
      } else {
        // Closing fence belongs to the block — emit verbatim, no leading blank.
        out.push(fenceLine);
        inFence = false;
        prevClass = 'fence';
        pendingBlank = false;
      }
      continue;
    }

    if (inFence) {
      // Verbatim inside code — including blank lines and trailing whitespace.
      out.push(rawLine);
      continue;
    }

    const line = rawLine.replace(/\s+$/, '');
    if (line.trim() === '') {
      pendingBlank = true;
      continue;
    }
    pushSeparated(classify(line), line);
  }

  return out.join('\n');
}

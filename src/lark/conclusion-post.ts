// SPDX-License-Identifier: MIT

// Keep well under Lark's message size limit so the send can't fail on huge text.
const MAX_BODY = 8000;

const cells = (row: string) =>
  row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isDelimiterRow = (l: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l);

/**
 * A post's `md` element renders bold, lists, links, quotes and code, but not
 * headings or tables — those show as raw `#` / `|`. Rewrite them: a heading
 * becomes a bold line, a table becomes a bold header line plus one bullet per
 * row. Fenced code is left alone.
 */
export function toPostMarkdown(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (inFence || /^\s*```/.test(line)) {
      out.push(line);
      continue;
    }
    const heading = /^\s*#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      out.push(`**${heading[1]}**`);
      continue;
    }
    if (isTableRow(line) && isDelimiterRow(lines[i + 1] ?? '')) {
      out.push(`**${cells(line).join(' · ')}**`);
      i++; // skip the delimiter row
      while (i + 1 < lines.length && isTableRow(lines[i + 1]!)) {
        out.push(`- ${cells(lines[++i]!).join(' · ')}`);
      }
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

/** Content of a `post` (rich text) message: optional @mention line, then the conclusion as Markdown. */
export function renderConclusionPost(rawText: string, mentionOpenId?: string): object {
  const md = toPostMarkdown(rawText);
  const text = md.length > MAX_BODY ? md.slice(0, MAX_BODY) + '…' : md;
  // A `md` element must sit alone in its paragraph, so the mention gets its own line.
  const content: object[][] = [[{ tag: 'md', text }]];
  if (mentionOpenId) content.unshift([{ tag: 'at', user_id: mentionOpenId }]);
  return { zh_cn: { content } };
}

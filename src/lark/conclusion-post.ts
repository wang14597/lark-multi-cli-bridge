// SPDX-License-Identifier: MIT

// Keep well under Lark's message size limit so the send can't fail on huge text.
const MAX_BODY = 8000;

/** Content of a `post` (rich text) message: optional @mention line, then the conclusion as Markdown. */
export function renderConclusionPost(rawText: string, mentionOpenId?: string): object {
  const text = rawText.length > MAX_BODY ? rawText.slice(0, MAX_BODY) + '…' : rawText;
  // A `md` element must sit alone in its paragraph, so the mention gets its own line.
  const content: object[][] = [[{ tag: 'md', text }]];
  if (mentionOpenId) content.unshift([{ tag: 'at', user_id: mentionOpenId }]);
  return { zh_cn: { content } };
}

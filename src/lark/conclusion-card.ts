// SPDX-License-Identifier: MIT
import { stopButton } from './card-builder.js';

function shell(summary: string, elements: object[]): object {
  return {
    schema: '2.0',
    config: { width_mode: 'fill', streaming_mode: false, summary: { content: summary } },
    body: { elements },
  };
}

export function renderPendingCard(): object {
  return shell('处理中…', [{ tag: 'markdown', content: '处理中…' }, stopButton()]);
}

export function renderNoteCard(text: string): object {
  return shell(text, [{ tag: 'markdown', content: text }]);
}

// Keep well under Lark's card size limit so create/patch can't fail on huge text.
const MAX_BODY = 8000;

export function renderConclusionCard(rawText: string, mentionOpenId?: string): object {
  const text = rawText.length > MAX_BODY ? rawText.slice(0, MAX_BODY) + '…' : rawText;
  const first = text.split('\n').find((l) => l.trim()) ?? '';
  const content = mentionOpenId ? `<at id=${mentionOpenId}></at> ${text}` : text;
  return shell(first.trim().slice(0, 60), [{ tag: 'markdown', content }]);
}

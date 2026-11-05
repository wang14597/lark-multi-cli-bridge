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

export function renderConclusionCard(text: string, mentionOpenId?: string): object {
  const first = text.split('\n').find((l) => l.trim()) ?? '';
  const content = mentionOpenId ? `<at id=${mentionOpenId}></at> ${text}` : text;
  return shell(first.trim().slice(0, 60), [{ tag: 'markdown', content }]);
}

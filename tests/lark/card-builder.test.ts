// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { buildStreamingCard } from '../../src/lark/card-builder.js';

describe('buildStreamingCard', () => {
  it('starts with a thinking spinner and empty body', () => {
    const card = buildStreamingCard({
      header: 'claude-bot @ /tmp',
      bodyMarkdown: '',
      state: 'thinking',
    });
    expect(card.schema).toBe('2.0');
    expect(JSON.stringify(card)).toContain('Thinking');
  });

  it('shows final-state footer with timing and tokens when done', () => {
    const card = buildStreamingCard({
      header: 'claude-bot @ /tmp',
      bodyMarkdown: 'Hello world',
      state: 'done',
      footer: '12.3s · 1.2k tokens',
    });
    expect(JSON.stringify(card)).toContain('12.3s');
    expect(JSON.stringify(card)).toContain('Hello world');
  });

  it('renders tool-call rows', () => {
    const card = buildStreamingCard({
      header: 'claude-bot',
      bodyMarkdown: '',
      state: 'thinking',
      toolCalls: [{ name: 'Read', summary: 'foo.ts', done: true, ok: true }],
    });
    expect(JSON.stringify(card)).toContain('Read');
    expect(JSON.stringify(card)).toContain('foo.ts');
  });
});

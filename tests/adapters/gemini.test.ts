// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { stripAnsi, chunkToEvents } from '../../src/adapters/gemini.js';

describe('GeminiAdapter.stripAnsi', () => {
  it('removes ANSI escape sequences', () => {
    expect(stripAnsi('\x1b[31mhello\x1b[0m world')).toBe('hello world');
  });
});

describe('GeminiAdapter.chunkToEvents', () => {
  it('emits a text-delta event with the input unchanged when no ANSI', () => {
    const evs = [...chunkToEvents('plain')];
    expect(evs).toEqual([{ type: 'text-delta', text: 'plain' }]);
  });
});

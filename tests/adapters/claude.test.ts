// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseClaudeLine } from '../../src/adapters/claude.js';
import type { AdapterEvent } from '../../src/adapters/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function eventsFromFixture(name: string): AdapterEvent[] {
  const path = join(HERE, '__fixtures__/claude', name);
  const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim());
  const out: AdapterEvent[] = [];
  for (const line of lines) {
    for (const ev of parseClaudeLine(line)) out.push(ev);
  }
  return out;
}

describe('ClaudeAdapter.parseClaudeLine', () => {
  it('translates simple-text fixture to text-delta + done', () => {
    const events = eventsFromFixture('simple-text.jsonl');
    expect(events[0]).toEqual({ type: 'session-start', sessionId: 'sess_abc' });
    expect(events.filter((e) => e.type === 'text-delta').map((e) => (e as Extract<AdapterEvent, { type: 'text-delta' }>).text)).toEqual(['Hello', ' world']);
    const done = events.find((e) => e.type === 'done');
    expect(done).toMatchObject({
      type: 'done',
      sessionId: 'sess_abc',
      finalText: 'Hello world',
      usage: { inputTokens: 12, outputTokens: 4 },
    });
  });

  it('translates tool_use blocks to tool-call and tool-result events', () => {
    const events = eventsFromFixture('with-tool-use.jsonl');
    const toolCall = events.find((e) => e.type === 'tool-call');
    expect(toolCall).toMatchObject({ type: 'tool-call', name: 'Read', callId: 'tu_1', input: { file_path: 'foo.ts' } });
    const toolResult = events.find((e) => e.type === 'tool-result');
    expect(toolResult).toMatchObject({ type: 'tool-result', callId: 'tu_1', ok: true });
  });
});

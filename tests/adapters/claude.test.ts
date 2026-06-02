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

  // -----------------------------------------------------------------------
  // tool_result content passthrough — the "Skill 无输出" root cause
  // -----------------------------------------------------------------------

  function parseOne(line: string): AdapterEvent[] {
    const out: AdapterEvent[] = [];
    for (const ev of parseClaudeLine(line)) out.push(ev);
    return out;
  }

  it('surfaces tool_result.content (array-of-text form) as summary on the tool-result event', () => {
    const events = eventsFromFixture('with-tool-use.jsonl');
    const toolResult = events.find((e) => e.type === 'tool-result');
    expect(toolResult).toMatchObject({
      type: 'tool-result',
      callId: 'tu_1',
      ok: true,
      summary: 'file contents',
    });
  });

  it('surfaces tool_result.content (string form) directly as summary', () => {
    const line = JSON.stringify({
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'tu_x', is_error: false, content: 'Launching skill: superpowers:foo' },
        ],
      },
    });
    const events = parseOne(line);
    expect(events[0]).toMatchObject({
      type: 'tool-result',
      callId: 'tu_x',
      ok: true,
      summary: 'Launching skill: superpowers:foo',
    });
  });

  it('joins multi-block array tool_result.content with newlines', () => {
    const line = JSON.stringify({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_multi',
            is_error: false,
            content: [
              { type: 'text', text: 'line one' },
              { type: 'text', text: 'line two' },
            ],
          },
        ],
      },
    });
    const events = parseOne(line);
    expect((events[0] as Extract<AdapterEvent, { type: 'tool-result' }>).summary).toBe('line one\nline two');
  });

  it('omits summary when tool_result.content is missing or empty', () => {
    const lineMissing = JSON.stringify({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'tu_a', is_error: false }],
      },
    });
    const lineEmpty = JSON.stringify({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'tu_b', is_error: false, content: [] }],
      },
    });
    const missing = parseOne(lineMissing)[0] as Extract<AdapterEvent, { type: 'tool-result' }>;
    const empty = parseOne(lineEmpty)[0] as Extract<AdapterEvent, { type: 'tool-result' }>;
    expect(missing.summary).toBeUndefined();
    expect(empty.summary).toBeUndefined();
  });

  it('ignores non-text content blocks (e.g. image) when flattening tool_result.content', () => {
    const line = JSON.stringify({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_mixed',
            is_error: false,
            content: [
              { type: 'text', text: 'visible text' },
              { type: 'image', source: { type: 'base64', data: '...' } },
            ],
          },
        ],
      },
    });
    const events = parseOne(line);
    expect((events[0] as Extract<AdapterEvent, { type: 'tool-result' }>).summary).toBe('visible text');
  });
});

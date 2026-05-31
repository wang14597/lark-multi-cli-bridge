// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCodexJsonLine, parsePlainChunk } from '../../src/adapters/codex.js';
import type { AdapterEvent } from '../../src/adapters/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function eventsFromJsonFixture(name: string): AdapterEvent[] {
  const lines = readFileSync(join(HERE, '__fixtures__/codex', name), 'utf8')
    .split('\n')
    .filter((l) => l.trim());
  const out: AdapterEvent[] = [];
  for (const line of lines) for (const ev of parseCodexJsonLine(line)) out.push(ev);
  return out;
}

describe('CodexAdapter.parseCodexJsonLine', () => {
  it('emits session-start then text-delta then done from JSON fixture', () => {
    const events = eventsFromJsonFixture('json-simple.jsonl');
    expect(events[0]).toMatchObject({ type: 'session-start' });
    expect(events.some((e) => e.type === 'text-delta')).toBe(true);
    expect(events[events.length - 1]?.type).toBe('done');
  });
});

describe('CodexAdapter.parsePlainChunk', () => {
  it('emits text-delta for every non-empty chunk', () => {
    const evs = [...parsePlainChunk('Hello\n')];
    expect(evs).toEqual([{ type: 'text-delta', text: 'Hello\n' }]);
  });
  it('ignores empty chunks', () => {
    expect([...parsePlainChunk('')]).toEqual([]);
  });
});

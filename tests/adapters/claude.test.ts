// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaudeAdapter, parseClaudeLine } from '../../src/adapters/claude.js';
import type { AdapterEvent, RunContext } from '../../src/adapters/types.js';

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

describe('ClaudeAdapter conclusion mode', () => {
  const ECHO_ARGS_SH = join(HERE, '__fixtures__/echo-args.sh');

  type Done = Extract<AdapterEvent, { type: 'done' }>;

  it('structured-output fixture yields done.conclusion from structured_output', () => {
    const done = eventsFromFixture('structured-output.jsonl').find((e) => e.type === 'done') as Done;
    expect(done.conclusion).toMatch(/3 个文件/);
    expect(done.isError).toBeUndefined();
  });

  it('simple-text fixture has no conclusion key', () => {
    const done = eventsFromFixture('simple-text.jsonl').find((e) => e.type === 'done') as Done;
    expect('conclusion' in done).toBe(false);
    expect('isError' in done).toBe(false);
  });

  it('result line with is_error true sets done.isError', () => {
    const line = JSON.stringify({ type: 'result', is_error: true, result: 'boom', session_id: 's' });
    const done = [...parseClaudeLine(line)][0] as Done;
    expect(done.isError).toBe(true);
    expect(done.finalText).toBe('boom');
  });

  it('falls back to errors[] for finalText when an is_error result has no result field', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      session_id: '00000000-0000-0000-0000-000000000000',
      errors: ['No conversation found with session ID: 00000000-0000-0000-0000-000000000000'],
    });
    const done = [...parseClaudeLine(line)][0] as Done;
    expect(done.isError).toBe(true);
    expect(done.finalText).toBe('No conversation found with session ID: 00000000-0000-0000-0000-000000000000');
  });

  it('ignores blank structured_output.conclusion', () => {
    const line = JSON.stringify({ type: 'result', result: '', session_id: 's', structured_output: { conclusion: '  ' } });
    expect('conclusion' in ([...parseClaudeLine(line)][0] as Done)).toBe(false);
  });

  async function runArgs(conclusion: boolean | undefined): Promise<string[]> {
    const tmp = mkdtempSync(join(tmpdir(), 'claude-test-'));
    const outFile = join(tmp, 'args.txt');
    try {
      const ctx: RunContext = {
        prompt: 'hi',
        cwd: tmp,
        signal: new AbortController().signal,
        idleTimeoutMs: 5000,
        env: { ECHO_ARGS_OUT: outFile },
        ...(conclusion !== undefined ? { conclusion } : {}),
      };
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of new ClaudeAdapter({ cliPath: ECHO_ARGS_SH }).run(ctx)) {
        /* drain */
      }
      return readFileSync(outFile, 'utf8').split('\0').slice(0, -1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  it('passes --json-schema only when ctx.conclusion is true', async () => {
    const on = await runArgs(true);
    const i = on.indexOf('--json-schema');
    expect(i).toBeGreaterThan(-1);
    expect(JSON.parse(on[i + 1]!)).toMatchObject({ required: ['conclusion'] });
    expect(await runArgs(false)).not.toContain('--json-schema');
    expect(await runArgs(undefined)).not.toContain('--json-schema');
  });
});

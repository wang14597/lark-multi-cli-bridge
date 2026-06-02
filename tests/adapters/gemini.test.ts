// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GeminiAdapter,
  stripAnsi,
  chunkToEvents,
  parseGeminiJsonLine,
} from '../../src/adapters/gemini.js';
import type { AdapterEvent, RunContext } from '../../src/adapters/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));

describe('GeminiAdapter.stripAnsi', () => {
  it('removes ANSI escape sequences', () => {
    expect(stripAnsi('\x1b[31mhello\x1b[0m world')).toBe('hello world');
  });
});

describe('GeminiAdapter.chunkToEvents (plain fallback)', () => {
  it('emits a text-delta event with the input unchanged when no ANSI', () => {
    const evs = [...chunkToEvents('plain')];
    expect(evs).toEqual([{ type: 'text-delta', text: 'plain' }]);
  });
});

describe('GeminiAdapter.parseGeminiJsonLine', () => {
  function eventsFromFixture(name: string): AdapterEvent[] {
    const lines = readFileSync(
      join(HERE, '__fixtures__/gemini', name),
      'utf8',
    )
      .split('\n')
      .filter((l) => l.trim());
    const out: AdapterEvent[] = [];
    for (const line of lines) for (const ev of parseGeminiJsonLine(line)) out.push(ev);
    return out;
  }

  it('maps init → session-start, assistant message → text-delta, result → done with usage', () => {
    const events = eventsFromFixture('stream-json-simple.jsonl');
    expect(events[0]).toEqual({
      type: 'session-start',
      sessionId: 'fea5b742-eeb8-42a0-9eb9-6408b240f22b',
    });
    const deltas = events.filter((e) => e.type === 'text-delta');
    expect(deltas).toHaveLength(2);
    expect(deltas.map((e) => (e.type === 'text-delta' ? e.text : '')).join('')).toBe(
      '4 5 6 7 8 9',
    );
    const last = events[events.length - 1];
    expect(last?.type).toBe('done');
    if (last?.type === 'done') {
      expect(last.usage).toEqual({ inputTokens: 12826, outputTokens: 51 });
    }
  });

  it('ignores prompt-echo messages (role=user)', () => {
    const evs = [
      ...parseGeminiJsonLine(
        '{"type":"message","role":"user","content":"hello"}',
      ),
    ];
    expect(evs).toEqual([]);
  });

  it('ignores assistant messages with empty content', () => {
    const evs = [
      ...parseGeminiJsonLine(
        '{"type":"message","role":"assistant","content":"","delta":true}',
      ),
    ];
    expect(evs).toEqual([]);
  });

  it('emits an error event when result.status is error', () => {
    const evs = [
      ...parseGeminiJsonLine(
        '{"type":"result","status":"error","error":{"message":"quota exceeded"}}',
      ),
    ];
    expect(evs).toEqual([{ type: 'error', message: 'quota exceeded', recoverable: false }]);
  });

  it('falls back to a generic error message when result.error is missing', () => {
    const evs = [
      ...parseGeminiJsonLine('{"type":"result","status":"error"}'),
    ];
    expect(evs[0]).toMatchObject({ type: 'error', recoverable: false });
  });

  it('returns nothing for malformed JSON lines', () => {
    expect([...parseGeminiJsonLine('not json at all')]).toEqual([]);
  });

  it('returns nothing for unrecognised type (forward compat)', () => {
    expect([...parseGeminiJsonLine('{"type":"some-future-event"}')]).toEqual([]);
  });
});

describe('GeminiAdapter argv shape', () => {
  // echo-args.sh writes argv (NUL-delimited) to ECHO_ARGS_OUT and exits 0.
  // Useful for asserting what the adapter would have launched gemini with,
  // without actually running gemini.
  const ECHO_ARGS_SH = join(HERE, '__fixtures__/echo-args.sh');

  async function runAndCaptureArgs(
    adapter: GeminiAdapter,
    prompt: string,
    sessionId?: string,
  ): Promise<string[]> {
    const tmp = mkdtempSync(join(tmpdir(), 'gemini-test-'));
    const outFile = join(tmp, 'args.txt');
    try {
      const ctx: RunContext = {
        prompt,
        cwd: tmp,
        signal: new AbortController().signal,
        idleTimeoutMs: 5000,
        env: { ECHO_ARGS_OUT: outFile },
        ...(sessionId ? { sessionId } : {}),
      };
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of adapter.run(ctx)) {
        /* drain */
      }
      return readFileSync(outFile, 'utf8').split('\0').slice(0, -1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  it('uses -o stream-json + --skip-trust + --prompt by default', async () => {
    const adapter = new GeminiAdapter({ cliPath: ECHO_ARGS_SH });
    const args = await runAndCaptureArgs(adapter, 'USER-PROMPT');
    expect(args).toContain('-o');
    expect(args[args.indexOf('-o') + 1]).toBe('stream-json');
    expect(args).toContain('--skip-trust');
    const promptIdx = args.indexOf('--prompt');
    expect(promptIdx).toBeGreaterThanOrEqual(0);
    expect(args[promptIdx + 1]).toBe('USER-PROMPT');
  });

  it('prepends appendSystemPrompt with a separator before the user prompt', async () => {
    const adapter = new GeminiAdapter({
      cliPath: ECHO_ARGS_SH,
      appendSystemPrompt: 'SYSTEM-INSTRUCTIONS',
    });
    const args = await runAndCaptureArgs(adapter, 'USER-PROMPT');
    const promptIdx = args.indexOf('--prompt');
    expect(args[promptIdx + 1]).toBe('SYSTEM-INSTRUCTIONS\n\n---\n\nUSER-PROMPT');
  });

  it('omits stream-json when jsonMode=false (plain-text fallback path)', async () => {
    const adapter = new GeminiAdapter({ cliPath: ECHO_ARGS_SH, jsonMode: false });
    const args = await runAndCaptureArgs(adapter, 'USER-PROMPT');
    expect(args).not.toContain('-o');
    expect(args).not.toContain('stream-json');
  });

  it('uses --resume <uuid> when sessionId is a real UUID', async () => {
    const adapter = new GeminiAdapter({ cliPath: ECHO_ARGS_SH });
    const args = await runAndCaptureArgs(
      adapter,
      'P',
      'fea5b742-eeb8-42a0-9eb9-6408b240f22b',
    );
    expect(args).toContain('--resume');
    expect(args[args.indexOf('--resume') + 1]).toBe(
      'fea5b742-eeb8-42a0-9eb9-6408b240f22b',
    );
  });

  it('omits --resume entirely when no sessionId is set', async () => {
    const adapter = new GeminiAdapter({ cliPath: ECHO_ARGS_SH });
    const args = await runAndCaptureArgs(adapter, 'P');
    expect(args).not.toContain('--resume');
    expect(args).not.toContain('--session-id');
  });

  // Pre-0.44 adapter wrote `gemini-${Date.now()}` to SessionStore as a
  // synthetic id. Passing that to --resume would fail; the adapter must
  // detect non-UUID and skip the flag so a fresh session is minted.
  it('skips --resume when sessionId is not a UUID (legacy SessionStore data)', async () => {
    const adapter = new GeminiAdapter({ cliPath: ECHO_ARGS_SH });
    const args = await runAndCaptureArgs(adapter, 'P', 'gemini-1717000000000');
    expect(args).not.toContain('--resume');
  });

  it('never emits --prompt-interactive or -i (yargs collision guard)', async () => {
    const adapter = new GeminiAdapter({ cliPath: ECHO_ARGS_SH });
    const args = await runAndCaptureArgs(adapter, 'P');
    expect(args.some((a) => a.startsWith('--prompt-interactive'))).toBe(false);
    expect(args).not.toContain('-i');
  });
});

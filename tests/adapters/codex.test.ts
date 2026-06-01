// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexAdapter, parseCodexJsonLine, parsePlainChunk } from '../../src/adapters/codex.js';
import type { AdapterEvent, RunContext } from '../../src/adapters/types.js';

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

describe('CodexAdapter appendSystemPrompt', () => {
  // The echo-args.sh fixture writes argv (NUL-delimited) to the file
  // referenced by env var ECHO_ARGS_OUT, then exits 0 with no stdout.
  // We use jsonMode: false so the empty-stdout run terminates cleanly
  // with a `done` event after the stream ends.
  const ECHO_ARGS_SH = join(HERE, '__fixtures__/echo-args.sh');

  async function runAndCaptureArgs(adapter: CodexAdapter, prompt: string): Promise<string[]> {
    const tmp = mkdtempSync(join(tmpdir(), 'codex-test-'));
    const outFile = join(tmp, 'args.txt');
    try {
      const ctx: RunContext = {
        prompt,
        cwd: tmp,
        signal: new AbortController().signal,
        idleTimeoutMs: 5000,
        env: { ECHO_ARGS_OUT: outFile },
      };
      // drain the iterator so run() executes
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of adapter.run(ctx)) {
        /* drain */
      }
      const raw = readFileSync(outFile, 'utf8');
      // NUL-delimited; trailing NUL -> drop the empty last element
      return raw.split('\0').slice(0, -1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  it('prepends opts.appendSystemPrompt to ctx.prompt with separator', async () => {
    const adapter = new CodexAdapter({
      cliPath: ECHO_ARGS_SH,
      appendSystemPrompt: 'SYSTEM-INSTRUCTIONS',
      jsonMode: false,
    });
    const args = await runAndCaptureArgs(adapter, 'USER-PROMPT');
    const finalPrompt = args[args.length - 1];
    expect(finalPrompt).toBe('SYSTEM-INSTRUCTIONS\n\n---\n\nUSER-PROMPT');
  });

  it('passes ctx.prompt unchanged when appendSystemPrompt is undefined', async () => {
    const adapter = new CodexAdapter({
      cliPath: ECHO_ARGS_SH,
      jsonMode: false,
    });
    const args = await runAndCaptureArgs(adapter, 'USER-PROMPT');
    const finalPrompt = args[args.length - 1];
    expect(finalPrompt).toBe('USER-PROMPT');
  });
});

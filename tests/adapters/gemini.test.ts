// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GeminiAdapter, stripAnsi, chunkToEvents } from '../../src/adapters/gemini.js';
import type { RunContext } from '../../src/adapters/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));

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

describe('GeminiAdapter appendSystemPrompt', () => {
  // The echo-args.sh fixture writes argv (NUL-delimited) to the file
  // referenced by env var ECHO_ARGS_OUT, then exits 0 with no stdout.
  // The empty-stdout run terminates cleanly with a `done` event after
  // the stream ends.
  const ECHO_ARGS_SH = join(HERE, '__fixtures__/echo-args.sh');

  async function runAndCaptureArgs(adapter: GeminiAdapter, prompt: string): Promise<string[]> {
    const tmp = mkdtempSync(join(tmpdir(), 'gemini-test-'));
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
    const adapter = new GeminiAdapter({
      cliPath: ECHO_ARGS_SH,
      appendSystemPrompt: 'SYSTEM-INSTRUCTIONS',
    });
    const args = await runAndCaptureArgs(adapter, 'USER-PROMPT');
    const promptIdx = args.indexOf('--prompt');
    expect(promptIdx).toBeGreaterThanOrEqual(0);
    expect(args[promptIdx + 1]).toBe('SYSTEM-INSTRUCTIONS\n\n---\n\nUSER-PROMPT');
  });

  it('passes ctx.prompt unchanged when appendSystemPrompt is undefined', async () => {
    const adapter = new GeminiAdapter({
      cliPath: ECHO_ARGS_SH,
    });
    const args = await runAndCaptureArgs(adapter, 'USER-PROMPT');
    const promptIdx = args.indexOf('--prompt');
    expect(promptIdx).toBeGreaterThanOrEqual(0);
    expect(args[promptIdx + 1]).toBe('USER-PROMPT');
  });

  // gemini CLI 0.42+ rejects `--prompt-interactive=false` (yargs treats it
  // as "set -i to 'false'", which then collides with -p). The adapter must
  // pass only -p / --prompt.
  it('never emits --prompt-interactive (gemini 0.42 yargs collision)', async () => {
    const adapter = new GeminiAdapter({ cliPath: ECHO_ARGS_SH });
    const args = await runAndCaptureArgs(adapter, 'USER-PROMPT');
    expect(args.some((a) => a.startsWith('--prompt-interactive'))).toBe(false);
    expect(args.some((a) => a === '-i')).toBe(false);
  });

  // gemini 0.42 dropped --chat-id; passing it would unknown-flag. Until we
  // wire a real --resume/--session-id adapter, ctx.sessionId must NOT leak
  // into the argv.
  it('does not forward ctx.sessionId to the gemini argv (no --chat-id)', async () => {
    const adapter = new GeminiAdapter({ cliPath: ECHO_ARGS_SH });
    const tmp = mkdtempSync(join(tmpdir(), 'gemini-test-'));
    const outFile = join(tmp, 'args.txt');
    try {
      const ctx: RunContext = {
        prompt: 'USER-PROMPT',
        cwd: tmp,
        signal: new AbortController().signal,
        idleTimeoutMs: 5000,
        env: { ECHO_ARGS_OUT: outFile },
        sessionId: 'should-not-appear-in-argv',
      };
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of adapter.run(ctx)) {
        /* drain */
      }
      const args = readFileSync(outFile, 'utf8').split('\0').slice(0, -1);
      expect(args).not.toContain('--chat-id');
      expect(args).not.toContain('--session-id');
      expect(args.some((a) => a.includes('should-not-appear-in-argv'))).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

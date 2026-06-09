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
  it('emits session-start then text-delta then done from legacy JSON fixture', () => {
    const events = eventsFromJsonFixture('json-simple.jsonl');
    expect(events[0]).toMatchObject({ type: 'session-start' });
    expect(events.some((e) => e.type === 'text-delta')).toBe(true);
    expect(events[events.length - 1]?.type).toBe('done');
  });

  it('emits session-start/text-delta/done from codex 0.130.0 schema', () => {
    const events = eventsFromJsonFixture('json-0130.jsonl');
    // thread.started -> session-start using thread_id
    expect(events[0]).toEqual({
      type: 'session-start',
      sessionId: '019e826f-437c-7a00-a217-abe211f4598b',
    });
    // item.completed with type=agent_message -> text-delta
    expect(events.some((e) => e.type === 'text-delta' && e.text === 'OK')).toBe(true);
    // turn.completed -> done with usage
    const last = events[events.length - 1];
    expect(last?.type).toBe('done');
    if (last?.type === 'done') {
      expect(last.sessionId).toBe('019e826f-437c-7a00-a217-abe211f4598b');
      expect(last.usage).toEqual({ inputTokens: 17176, outputTokens: 174 });
    }
  });

  it('ignores turn.started (no-op event)', () => {
    const evs = [...parseCodexJsonLine('{"type":"turn.started"}')];
    expect(evs).toEqual([]);
  });

  it('ignores item.completed for non-agent_message item types (reasoning, tool_call)', () => {
    const evs = [
      ...parseCodexJsonLine('{"type":"item.completed","item":{"id":"r0","type":"reasoning","text":"thinking..."}}'),
      ...parseCodexJsonLine('{"type":"item.completed","item":{"id":"t0","type":"tool_call","name":"x"}}'),
    ];
    expect(evs).toEqual([]);
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

  async function runAndCaptureArgs(
    adapter: CodexAdapter,
    prompt: string,
    sessionId?: string,
  ): Promise<string[]> {
    const tmp = mkdtempSync(join(tmpdir(), 'codex-test-'));
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

  it('includes --skip-git-repo-check by default', async () => {
    const adapter = new CodexAdapter({ cliPath: ECHO_ARGS_SH, jsonMode: false });
    const args = await runAndCaptureArgs(adapter, 'USER-PROMPT');
    expect(args).toContain('--skip-git-repo-check');
  });

  it('includes --skip-git-repo-check when skipGitRepoCheck is true', async () => {
    const adapter = new CodexAdapter({ cliPath: ECHO_ARGS_SH, jsonMode: false, skipGitRepoCheck: true });
    const args = await runAndCaptureArgs(adapter, 'USER-PROMPT');
    expect(args).toContain('--skip-git-repo-check');
  });

  it('omits --skip-git-repo-check when skipGitRepoCheck is false', async () => {
    const adapter = new CodexAdapter({ cliPath: ECHO_ARGS_SH, jsonMode: false, skipGitRepoCheck: false });
    const args = await runAndCaptureArgs(adapter, 'USER-PROMPT');
    expect(args).not.toContain('--skip-git-repo-check');
  });

  // codex 0.130.0: --session flag was removed; resume is now a subcommand
  // `codex exec resume [SESSION_ID] [PROMPT]`. The bridge's prior `--session`
  // usage now fails with "unexpected argument '--session'".
  describe('resume subcommand (codex 0.130.0+)', () => {
    it('uses `exec resume <id>` and never emits a `--session` flag when sessionId is set', async () => {
      const adapter = new CodexAdapter({ cliPath: ECHO_ARGS_SH, jsonMode: false });
      const args = await runAndCaptureArgs(adapter, 'USER-PROMPT', 'thread-abc-123');
      expect(args).not.toContain('--session');
      expect(args[0]).toBe('exec');
      expect(args[1]).toBe('resume');
      expect(args).toContain('thread-abc-123');
      // sessionId must come before the final prompt
      const idIdx = args.indexOf('thread-abc-123');
      const promptIdx = args.lastIndexOf('USER-PROMPT');
      expect(idIdx).toBeLessThan(promptIdx);
    });

    it('uses plain `exec` (no resume subcommand) when sessionId is absent', async () => {
      const adapter = new CodexAdapter({ cliPath: ECHO_ARGS_SH, jsonMode: false });
      const args = await runAndCaptureArgs(adapter, 'USER-PROMPT');
      expect(args[0]).toBe('exec');
      expect(args).not.toContain('resume');
      expect(args).not.toContain('--session');
    });
  });
});

describe('CodexAdapter sandbox bypass', () => {
  // Mirrors claude's bypassPermissions default: codex exec is wrapped in an
  // OS sandbox by default (no network, workspace-only writes), which blocks
  // lark-cli, git push, etc. The adapter bypasses it by default for parity.
  const ECHO_ARGS_SH = join(HERE, '__fixtures__/echo-args.sh');
  const BYPASS_FLAG = '--dangerously-bypass-approvals-and-sandbox';

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
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of adapter.run(ctx)) {
        /* drain */
      }
      return readFileSync(outFile, 'utf8').split('\0').slice(0, -1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  it('injects the bypass flag by default', async () => {
    const adapter = new CodexAdapter({ cliPath: ECHO_ARGS_SH, jsonMode: false });
    const args = await runAndCaptureArgs(adapter, 'USER-PROMPT');
    expect(args).toContain(BYPASS_FLAG);
  });

  it('injects the bypass flag when bypassSandbox is true', async () => {
    const adapter = new CodexAdapter({ cliPath: ECHO_ARGS_SH, jsonMode: false, bypassSandbox: true });
    const args = await runAndCaptureArgs(adapter, 'USER-PROMPT');
    expect(args).toContain(BYPASS_FLAG);
  });

  it('omits the bypass flag when bypassSandbox is false', async () => {
    const adapter = new CodexAdapter({ cliPath: ECHO_ARGS_SH, jsonMode: false, bypassSandbox: false });
    const args = await runAndCaptureArgs(adapter, 'USER-PROMPT');
    expect(args).not.toContain(BYPASS_FLAG);
  });

  it('does not double-add when extraArgs already carries the bypass flag', async () => {
    const adapter = new CodexAdapter({
      cliPath: ECHO_ARGS_SH,
      jsonMode: false,
      extraArgs: [BYPASS_FLAG],
    });
    const args = await runAndCaptureArgs(adapter, 'USER-PROMPT');
    expect(args.filter((a) => a === BYPASS_FLAG)).toHaveLength(1);
  });

  it('defers to a user-supplied --sandbox flag in extraArgs (no auto bypass)', async () => {
    const adapter = new CodexAdapter({
      cliPath: ECHO_ARGS_SH,
      jsonMode: false,
      extraArgs: ['--sandbox', 'workspace-write'],
    });
    const args = await runAndCaptureArgs(adapter, 'USER-PROMPT');
    expect(args).not.toContain(BYPASS_FLAG);
    expect(args).toContain('--sandbox');
  });
});

describe('CodexAdapter jsonMode stream-end done fallback', () => {
  // echo-args.sh writes argv to a file then exits with no stdout.
  // In jsonMode the parser sees nothing -> historically run() emitted no
  // `done`, leaving the streaming card stuck on "thinking" forever.
  // The fallback must synthesize a `done` when the child exits cleanly
  // but the parser produced none.
  const ECHO_ARGS_SH = join(HERE, '__fixtures__/echo-args.sh');

  it('emits a synthetic done when jsonMode parser yields no done event', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'codex-test-'));
    const outFile = join(tmp, 'args.txt');
    try {
      const adapter = new CodexAdapter({ cliPath: ECHO_ARGS_SH, jsonMode: true });
      const ctx: RunContext = {
        prompt: 'USER-PROMPT',
        cwd: tmp,
        signal: new AbortController().signal,
        idleTimeoutMs: 5000,
        env: { ECHO_ARGS_OUT: outFile },
      };
      const events: AdapterEvent[] = [];
      for await (const ev of adapter.run(ctx)) events.push(ev);
      const doneEvents = events.filter((e) => e.type === 'done');
      expect(doneEvents.length).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

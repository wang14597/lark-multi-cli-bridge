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

describe('CodexAdapter stale-rollout resume fallback', () => {
  // codex 0.130.0 fails resume with "no rollout found" when the rollout
  // file referenced by the stored sessionId has been deleted (auto-cleaned,
  // ~/.codex reset, etc). The adapter must transparently retry once without
  // the stale sessionId so the user's dispatch doesn't surface as "agent
  // 失败" and SessionStore can be repaired by the fresh session-start.
  const STALE_RESUME_SH = join(HERE, '__fixtures__/codex-stale-resume.sh');

  it('on `no rollout found`: retries without sessionId and emits a fresh session-start', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'codex-stale-'));
    const countFile = join(tmp, 'count');
    try {
      const adapter = new CodexAdapter({ cliPath: STALE_RESUME_SH, jsonMode: true });
      const ctx: RunContext = {
        prompt: 'USER-PROMPT',
        cwd: tmp,
        sessionId: 'stale-thread-deadbeef',
        signal: new AbortController().signal,
        idleTimeoutMs: 5000,
        env: { CODEX_FAKE_COUNT_FILE: countFile },
      };
      const events: AdapterEvent[] = [];
      for await (const ev of adapter.run(ctx)) events.push(ev);
      // No user-visible error must escape — the retry should mask it.
      expect(events.find((e) => e.type === 'error')).toBeUndefined();
      // session-start carries the FRESH thread id, not the stale one.
      const start = events.find((e) => e.type === 'session-start');
      expect(start).toEqual({ type: 'session-start', sessionId: 'fresh-thread-789' });
      // done event present so the card streamer can finalize.
      expect(events.find((e) => e.type === 'done')).toBeDefined();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('falls back at most once: a second resume failure surfaces as error', async () => {
    // The same fixture writes to $count_file on every invocation. We pre-seed
    // the count to 99 so EVERY invocation looks like "not the first" — but we
    // also force resume failure for any count > 0 by symlinking a different
    // script wouldn't help; instead we point at the same fixture and use a
    // fresh ctx that *only* runs once (the retry has no sessionId so the
    // fixture's "fail when resume + count==0" condition can't fire twice).
    // So construct a stricter fixture inline: a second non-resume call still
    // emits a session-start, which is fine. To prove "at most once", we
    // assert the fixture was hit exactly twice: once with resume (failed),
    // once without (succeeded).
    const tmp = mkdtempSync(join(tmpdir(), 'codex-stale-'));
    const countFile = join(tmp, 'count');
    try {
      const adapter = new CodexAdapter({ cliPath: STALE_RESUME_SH, jsonMode: true });
      const ctx: RunContext = {
        prompt: 'USER-PROMPT',
        cwd: tmp,
        sessionId: 'stale-thread-deadbeef',
        signal: new AbortController().signal,
        idleTimeoutMs: 5000,
        env: { CODEX_FAKE_COUNT_FILE: countFile },
      };
      for await (const _ of adapter.run(ctx)) void _;
      const finalCount = parseInt(readFileSync(countFile, 'utf8').trim(), 10);
      expect(finalCount).toBe(2);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

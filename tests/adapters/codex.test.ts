// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexAdapter, parseCodexJsonLine, parsePlainChunk } from '../../src/adapters/codex.js';
import { CONCLUSION_SCHEMA } from '../../src/adapters/conclusion.js';
import type { AdapterEvent, RunContext } from '../../src/adapters/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// Fixtures json-tools.jsonl / json-schema.jsonl were recorded with codex-cli
// 0.162.1 (scripts/record-cli-fixture.sh). Observed item types:
//   agent_message     { id, type, text }  (item.completed only)
//   command_execution { id, type, command, aggregated_output, exit_code, status }
//                     (item.started: exit_code null, status in_progress;
//                      item.completed: exit_code 0, status completed)
// json-schema.jsonl adds `--output-schema`: its last agent_message text is
// the JSON string {"conclusion":"…"}. No `reasoning` items were emitted.

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

  it('ignores item.completed for unknown item types', () => {
    const evs = [
      ...parseCodexJsonLine(
        '{"type":"item.completed","item":{"id":"t0","type":"tool_call","name":"x"}}',
      ),
    ];
    expect(evs).toEqual([]);
  });

  it('maps reasoning items to thinking', () => {
    const evs = [
      ...parseCodexJsonLine(
        '{"type":"item.completed","item":{"id":"r0","type":"reasoning","text":"thinking..."}}',
      ),
    ];
    expect(evs).toEqual([{ type: 'thinking', text: 'thinking...' }]);
  });

  it('maps command_execution started/completed to a tool-call/tool-result pair', () => {
    const events = eventsFromJsonFixture('json-tools.jsonl');
    const call = events.find((e) => e.type === 'tool-call');
    const result = events.find((e) => e.type === 'tool-result');
    expect(call).toMatchObject({ type: 'tool-call', callId: 'item_1', name: 'Bash' });
    if (call?.type === 'tool-call') expect(call.input).toMatchObject({ command: '/bin/zsh -c ls' });
    expect(result).toEqual({
      type: 'tool-result',
      callId: 'item_1',
      name: 'Bash',
      ok: true,
      summary: 'a.txt\nb.md\nc.json\nsub\n',
    });
  });

  it('marks a failed command_execution as ok=false', () => {
    const [ev] = [
      ...parseCodexJsonLine(
        '{"type":"item.completed","item":{"id":"x","type":"command_execution","command":"false","aggregated_output":"","exit_code":1,"status":"failed"}}',
      ),
    ];
    expect(ev).toMatchObject({ type: 'tool-result', ok: false });
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

  it('runs shell commands via a non-login shell so the lark-cli shim keeps PATH priority', async () => {
    const adapter = new CodexAdapter({ cliPath: ECHO_ARGS_SH, jsonMode: false });
    const args = await runAndCaptureArgs(adapter, 'USER-PROMPT');
    expect(args).toContain('allow_login_shell=false');
    expect(args[args.indexOf('allow_login_shell=false') - 1]).toBe('-c');
  });

  it('includes --skip-git-repo-check by default', async () => {
    const adapter = new CodexAdapter({ cliPath: ECHO_ARGS_SH, jsonMode: false });
    const args = await runAndCaptureArgs(adapter, 'USER-PROMPT');
    expect(args).toContain('--skip-git-repo-check');
  });

  it('includes --skip-git-repo-check when skipGitRepoCheck is true', async () => {
    const adapter = new CodexAdapter({
      cliPath: ECHO_ARGS_SH,
      jsonMode: false,
      skipGitRepoCheck: true,
    });
    const args = await runAndCaptureArgs(adapter, 'USER-PROMPT');
    expect(args).toContain('--skip-git-repo-check');
  });

  it('omits --skip-git-repo-check when skipGitRepoCheck is false', async () => {
    const adapter = new CodexAdapter({
      cliPath: ECHO_ARGS_SH,
      jsonMode: false,
      skipGitRepoCheck: false,
    });
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
    const adapter = new CodexAdapter({
      cliPath: ECHO_ARGS_SH,
      jsonMode: false,
      bypassSandbox: true,
    });
    const args = await runAndCaptureArgs(adapter, 'USER-PROMPT');
    expect(args).toContain(BYPASS_FLAG);
  });

  it('omits the bypass flag when bypassSandbox is false', async () => {
    const adapter = new CodexAdapter({
      cliPath: ECHO_ARGS_SH,
      jsonMode: false,
      bypassSandbox: false,
    });
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

describe('CodexAdapter run() over recorded item streams', () => {
  const CAT_SH = join(HERE, '__fixtures__/cat-fixture.sh');

  async function runFixture(
    fixture: string,
    extra: Partial<RunContext> = {},
  ): Promise<{ events: AdapterEvent[]; args: string[] }> {
    const tmp = mkdtempSync(join(tmpdir(), 'codex-test-'));
    const outFile = join(tmp, 'args.txt');
    try {
      const adapter = new CodexAdapter({ cliPath: CAT_SH });
      const ctx: RunContext = {
        prompt: 'USER-PROMPT',
        cwd: tmp,
        signal: new AbortController().signal,
        idleTimeoutMs: 5000,
        env: {
          FIXTURE_FILE: isAbsolute(fixture) ? fixture : join(HERE, '__fixtures__/codex', fixture),
          ECHO_ARGS_OUT: outFile,
        },
        ...extra,
      };
      const events: AdapterEvent[] = [];
      for await (const ev of adapter.run(ctx)) events.push(ev);
      return { events, args: readFileSync(outFile, 'utf8').split('\0').slice(0, -1) };
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  const lastDone = (events: AdapterEvent[]) => {
    const d = events[events.length - 1];
    if (d?.type !== 'done') throw new Error('last event is not done');
    return d;
  };

  // Writes a variant of a recorded fixture (whole lines dropped / one field
  // edited) to a temp file and returns its path.
  function derivedFixture(
    tmp: string,
    from: string,
    edit: (o: { item?: { id?: string; type?: string; text?: string } }) => unknown,
  ): string {
    const lines = readFileSync(join(HERE, '__fixtures__/codex', from), 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => edit(JSON.parse(l)))
      .filter((o) => o !== undefined)
      .map((o) => JSON.stringify(o));
    const f = join(tmp, 'derived.jsonl');
    writeFileSync(f, lines.join('\n') + '\n');
    return f;
  }

  it('yields tool events between messages without a paragraph prefix; finalText = last message', async () => {
    const { events } = await runFixture('json-tools.jsonl');
    expect(events.map((e) => e.type)).toEqual([
      'session-start',
      'text-delta',
      'tool-call',
      'tool-result',
      'tool-call',
      'tool-result',
      'text-delta',
      'done',
    ]);
    const deltas = events.flatMap((e) => (e.type === 'text-delta' ? [e.text] : []));
    // a tool block already closes the card's text block, so no prefix here
    expect(deltas[1]).toBe('当前目录有 3 个文件（不含子目录 `sub`）。');
    const done = lastDone(events);
    expect(done.finalText).toBe('当前目录有 3 个文件（不含子目录 `sub`）。');
    expect(done).not.toHaveProperty('conclusion');
  });

  it('separates two consecutive agent messages with a blank line', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'codex-consec-'));
    try {
      const f = derivedFixture(tmp, 'json-tools.jsonl', (o) =>
        o.item?.type === 'command_execution' ? undefined : o,
      );
      const { events } = await runFixture(f);
      const deltas = events.flatMap((e) => (e.type === 'text-delta' ? [e.text] : []));
      expect(deltas.join('')).toBe(
        '我先运行 `ls` 查看当前目录，再统计其中的文件数量。\n\n\n当前目录有 3 个文件（不含子目录 `sub`）。',
      );
      expect(lastDone(events).finalText).toBe('当前目录有 3 个文件（不含子目录 `sub`）。');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('extracts the conclusion from --output-schema JSON when conclusion mode is on', async () => {
    const { events, args } = await runFixture('json-schema.jsonl', { conclusion: true });
    expect(lastDone(events).conclusion).toBe('当前目录有 3 个文件（不含子目录 `sub`）。');
    expect(args).toContain('--output-schema');
    const schemaFile = args[args.indexOf('--output-schema') + 1]!;
    expect(JSON.parse(readFileSync(schemaFile, 'utf8'))).toEqual(CONCLUSION_SCHEMA);
    // flag precedes the positional prompt
    expect(args.indexOf('--output-schema')).toBeLessThan(args.lastIndexOf('USER-PROMPT'));
  });

  it('falls back to the plain last message as conclusion (resumed run answering in prose)', async () => {
    const { events, args } = await runFixture('json-tools.jsonl', {
      conclusion: true,
      sessionId: 'thread-abc',
    });
    expect(lastDone(events).conclusion).toBe('当前目录有 3 个文件（不含子目录 `sub`）。');
    expect(args.slice(0, 2)).toEqual(['exec', 'resume']);
    expect(args.indexOf('--output-schema')).toBeLessThan(args.indexOf('thread-abc'));
  });

  it('omits --output-schema without conclusion mode (fresh and resumed)', async () => {
    expect((await runFixture('json-tools.jsonl')).args).not.toContain('--output-schema');
    expect((await runFixture('json-tools.jsonl', { sessionId: 's1' })).args).not.toContain(
      '--output-schema',
    );
  });

  it('leaves conclusion unset when the last message is truncated JSON', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'codex-trunc-'));
    try {
      // derived from the recorded fixture: last agent_message cut mid-JSON
      const f = derivedFixture(tmp, 'json-schema.jsonl', (o) => {
        if (o.item?.id === 'item_3') o.item.text = '{"conclusion":';
        return o;
      });
      const { events } = await runFixture(f, { conclusion: true });
      const done = lastDone(events);
      expect(done).not.toHaveProperty('conclusion');
      expect(done.finalText).toBe('{"conclusion":');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

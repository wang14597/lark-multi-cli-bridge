// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from 'vitest';
import { Dispatcher } from '../../src/worker/dispatcher.js';
import type { Adapter, AdapterEvent, RunContext } from '../../src/adapters/types.js';

class MockAdapter implements Adapter {
  readonly backend = 'claude' as const;
  constructor(private events: AdapterEvent[]) {}
  async preflight() {
    return { ok: true };
  }
  async *run(_ctx: RunContext) {
    for (const e of this.events) yield e;
  }
}

function fakeStreamer() {
  return {
    start: vi.fn(async () => {}),
    onTextDelta: vi.fn(async () => {}),
    onToolCall: vi.fn(() => {}),
    onToolResult: vi.fn(() => {}),
    onError: vi.fn(async () => {}),
    onDone: vi.fn(async () => {}),
    onInterrupted: vi.fn(async () => {}),
  };
}

describe('Dispatcher (MVP — no preempt)', () => {
  it('drives the streamer through session-start, text-delta, done', async () => {
    const adapter = new MockAdapter([
      { type: 'session-start', sessionId: 'sess_1' },
      { type: 'text-delta', text: 'hi' },
      { type: 'done', sessionId: 'sess_1', finalText: 'hi' },
    ]);
    const streamer = fakeStreamer();
    const onSession = vi.fn();
    const d = new Dispatcher({ adapter, makeStreamer: () => streamer, onSessionUpdate: onSession });

    // enqueue now returns immediately; wait for batch window + run to complete.
    await d.enqueue({
      chatId: 'oc_1',
      prompt: 'say hi',
      cwd: '/tmp',
      idleTimeoutMs: 60_000,
    });
    await new Promise((r) => setTimeout(r, 600));

    expect(streamer.start).toHaveBeenCalledTimes(1);
    expect(streamer.onTextDelta).toHaveBeenCalledWith('hi');
    expect(streamer.onDone).toHaveBeenCalledTimes(1);
    expect(onSession).toHaveBeenCalledWith('oc_1', 'sess_1');
  });

  it('relays tool-result event summary to streamer.onToolResult as output', async () => {
    // Regression for the Skill 无输出 bug — the adapter now puts the real
    // tool output into AdapterEvent.summary; the dispatcher must forward it
    // so the card can render it instead of falling back to "无输出".
    const adapter = new MockAdapter([
      { type: 'session-start', sessionId: 'sess_t' },
      { type: 'tool-call', name: 'Skill', input: { skill: 'foo' }, callId: 'tu_s' },
      { type: 'tool-result', name: '', callId: 'tu_s', ok: true, summary: 'Launching skill: foo' },
      { type: 'done', sessionId: 'sess_t', finalText: '' },
    ]);
    const streamer = fakeStreamer();
    const d = new Dispatcher({ adapter, makeStreamer: () => streamer, onSessionUpdate: () => {} });
    await d.enqueue({ chatId: 'oc_skill', prompt: 'go', cwd: '/tmp', idleTimeoutMs: 60_000 });
    await new Promise((r) => setTimeout(r, 600));
    expect(streamer.onToolResult).toHaveBeenCalledWith('tu_s', true, 'Launching skill: foo');
  });
});

describe('Dispatcher output mode', () => {
  class CtxAdapter extends MockAdapter {
    ctxs: RunContext[] = [];
    override async *run(ctx: RunContext) {
      this.ctxs.push(ctx);
      yield* super.run(ctx);
    }
  }
  const req = (prompt: string) => ({ chatId: 'oc_m', prompt, cwd: '/tmp', idleTimeoutMs: 60_000 });

  it('final mode: sets ctx.conclusion and passes mode to makeStreamer', async () => {
    const adapter = new CtxAdapter([{ type: 'done', sessionId: 's', finalText: 'x' }]);
    const makeStreamer = vi.fn((_c: string, _r?: string, _m?: 'stream' | 'final') => fakeStreamer());
    const d = new Dispatcher({
      adapter,
      makeStreamer,
      onSessionUpdate: () => {},
      resolveOutputMode: () => 'final',
    });
    await d.enqueue(req('a'));
    await new Promise((r) => setTimeout(r, 600));
    expect(adapter.ctxs[0]!.conclusion).toBe(true);
    expect(makeStreamer).toHaveBeenCalledWith('oc_m', undefined, 'final');
  });

  it('default mode: no conclusion in ctx', async () => {
    const adapter = new CtxAdapter([{ type: 'done', sessionId: 's', finalText: 'x' }]);
    const makeStreamer = vi.fn((_c: string, _r?: string, _m?: 'stream' | 'final') => fakeStreamer());
    const d = new Dispatcher({ adapter, makeStreamer, onSessionUpdate: () => {} });
    await d.enqueue(req('a'));
    await new Promise((r) => setTimeout(r, 600));
    expect(adapter.ctxs[0]!.conclusion).toBeUndefined();
    expect(makeStreamer.mock.calls[0]![2]).not.toBe('final');
  });

  it('forwards done conclusion/isError to onDone', async () => {
    const adapter = new CtxAdapter([
      { type: 'done', sessionId: 's', finalText: 'x', conclusion: 'c', isError: true },
    ]);
    const streamer = fakeStreamer();
    const d = new Dispatcher({ adapter, makeStreamer: () => streamer, onSessionUpdate: () => {} });
    await d.enqueue(req('a'));
    await new Promise((r) => setTimeout(r, 600));
    expect(streamer.onDone).toHaveBeenCalledWith(
      expect.objectContaining({ conclusion: 'c', isError: true }),
    );
  });

  it('final mode: stream ending without done/error reports a visible failure', async () => {
    const adapter = new CtxAdapter([{ type: 'text-delta', text: 'partial' }]);
    const streamer = fakeStreamer();
    const d = new Dispatcher({
      adapter,
      makeStreamer: () => streamer,
      onSessionUpdate: () => {},
      resolveOutputMode: () => 'final',
    });
    await d.enqueue(req('a'));
    await new Promise((r) => setTimeout(r, 600));
    expect(streamer.onError).toHaveBeenCalledWith('运行结束但没有返回结果');
  });

  it('stream mode: stream ending without done/error is left alone', async () => {
    const adapter = new CtxAdapter([{ type: 'text-delta', text: 'partial' }]);
    const streamer = fakeStreamer();
    const d = new Dispatcher({ adapter, makeStreamer: () => streamer, onSessionUpdate: () => {} });
    await d.enqueue(req('a'));
    await new Promise((r) => setTimeout(r, 600));
    expect(streamer.onError).not.toHaveBeenCalled();
  });

  it('resolveOutputMode applies to every request on the lane', async () => {
    const adapter = new CtxAdapter([{ type: 'done', sessionId: 's', finalText: 'x' }]);
    const d = new Dispatcher({
      adapter,
      makeStreamer: () => fakeStreamer(),
      onSessionUpdate: () => {},
      batchWindowMs: 10,
      resolveOutputMode: () => 'final',
    });
    await d.enqueue(req('a'));
    await new Promise((r) => setTimeout(r, 100));
    await d.enqueue(req('b'));
    await new Promise((r) => setTimeout(r, 100));
    expect(adapter.ctxs.map((c) => c.conclusion)).toEqual([true, true]);
  });
});

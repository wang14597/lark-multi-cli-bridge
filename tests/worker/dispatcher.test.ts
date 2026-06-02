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

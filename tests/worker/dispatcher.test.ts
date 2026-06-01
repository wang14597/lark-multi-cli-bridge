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

    await d.enqueue({
      chatId: 'oc_1',
      prompt: 'say hi',
      cwd: '/tmp',
      idleTimeoutMs: 60_000,
    });

    expect(streamer.start).toHaveBeenCalledTimes(1);
    expect(streamer.onTextDelta).toHaveBeenCalledWith('hi');
    expect(streamer.onDone).toHaveBeenCalledTimes(1);
    expect(onSession).toHaveBeenCalledWith('oc_1', 'sess_1');
  });
});

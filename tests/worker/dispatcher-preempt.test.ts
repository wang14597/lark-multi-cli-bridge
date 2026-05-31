// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from 'vitest';
import { Dispatcher } from '../../src/worker/dispatcher.js';
import type { Adapter, AdapterEvent, RunContext } from '../../src/adapters/types.js';

class StreamingAdapter implements Adapter {
  readonly backend = 'claude' as const;
  public sawPrompts: string[] = [];
  async preflight() {
    return { ok: true };
  }
  async *run(ctx: RunContext): AsyncIterable<AdapterEvent> {
    this.sawPrompts.push(ctx.prompt);
    for (let i = 0; i < 100; i++) {
      if (ctx.signal.aborted) return;
      yield { type: 'text-delta', text: `${i}` };
      await new Promise((r) => setTimeout(r, 5));
    }
    yield { type: 'done', sessionId: 'sess', finalText: 'final' };
  }
}

function fakeStreamer() {
  return {
    start: vi.fn(async () => {}),
    onTextDelta: vi.fn(async () => {}),
    onToolCall: vi.fn(),
    onToolResult: vi.fn(),
    onError: vi.fn(async () => {}),
    onDone: vi.fn(async () => {}),
  };
}

describe('Dispatcher with preempt + batching', () => {
  it('aborts in-flight run when a new message arrives and batches inside a window', async () => {
    const adapter = new StreamingAdapter();
    const d = new Dispatcher({
      adapter,
      makeStreamer: () => fakeStreamer(),
      onSessionUpdate: () => {},
      batchWindowMs: 50,
    });

    const p1 = d.enqueue({ chatId: 'oc_1', prompt: 'first', cwd: '/tmp', idleTimeoutMs: 60_000 });
    // give the first run time to actually start streaming before preempting
    await new Promise((r) => setTimeout(r, 80));
    const p2 = d.enqueue({ chatId: 'oc_1', prompt: 'second', cwd: '/tmp', idleTimeoutMs: 60_000 });
    const p3 = d.enqueue({ chatId: 'oc_1', prompt: 'third', cwd: '/tmp', idleTimeoutMs: 60_000 });
    await Promise.all([p1, p2, p3]);

    expect(adapter.sawPrompts[0]).toBe('first');
    expect(adapter.sawPrompts[1]).toBe('second\n\nthird');
  });
});

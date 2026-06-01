// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from 'vitest';
import { Dispatcher, UserStopError } from '../../src/worker/dispatcher.js';
import type { Adapter, AdapterEvent, RunContext } from '../../src/adapters/types.js';

class StreamingAdapter implements Adapter {
  readonly backend = 'claude' as const;
  public sawPrompts: string[] = [];
  async preflight() { return { ok: true }; }
  async *run(ctx: RunContext): AsyncIterable<AdapterEvent> {
    this.sawPrompts.push(ctx.prompt);
    for (let i = 0; i < 20; i++) {
      if (ctx.signal.aborted) {
        if (ctx.signal.reason instanceof UserStopError) throw ctx.signal.reason;
        return;
      }
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
    onInterrupted: vi.fn(async () => {}),
  };
}

describe('Dispatcher queue+batch', () => {
  it('does not abort the running run when a new message arrives; queues and batches follow-ups', async () => {
    const adapter = new StreamingAdapter();
    const d = new Dispatcher({
      adapter,
      makeStreamer: () => fakeStreamer(),
      onSessionUpdate: () => {},
      batchWindowMs: 30,
    });

    const p1 = d.enqueue({ chatId: 'oc_1', prompt: 'first', cwd: '/tmp', idleTimeoutMs: 60_000 });
    // Allow first run to start streaming before follow-up messages arrive.
    await new Promise((r) => setTimeout(r, 60));
    await d.enqueue({ chatId: 'oc_1', prompt: 'second', cwd: '/tmp', idleTimeoutMs: 60_000 });
    await d.enqueue({ chatId: 'oc_1', prompt: 'third', cwd: '/tmp', idleTimeoutMs: 60_000 });
    // Wait long enough for both runs to finish (first run: 20 * 5ms = 100ms + batch window 30ms + second run: ~100ms).
    await new Promise((r) => setTimeout(r, 500));
    await p1;

    // First run must have seen 'first' prompt — not aborted by preempt.
    expect(adapter.sawPrompts[0]).toBe('first');
    // second + third coalesced into one follow-up run.
    expect(adapter.sawPrompts[1]).toBe('second\n\nthird');
    // Exactly two runs total.
    expect(adapter.sawPrompts.length).toBe(2);
  });

  it('user stop aborts current run; queue continues after stop', async () => {
    const adapter = new StreamingAdapter();
    const streamers: ReturnType<typeof fakeStreamer>[] = [];
    const d = new Dispatcher({
      adapter,
      makeStreamer: () => {
        const s = fakeStreamer();
        streamers.push(s);
        return s;
      },
      onSessionUpdate: () => {},
      batchWindowMs: 30,
    });

    const p1 = d.enqueue({ chatId: 'oc_2', prompt: 'first', cwd: '/tmp', idleTimeoutMs: 60_000 });
    // Allow first run to start streaming before stopping.
    await new Promise((r) => setTimeout(r, 60));
    expect(d.abort('oc_2')).toBe(true);
    await d.enqueue({ chatId: 'oc_2', prompt: 'second', cwd: '/tmp', idleTimeoutMs: 60_000 });
    // Wait long enough for both runs to finish.
    await new Promise((r) => setTimeout(r, 500));
    await p1;

    // First streamer must have called onInterrupted('user_stop'), not onError.
    const firstStreamer = streamers[0];
    expect(firstStreamer).toBeDefined();
    expect(firstStreamer!.onInterrupted).toHaveBeenCalledWith('user_stop');
    expect(firstStreamer!.onError).not.toHaveBeenCalled();

    // After stop, the queued 'second' message was processed.
    expect(adapter.sawPrompts[0]).toBe('first');
    expect(adapter.sawPrompts[1]).toBe('second');
  });

  it('abort returns false when no run is in flight', () => {
    const adapter = new StreamingAdapter();
    const d = new Dispatcher({
      adapter,
      makeStreamer: () => fakeStreamer(),
      onSessionUpdate: () => {},
      batchWindowMs: 30,
    });

    expect(d.abort('oc_none')).toBe(false);
  });
});

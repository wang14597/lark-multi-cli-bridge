// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from 'vitest';
import { Dispatcher, PreemptError } from '../../src/worker/dispatcher.js';
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

// An adapter that rethrows PreemptError (matching real adapter behavior after fix)
class StreamingAdapterRethrow implements Adapter {
  readonly backend = 'claude' as const;
  public sawPrompts: string[] = [];
  async preflight() {
    return { ok: true };
  }
  async *run(ctx: RunContext): AsyncIterable<AdapterEvent> {
    this.sawPrompts.push(ctx.prompt);
    try {
      for (let i = 0; i < 100; i++) {
        if (ctx.signal.aborted) {
          throw ctx.signal.reason as Error;
        }
        yield { type: 'text-delta', text: `${i}` };
        await new Promise((r) => setTimeout(r, 5));
      }
      yield { type: 'done', sessionId: 'sess', finalText: 'final' };
    } catch (err) {
      if (err instanceof Error && (err.name === 'PreemptError' || err.name === 'UserStopError')) {
        throw err;
      }
      yield { type: 'error', message: (err as Error).message, recoverable: false };
    }
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

  it('preempted first card calls onInterrupted("preempt") not onError', async () => {
    const adapter = new StreamingAdapterRethrow();
    const streamers: ReturnType<typeof fakeStreamer>[] = [];
    const d = new Dispatcher({
      adapter,
      makeStreamer: () => {
        const s = fakeStreamer();
        streamers.push(s);
        return s;
      },
      onSessionUpdate: () => {},
      batchWindowMs: 50,
    });

    const p1 = d.enqueue({ chatId: 'oc_2', prompt: 'first', cwd: '/tmp', idleTimeoutMs: 60_000 });
    // give the first run time to actually start streaming before preempting
    await new Promise((r) => setTimeout(r, 80));
    const p2 = d.enqueue({ chatId: 'oc_2', prompt: 'second', cwd: '/tmp', idleTimeoutMs: 60_000 });
    await Promise.all([p1, p2]);

    // The first streamer must have called onInterrupted('preempt'), not onError
    const firstStreamer = streamers[0];
    expect(firstStreamer).toBeDefined();
    expect(firstStreamer!.onInterrupted).toHaveBeenCalledWith('preempt');
    expect(firstStreamer!.onError).not.toHaveBeenCalled();
  });

  it('PreemptError is exported and has correct name', () => {
    const e = new PreemptError();
    expect(e.name).toBe('PreemptError');
    expect(e.message).toBe('preempted by new message');
  });
});

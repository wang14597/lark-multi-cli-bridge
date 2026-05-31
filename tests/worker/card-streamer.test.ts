// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from 'vitest';
import { CardStreamer } from '../../src/worker/card-streamer.js';

function fakeSink() {
  const sent: Array<{ kind: 'create' | 'patch'; payload: unknown }> = [];
  return {
    sent,
    create: vi.fn(async (card: unknown) => {
      sent.push({ kind: 'create', payload: card });
      return 'card_msg_1';
    }),
    patch: vi.fn(async (cardId: string, card: unknown) => {
      sent.push({ kind: 'patch', payload: { cardId, card } });
    }),
  };
}

describe('CardStreamer', () => {
  it('creates the card on first event and patches after threshold', async () => {
    vi.useFakeTimers();
    const sink = fakeSink();
    const streamer = new CardStreamer({
      header: 'h',
      sink,
      throttleMs: 500,
      throttleChars: 50,
    });

    await streamer.start();
    expect(sink.create).toHaveBeenCalledTimes(1);

    await streamer.onTextDelta('a'.repeat(60));
    await vi.runAllTimersAsync();
    expect(sink.patch).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('finalizes with footer on done', async () => {
    vi.useFakeTimers();
    const sink = fakeSink();
    const streamer = new CardStreamer({ header: 'h', sink, throttleMs: 500, throttleChars: 50 });
    await streamer.start();
    await streamer.onTextDelta('done text');
    await streamer.onDone({ finalText: 'done text', durationMs: 1234 });
    await vi.runAllTimersAsync();
    const last = sink.sent[sink.sent.length - 1];
    expect(last?.kind).toBe('patch');
    expect(JSON.stringify(last?.payload)).toContain('1.2s');
    vi.useRealTimers();
  });
});

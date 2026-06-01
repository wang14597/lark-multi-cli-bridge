// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from 'vitest';
import { Dispatcher } from '../../src/worker/dispatcher.js';
import { parseIngressEvent } from '../../src/lark/message-parse.js';
import type { Adapter, AdapterEvent, RunContext } from '../../src/adapters/types.js';

class FakeAdapter implements Adapter {
  readonly backend = 'claude' as const;
  async preflight() {
    return { ok: true };
  }
  async *run(_ctx: RunContext): AsyncIterable<AdapterEvent> {
    yield { type: 'session-start', sessionId: 's1' };
    yield { type: 'text-delta', text: 'Hello' };
    yield { type: 'done', sessionId: 's1', finalText: 'Hello' };
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

describe('end-to-end single-bot wiring', () => {
  it('parses a Lark event, routes to dispatcher, streamer sees text-delta and done', async () => {
    const raw = {
      event: {
        sender: { sender_id: { open_id: 'ou_u' } },
        message: {
          message_id: 'om_1',
          chat_id: 'oc_1',
          chat_type: 'p2p',
          message_type: 'text',
          create_time: '1700000000000',
          content: JSON.stringify({ text: 'say hi' }),
          mentions: [],
        },
      },
    };
    const msg = parseIngressEvent(raw);
    expect(msg).toBeDefined();
    if (!msg) return;

    const streamer = fakeStreamer();
    const dispatcher = new Dispatcher({
      adapter: new FakeAdapter(),
      makeStreamer: () => streamer,
      onSessionUpdate: () => {},
      batchWindowMs: 10,
    });

    // enqueue now returns immediately; wait for batch window + run to complete.
    await dispatcher.enqueue({
      chatId: msg.chatId,
      prompt: msg.text,
      cwd: '/tmp',
      idleTimeoutMs: 60_000,
    });
    await new Promise((r) => setTimeout(r, 50));

    expect(streamer.start).toHaveBeenCalledTimes(1);
    expect(streamer.onTextDelta).toHaveBeenCalledWith('Hello');
    expect(streamer.onDone).toHaveBeenCalledTimes(1);
  });
});

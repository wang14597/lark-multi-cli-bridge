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

describe('CardStreamer (new RunState-driven)', () => {
  it('emits a create + a patch on text + a final patch on done', async () => {
    vi.useFakeTimers();
    const sink = fakeSink();
    const streamer = new CardStreamer({ sink, throttleMs: 100, throttleChars: 50 });
    await streamer.start();
    await streamer.onTextDelta('hello world');
    await streamer.onDone({ finalText: 'hello world', durationMs: 1234 });
    await vi.runAllTimersAsync();

    expect(sink.create).toHaveBeenCalledTimes(1);
    // at least one patch (final flush)
    expect(sink.patch).toHaveBeenCalled();
    const last = JSON.stringify(sink.sent[sink.sent.length - 1]);
    expect(last).toContain('已完成');
    vi.useRealTimers();
  });

  it('creates the card on start and patches after char threshold', async () => {
    vi.useFakeTimers();
    const sink = fakeSink();
    const streamer = new CardStreamer({ sink, throttleMs: 500, throttleChars: 50 });

    await streamer.start();
    expect(sink.create).toHaveBeenCalledTimes(1);

    await streamer.onTextDelta('a'.repeat(60));
    await vi.runAllTimersAsync();
    expect(sink.patch).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('final patch has no stop button (terminal done)', async () => {
    vi.useFakeTimers();
    const sink = fakeSink();
    const streamer = new CardStreamer({ sink, throttleMs: 500, throttleChars: 50 });
    await streamer.start();
    await streamer.onTextDelta('done text');
    await streamer.onDone({ finalText: 'done text', durationMs: 1234 });
    await vi.runAllTimersAsync();
    const last = sink.sent[sink.sent.length - 1];
    const lastJson = JSON.stringify(last?.payload);
    expect(lastJson).not.toContain('终止');
    expect(lastJson).toContain('已完成');
    vi.useRealTimers();
  });

  it('error state shows agent failed line', async () => {
    vi.useFakeTimers();
    const sink = fakeSink();
    const streamer = new CardStreamer({ sink, throttleMs: 500, throttleChars: 50 });
    await streamer.start();
    await streamer.onError('something went wrong');
    await vi.runAllTimersAsync();
    const last = sink.sent[sink.sent.length - 1];
    const lastJson = JSON.stringify(last?.payload);
    expect(lastJson).toContain('something went wrong');
    expect(lastJson).toContain('出错');
    vi.useRealTimers();
  });

  it('tool call and result appear in card', async () => {
    vi.useFakeTimers();
    const sink = fakeSink();
    const streamer = new CardStreamer({ sink, throttleMs: 500, throttleChars: 50 });
    await streamer.start();
    streamer.onToolCall('c1', 'Read', { file_path: 'foo.ts' });
    streamer.onToolResult('c1', true);
    await vi.runAllTimersAsync();
    const allJson = JSON.stringify(sink.sent);
    expect(allJson).toContain('Read');
    vi.useRealTimers();
  });

  it('done tool renders as a single list line, never falls back to "无输出"', async () => {
    // Regression for the Skill 无输出 bug. Under the list-line UI, a done
    // tool no longer renders its body — but the placeholder must still not
    // appear (it would only ever come from the error / running-last panel
    // paths, which a finalized happy-path tool never hits).
    vi.useFakeTimers();
    const sink = fakeSink();
    const streamer = new CardStreamer({ sink, throttleMs: 500, throttleChars: 50 });
    await streamer.start();
    streamer.onToolCall('cS', 'Skill', { skill: 'superpowers:foo' });
    streamer.onToolResult('cS', true, 'Launching skill: superpowers:foo');
    await streamer.onDone({ finalText: '', durationMs: 0 });
    await vi.runAllTimersAsync();
    const allJson = JSON.stringify(sink.sent);
    expect(allJson).toContain('> ✅ **Skill** — superpowers:foo');
    expect(allJson).not.toContain('无输出');
    vi.useRealTimers();
  });

  it('card while running has streaming_mode true', async () => {
    vi.useFakeTimers();
    const sink = fakeSink();
    const streamer = new CardStreamer({ sink, throttleMs: 500, throttleChars: 50 });
    await streamer.start();
    // The create call itself has streaming_mode true
    const createPayload = JSON.stringify(sink.sent[0]?.payload);
    expect(createPayload).toContain('"streaming_mode":true');
    vi.useRealTimers();
  });

  it('onInterrupted produces a card containing 已被中断', async () => {
    vi.useFakeTimers();
    const sink = fakeSink();
    const streamer = new CardStreamer({ sink, throttleMs: 500, throttleChars: 50 });
    await streamer.start();
    await streamer.onTextDelta('partial text');
    await streamer.onInterrupted('user_stop');
    await vi.runAllTimersAsync();
    const last = sink.sent[sink.sent.length - 1];
    const lastJson = JSON.stringify(last?.payload);
    expect(lastJson).toContain('已被中断');
    expect(lastJson).not.toContain('agent 失败');
    vi.useRealTimers();
  });
});

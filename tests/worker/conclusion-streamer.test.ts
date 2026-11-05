// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from 'vitest';
import { ConclusionStreamer } from '../../src/worker/conclusion-streamer.js';

function setup(opts: { mentionOpenId?: string; reactionId?: string | undefined } = {}) {
  const calls: string[] = [];
  const sink = {
    react: vi.fn(async (_e: string) => {
      calls.push('react');
      return 'reactionId' in opts ? opts.reactionId : 'r_1';
    }),
    unreact: vi.fn(async (_id: string) => {
      calls.push('unreact');
    }),
    sendPost: vi.fn(async (_c: object) => {
      calls.push('send');
    }),
  };
  const log = { warn: vi.fn() };
  const s = new ConclusionStreamer({
    sink,
    log,
    ...(opts.mentionOpenId ? { mentionOpenId: opts.mentionOpenId } : {}),
  });
  return { s, sink, calls, log };
}
const sent = (sink: { sendPost: ReturnType<typeof vi.fn> }, n = 0) =>
  JSON.stringify(sink.sendPost.mock.calls[n]![0]);

describe('ConclusionStreamer', () => {
  it('start adds the OnIt reaction and sends nothing', async () => {
    const { s, sink } = setup();
    await s.start();
    expect(sink.react).toHaveBeenCalledWith('OnIt');
    expect(sink.sendPost).not.toHaveBeenCalled();
  });

  it('done with conclusion: one post reply, then the reaction is removed', async () => {
    const { s, sink, calls } = setup();
    await s.start();
    await s.onDone({ finalText: 'raw', durationMs: 1, conclusion: 'all good' });
    expect(calls).toEqual(['react', 'send', 'unreact']);
    expect(sent(sink)).toContain('all good');
    expect(sink.unreact).toHaveBeenCalledWith('r_1');
  });

  it('empty conclusion and finalText: fallback text', async () => {
    const { s, sink } = setup();
    await s.start();
    await s.onDone({ finalText: '  ', durationMs: 1 });
    expect(sent(sink)).toContain('已完成，但没有返回结论');
  });

  it('finalText that looks like JSON: fallback text', async () => {
    const { s, sink } = setup();
    await s.start();
    await s.onDone({ finalText: '{"conclusion":', durationMs: 1 });
    expect(sent(sink)).toContain('已完成，但没有返回结论');
    expect(sent(sink)).not.toContain('"conclusion\\"');
  });

  it('settles once on done(isError) then error', async () => {
    const { s, sink } = setup();
    await s.start();
    await s.onDone({ finalText: 'boom', durationMs: 1, isError: true });
    await s.onError('exit code 1');
    expect(sink.sendPost).toHaveBeenCalledTimes(1);
    expect(sent(sink)).toContain('⚠️ 没办成：boom');
  });

  it('done(isError) with raw JSON finalText shows 未知错误, not the JSON', async () => {
    const { s, sink } = setup();
    await s.start();
    await s.onDone({ finalText: '{"conclusion":', durationMs: 1, isError: true });
    expect(sent(sink)).toContain('⚠️ 没办成：未知错误');
    expect(sent(sink)).not.toContain('conclusion');
  });

  it('error: failure reply and reaction removed', async () => {
    const { s, sink } = setup();
    await s.start();
    await s.onError('bad');
    expect(sent(sink)).toContain('⚠️ 没办成：bad');
    expect(sink.unreact).toHaveBeenCalledWith('r_1');
  });

  it('interrupted: only removes the reaction; later done ignored', async () => {
    const { s, sink } = setup();
    await s.start();
    await s.onInterrupted('user_stop');
    await s.onDone({ finalText: 'x', durationMs: 1, conclusion: 'late' });
    expect(sink.sendPost).not.toHaveBeenCalled();
    expect(sink.unreact).toHaveBeenCalledTimes(1);
  });

  it('no reaction (card-click run): still replies, never unreacts', async () => {
    const { s, sink } = setup({ reactionId: undefined });
    await s.start();
    await s.onDone({ finalText: '', durationMs: 1, conclusion: 'ok' });
    expect(sink.sendPost).toHaveBeenCalledTimes(1);
    expect(sink.unreact).not.toHaveBeenCalled();
  });

  it('react / send / unreact failures are logged, never thrown', async () => {
    const { s, sink, log } = setup();
    sink.react.mockRejectedValueOnce(new Error('r'));
    await expect(s.start()).resolves.toBeUndefined();
    sink.sendPost.mockRejectedValueOnce(new Error('s'));
    await expect(s.onDone({ finalText: '', durationMs: 1, conclusion: 'x' })).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledTimes(2);
  });

  it('unreact failure after a send is logged, not thrown', async () => {
    const { s, sink, log } = setup();
    await s.start();
    sink.unreact.mockRejectedValueOnce(new Error('u'));
    await expect(s.onDone({ finalText: '', durationMs: 1, conclusion: 'x' })).resolves.toBeUndefined();
    expect(sink.sendPost).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('mentionOpenId puts an at element before the conclusion', async () => {
    const { s, sink } = setup({ mentionOpenId: 'ou_x' });
    await s.start();
    await s.onDone({ finalText: '', durationMs: 1, conclusion: 'hi' });
    expect(sent(sink)).toContain('"tag":"at","user_id":"ou_x"');
  });

  it('text/tool events cause no sink calls', async () => {
    const { s, sink } = setup();
    await s.start();
    await s.onTextDelta('t');
    s.onToolCall('c', 'Bash', {});
    s.onToolResult('c', true, 'o');
    expect(sink.sendPost).not.toHaveBeenCalled();
    expect(sink.unreact).not.toHaveBeenCalled();
  });
});

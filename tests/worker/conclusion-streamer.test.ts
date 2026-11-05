// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from 'vitest';
import { ConclusionStreamer } from '../../src/worker/conclusion-streamer.js';

function setup(mentionOpenId?: string) {
  const calls: string[] = [];
  const sink = {
    create: vi.fn(async (_c: unknown) => {
      calls.push('create');
      return calls.filter((c) => c === 'create').length === 1 ? 'status_1' : 'concl_1';
    }),
    patch: vi.fn(async (_id: string, _c: unknown) => {
      calls.push('patch');
    }),
  };
  const log = { warn: vi.fn() };
  const s = new ConclusionStreamer({ sink, log, ...(mentionOpenId ? { mentionOpenId } : {}) });
  return { s, sink, calls, log };
}
const created = (sink: { create: ReturnType<typeof vi.fn> }, n: number) =>
  JSON.stringify(sink.create.mock.calls[n]![0]);
const patched = (sink: { patch: ReturnType<typeof vi.fn> }, n: number) =>
  JSON.stringify(sink.patch.mock.calls[n]![1]);

describe('ConclusionStreamer', () => {
  it('start sends the pending card', async () => {
    const { s, sink } = setup();
    await s.start();
    expect(created(sink, 0)).toContain('处理中');
    expect(created(sink, 0)).toContain('"cmd":"stop"');
  });

  it('done with conclusion: rewrites the status card in place, no new message', async () => {
    const { s, sink, calls } = setup();
    await s.start();
    await s.onDone({ finalText: 'raw', durationMs: 1, conclusion: 'all good' });
    expect(calls).toEqual(['create', 'patch']);
    expect(sink.patch.mock.calls[0]![0]).toBe('status_1');
    expect(patched(sink, 0)).toContain('all good');
    expect(patched(sink, 0)).not.toContain('"cmd":"stop"');
  });

  it('empty conclusion and finalText: fallback text', async () => {
    const { s, sink } = setup();
    await s.start();
    await s.onDone({ finalText: '  ', durationMs: 1 });
    expect(patched(sink, 0)).toContain('已完成，但没有返回结论');
  });

  it('finalText that looks like JSON: fallback text', async () => {
    const { s, sink } = setup();
    await s.start();
    await s.onDone({ finalText: '{"conclusion":', durationMs: 1 });
    expect(patched(sink, 0)).toContain('已完成，但没有返回结论');
    expect(patched(sink, 0)).not.toContain('"conclusion\\"');
  });

  it('settles once on done(isError) then error', async () => {
    const { s, sink } = setup();
    await s.start();
    await s.onDone({ finalText: 'boom', durationMs: 1, isError: true });
    await s.onError('exit code 1');
    expect(sink.patch).toHaveBeenCalledTimes(1);
    expect(patched(sink, 0)).toContain('⚠️ 没办成：boom');
  });

  it('done(isError) with raw JSON finalText shows 未知错误, not the JSON', async () => {
    const { s, sink } = setup();
    await s.start();
    await s.onDone({ finalText: '{"conclusion":', durationMs: 1, isError: true });
    expect(patched(sink, 0)).toContain('⚠️ 没办成：未知错误');
    expect(patched(sink, 0)).not.toContain('conclusion');
  });

  it('error: failure text in the status card', async () => {
    const { s, sink } = setup();
    await s.start();
    await s.onError('bad');
    expect(patched(sink, 0)).toContain('⚠️ 没办成：bad');
    expect(sink.create).toHaveBeenCalledTimes(1);
  });

  it('interrupted: patch 已停止; later done ignored', async () => {
    const { s, sink } = setup();
    await s.start();
    await s.onInterrupted('user_stop');
    await s.onDone({ finalText: 'x', durationMs: 1, conclusion: 'late' });
    expect(sink.patch).toHaveBeenCalledTimes(1);
    expect(patched(sink, 0)).toContain('已停止');
    expect(sink.create).toHaveBeenCalledTimes(1);
  });

  it('patch failure: conclusion is sent as a new message and logged', async () => {
    const { s, sink, log } = setup();
    await s.start();
    sink.patch.mockRejectedValueOnce(new Error('429'));
    await expect(s.onDone({ finalText: '', durationMs: 1, conclusion: 'done it' })).resolves.toBeUndefined();
    expect(created(sink, 1)).toContain('done it');
    expect(log.warn).toHaveBeenCalled();
  });

  it('patch and fallback create both throwing: onDone still resolves', async () => {
    const { s, sink, log } = setup();
    await s.start();
    sink.patch.mockRejectedValueOnce(new Error('p'));
    sink.create.mockRejectedValueOnce(new Error('c'));
    await expect(s.onDone({ finalText: '', durationMs: 1, conclusion: 'x' })).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledTimes(2);
  });

  it('mentionOpenId prefixes the body with an at tag', async () => {
    const { s, sink } = setup('ou_x');
    await s.start();
    await s.onDone({ finalText: '', durationMs: 1, conclusion: 'hi' });
    expect(patched(sink, 0)).toContain('<at id=ou_x></at> hi');
  });

  it('text/tool events cause no sink calls', async () => {
    const { s, sink } = setup();
    await s.start();
    sink.create.mockClear();
    await s.onTextDelta('t');
    s.onToolCall('c', 'Bash', {});
    s.onToolResult('c', true, 'o');
    expect(sink.create).not.toHaveBeenCalled();
    expect(sink.patch).not.toHaveBeenCalled();
  });
});

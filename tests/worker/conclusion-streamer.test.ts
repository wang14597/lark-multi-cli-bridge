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
    recall: vi.fn(async (_id: string) => {
      calls.push('recall');
    }),
  };
  const log = { warn: vi.fn() };
  const s = new ConclusionStreamer({ sink, log, ...(mentionOpenId ? { mentionOpenId } : {}) });
  return { s, sink, calls, log };
}
const created = (sink: { create: ReturnType<typeof vi.fn> }, n: number) =>
  JSON.stringify(sink.create.mock.calls[n]![0]);

describe('ConclusionStreamer', () => {
  it('start sends the pending card', async () => {
    const { s, sink } = setup();
    await s.start();
    expect(created(sink, 0)).toContain('处理中');
    expect(created(sink, 0)).toContain('"cmd":"stop"');
  });

  it('done with conclusion: create conclusion card then recall status', async () => {
    const { s, sink, calls } = setup();
    await s.start();
    await s.onDone({ finalText: 'raw', durationMs: 1, conclusion: 'all good' });
    expect(calls).toEqual(['create', 'create', 'recall']);
    expect(created(sink, 1)).toContain('all good');
    expect(sink.recall).toHaveBeenCalledWith('status_1');
  });

  it('empty conclusion and finalText: fallback text', async () => {
    const { s, sink } = setup();
    await s.start();
    await s.onDone({ finalText: '  ', durationMs: 1 });
    expect(created(sink, 1)).toContain('已完成，但没有返回结论');
  });

  it('finalText that looks like JSON: fallback text', async () => {
    const { s, sink } = setup();
    await s.start();
    await s.onDone({ finalText: '{"conclusion":""}', durationMs: 1 });
    expect(created(sink, 1)).toContain('已完成，但没有返回结论');
    expect(created(sink, 1)).not.toContain('"conclusion\\"');
  });

  it('settles once on done(isError) then error', async () => {
    const { s, sink } = setup();
    await s.start();
    await s.onDone({ finalText: 'boom', durationMs: 1, isError: true });
    await s.onError('exit 1');
    expect(sink.create).toHaveBeenCalledTimes(2);
    expect(created(sink, 1)).toContain('⚠️ 没办成：boom');
    expect(sink.recall).toHaveBeenCalledTimes(1);
  });

  it('error: failure card + recall', async () => {
    const { s, sink } = setup();
    await s.start();
    await s.onError('bad');
    expect(created(sink, 1)).toContain('⚠️ 没办成：bad');
    expect(sink.recall).toHaveBeenCalledWith('status_1');
  });

  it('interrupted: patch 已停止, no extra create; later done ignored', async () => {
    const { s, sink } = setup();
    await s.start();
    await s.onInterrupted('user_stop');
    await s.onDone({ finalText: 'x', durationMs: 1, conclusion: 'x' });
    expect(sink.create).toHaveBeenCalledTimes(1);
    expect(sink.patch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(sink.patch.mock.calls[0]![1])).toContain('已停止');
    expect(sink.recall).not.toHaveBeenCalled();
  });

  it('recall failure patches the status card to 已完成 and logs', async () => {
    const { s, sink, log } = setup();
    sink.recall.mockRejectedValueOnce(new Error('nope'));
    await s.start();
    await s.onDone({ finalText: '', durationMs: 1, conclusion: 'c' });
    expect(sink.patch).toHaveBeenCalledWith('status_1', expect.anything());
    expect(JSON.stringify(sink.patch.mock.calls[0]![1])).toContain('已完成');
    expect(log.warn).toHaveBeenCalled();
  });

  it('mentionOpenId prefixes the body with an at tag', async () => {
    const { s, sink } = setup('ou_x');
    await s.start();
    await s.onDone({ finalText: '', durationMs: 1, conclusion: 'hi' });
    expect(created(sink, 1)).toContain('<at id=ou_x></at> hi');
  });

  it('text/tool events cause no sink calls', async () => {
    const { s, sink } = setup();
    await s.start();
    sink.create.mockClear();
    await s.onTextDelta('a');
    s.onToolCall('1', 'Bash', {});
    s.onToolResult('1', true, 'ok');
    expect(sink.create).not.toHaveBeenCalled();
    expect(sink.patch).not.toHaveBeenCalled();
    expect(sink.recall).not.toHaveBeenCalled();
  });
});

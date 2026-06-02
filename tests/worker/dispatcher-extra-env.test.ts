// SPDX-License-Identifier: MIT
// Dispatcher.extraEnv is the channel by which worker startup pins lark-cli
// identity into every LLM child. Today it's used to prepend a per-bot PATH
// shim; tomorrow it could carry other static per-worker identity. Tests
// here cover the merge mechanism, not the specific keys.
import { describe, it, expect, vi } from 'vitest';
import { Dispatcher } from '../../src/worker/dispatcher.js';
import type { Adapter, AdapterEvent, RunContext } from '../../src/adapters/types.js';

class EnvCapturingAdapter implements Adapter {
  readonly backend = 'claude' as const;
  capturedEnv: Record<string, string> | undefined;
  constructor(private events: AdapterEvent[]) {}
  async preflight() {
    return { ok: true };
  }
  async *run(ctx: RunContext): AsyncIterable<AdapterEvent> {
    this.capturedEnv = ctx.env;
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

describe('Dispatcher extraEnv', () => {
  it('merges extraEnv into adapter ctx.env on every dispatch', async () => {
    const adapter = new EnvCapturingAdapter([
      { type: 'session-start', sessionId: 's1' },
      { type: 'done', sessionId: 's1', finalText: '' },
    ]);
    const d = new Dispatcher({
      adapter,
      makeStreamer: () => fakeStreamer(),
      onSessionUpdate: vi.fn(),
      extraEnv: { PATH: '/shim/bin:/orig/bin', LMCB_PROFILE: 'codex-bot' },
    });

    await d.enqueue({ chatId: 'oc_1', prompt: 'p', cwd: '/tmp', idleTimeoutMs: 60_000 });
    await new Promise((r) => setTimeout(r, 600));

    expect(adapter.capturedEnv).toBeDefined();
    expect(adapter.capturedEnv?.PATH).toBe('/shim/bin:/orig/bin');
    expect(adapter.capturedEnv?.LMCB_PROFILE).toBe('codex-bot');
  });

  it('lets req.env override extraEnv on a per-request basis', async () => {
    const adapter = new EnvCapturingAdapter([
      { type: 'session-start', sessionId: 's1' },
      { type: 'done', sessionId: 's1', finalText: '' },
    ]);
    const d = new Dispatcher({
      adapter,
      makeStreamer: () => fakeStreamer(),
      onSessionUpdate: vi.fn(),
      extraEnv: { PATH: '/shim/bin', KEEP_ME: 'static' },
    });

    await d.enqueue({
      chatId: 'oc_1',
      prompt: 'p',
      cwd: '/tmp',
      idleTimeoutMs: 60_000,
      env: { PATH: '/per-req/bin', EXTRA: 'dynamic' },
    });
    await new Promise((r) => setTimeout(r, 600));

    expect(adapter.capturedEnv?.PATH).toBe('/per-req/bin'); // request wins
    expect(adapter.capturedEnv?.KEEP_ME).toBe('static');
    expect(adapter.capturedEnv?.EXTRA).toBe('dynamic');
  });

  it('still works when extraEnv is omitted (back-compat)', async () => {
    const adapter = new EnvCapturingAdapter([
      { type: 'session-start', sessionId: 's1' },
      { type: 'done', sessionId: 's1', finalText: '' },
    ]);
    const d = new Dispatcher({
      adapter,
      makeStreamer: () => fakeStreamer(),
      onSessionUpdate: vi.fn(),
    });

    await d.enqueue({ chatId: 'oc_1', prompt: 'p', cwd: '/tmp', idleTimeoutMs: 60_000 });
    await new Promise((r) => setTimeout(r, 600));

    // adapter.env stays undefined when neither extraEnv nor req.env is set
    expect(adapter.capturedEnv).toBeUndefined();
  });
});

// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from 'vitest';
import { Dispatcher } from '../../src/worker/dispatcher.js';
import type { Adapter, RunContext } from '../../src/adapters/types.js';

const streamer = {
  start: vi.fn(async () => {}),
  onTextDelta: vi.fn(async () => {}),
  onToolCall: vi.fn(() => {}),
  onToolResult: vi.fn(() => {}),
  onError: vi.fn(async () => {}),
  onDone: vi.fn(async () => {}),
  onInterrupted: vi.fn(async () => {}),
};

describe('Dispatcher prefixPrompt', () => {
  // The team roster is read from disk, so prefixPrompt must be allowed to be async.
  it('awaits an async prefixPrompt and passes the result to the adapter', async () => {
    const seen: string[] = [];
    const adapter: Adapter = {
      backend: 'claude',
      async preflight() {
        return { ok: true };
      },
      async *run(ctx: RunContext) {
        seen.push(ctx.prompt);
        yield { type: 'done' as const, sessionId: 's', finalText: '' };
      },
    };
    const d = new Dispatcher({
      adapter,
      makeStreamer: () => streamer,
      onSessionUpdate: () => {},
      prefixPrompt: async (_chat, p) => `<team_roster/>\n\n${p}`,
    });
    await d.enqueue({ chatId: 'oc_1', prompt: 'go', cwd: '/tmp', idleTimeoutMs: 60_000 });
    await new Promise((r) => setTimeout(r, 600));
    expect(seen).toEqual(['<team_roster/>\n\ngo']);
  });
});

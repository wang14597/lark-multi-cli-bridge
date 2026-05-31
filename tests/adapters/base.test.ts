// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { spawnWithLifecycle } from '../../src/adapters/base.js';

describe('spawnWithLifecycle', () => {
  it('streams stdout line by line', async () => {
    const ac = new AbortController();
    const lines: string[] = [];
    for await (const line of spawnWithLifecycle('printf', ['a\\nb\\nc\\n'], {
      signal: ac.signal,
      idleTimeoutMs: 5000,
    })) {
      lines.push(line);
    }
    expect(lines).toEqual(['a', 'b', 'c']);
  });

  it('respects AbortSignal to cancel a long-running process', async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(new Error('user cancel')), 50);
    const lines: string[] = [];
    await expect(
      (async () => {
        for await (const line of spawnWithLifecycle('sh', ['-c', 'sleep 5; echo never'], {
          signal: ac.signal,
          idleTimeoutMs: 60_000,
        })) {
          lines.push(line);
        }
      })(),
    ).rejects.toThrow();
    expect(lines).toEqual([]);
  });
});

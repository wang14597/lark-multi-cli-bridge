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

  it('reports a nonexistent cwd distinctly from a missing binary', async () => {
    // Regression test: Node reports spawn-with-bad-cwd as "spawn <cmd> ENOENT",
    // identical to a missing binary. A bot session whose stored cwd had been
    // deleted (or mistyped via /cd) surfaced as "failed to spawn codex:
    // spawn codex ENOENT", sending debugging in the wrong direction. The
    // error must name the real cause: the cwd.
    const ac = new AbortController();
    await expect(
      (async () => {
        for await (const _line of spawnWithLifecycle('echo', ['hi'], {
          signal: ac.signal,
          idleTimeoutMs: 5000,
          cwd: '/definitely/does/not/exist/dir-xyzzy',
        })) {
          void _line;
        }
      })(),
    ).rejects.toThrow(/cwd does not exist: \/definitely\/does\/not\/exist\/dir-xyzzy/);
  });

  it('rejects with a catchable error when the binary does not exist (ENOENT)', async () => {
    // Regression test: previously a missing CLI binary surfaced as an
    // unhandled `'error'` event on the child process, which crashed the
    // entire worker (node:events:486 throw er). The iterator must surface
    // the spawn failure as a thrown error the caller can `try/catch`.
    const ac = new AbortController();
    await expect(
      (async () => {
        for await (const _line of spawnWithLifecycle(
          '/definitely/does/not/exist/binary-xyzzy',
          ['arg1'],
          { signal: ac.signal, idleTimeoutMs: 5000 },
        )) {
          void _line;
        }
      })(),
    ).rejects.toThrow(/ENOENT|spawn/i);
  });
});

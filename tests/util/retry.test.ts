// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from 'vitest';
import { backoffDelays, retry } from '../../src/util/retry.js';

describe('backoffDelays', () => {
  it('produces the documented sequence 1, 2, 5, 15, 30 seconds', () => {
    expect(backoffDelays()).toEqual([1000, 2000, 5000, 15000, 30000]);
  });
});

describe('retry', () => {
  it('returns value on first success without sleeping', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const out = await retry(fn, { delays: [10, 10], onAttempt: () => {} });
    expect(out).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries until exhausted then throws', async () => {
    const err = new Error('boom');
    const fn = vi.fn().mockRejectedValue(err);
    await expect(retry(fn, { delays: [1, 1] })).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

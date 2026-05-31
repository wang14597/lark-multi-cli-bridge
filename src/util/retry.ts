// SPDX-License-Identifier: MIT
export function backoffDelays(): number[] {
  return [1000, 2000, 5000, 15000, 30000];
}

export interface RetryOpts {
  delays: number[];
  onAttempt?: (attempt: number, err: unknown) => void;
}

export async function retry<T>(fn: () => Promise<T>, opts: RetryOpts): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= opts.delays.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      opts.onAttempt?.(attempt, err);
      const delay = opts.delays[attempt];
      if (delay === undefined) break;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

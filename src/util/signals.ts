// SPDX-License-Identifier: MIT
export function combineSignals(signals: Array<AbortSignal | undefined>): AbortSignal {
  const out = new AbortController();
  for (const s of signals) {
    if (!s) continue;
    if (s.aborted) {
      out.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => out.abort(s.reason), { once: true });
  }
  return out.signal;
}

export function timeoutSignal(ms: number): AbortSignal {
  const ac = new AbortController();
  setTimeout(() => ac.abort(new Error(`timeout after ${ms}ms`)), ms).unref();
  return ac.signal;
}

// SPDX-License-Identifier: MIT
import { spawn, type ChildProcess, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { readLines } from '../util/async-iter.js';

export interface SpawnLifecycleOpts extends SpawnOptionsWithoutStdio {
  signal: AbortSignal;
  idleTimeoutMs: number;
}

export async function* spawnWithLifecycle(
  cmd: string,
  args: string[],
  opts: SpawnLifecycleOpts,
): AsyncIterable<string> {
  // Destructure our own fields so they are not forwarded to spawn.
  // Passing `signal` to spawn causes Node to register its own abort listener
  // that emits an unhandled AbortError; we manage abort ourselves below.
  const { signal, idleTimeoutMs, ...spawnOpts } = opts;
  const child: ChildProcess = spawn(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    ...spawnOpts,
  });

  const onAbort = () => {
    if (!child.killed) {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 5000).unref();
    }
  };
  signal.addEventListener('abort', onAbort, { once: true });

  let lastByteAt = Date.now();
  const idleTimer = setInterval(() => {
    if (Date.now() - lastByteAt > idleTimeoutMs) {
      if (!child.killed) child.kill('SIGTERM');
    }
  }, 1000);
  idleTimer.unref();

  let stderrBuf = '';
  child.stderr?.on('data', (b) => {
    stderrBuf += b.toString('utf8');
  });

  const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });

  try {
    if (!child.stdout) throw new Error('child has no stdout');
    for await (const line of readLines(child.stdout)) {
      lastByteAt = Date.now();
      yield line;
    }
    const { code, signal: exitSignal } = await exitPromise;
    if (signal.aborted) {
      throw (signal.reason as Error | undefined) ?? new Error('aborted');
    }
    if (code !== 0 && code !== null) {
      throw new Error(`child exited with code ${code}; stderr: ${stderrBuf.slice(0, 4000)}`);
    }
    if (exitSignal) {
      throw new Error(`child killed by signal ${exitSignal}; stderr: ${stderrBuf.slice(0, 4000)}`);
    }
  } finally {
    clearInterval(idleTimer);
    signal.removeEventListener('abort', onAbort);
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }
}

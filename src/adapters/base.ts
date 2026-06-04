// SPDX-License-Identifier: MIT
import { spawn, type ChildProcess, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { existsSync } from 'node:fs';
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

  // Subscribe to 'error' SYNCHRONOUSLY. Without a listener, a spawn failure
  // (ENOENT when the CLI binary is missing, EACCES, etc.) is delivered as an
  // unhandled 'error' event on the next tick and crashes the entire worker.
  // We stash the error and re-throw at the bottom of the try block so the
  // caller (adapter.run) can `try/catch` and yield {type:'error', ...}.
  // Also destroy stdio so the readLines loop below doesn't hang forever:
  // a failed spawn never emits 'exit', and the dangling pipes would
  // otherwise keep the async iterator alive indefinitely.
  let spawnError: Error | undefined;
  child.once('error', (err: Error) => {
    spawnError = err;
    child.stdout?.destroy();
    child.stderr?.destroy();
  });

  const safeKill = (sig: NodeJS.Signals) => {
    if (child.pid === undefined || child.killed) return;
    try {
      child.kill(sig);
    } catch {
      /* race: process already exited */
    }
  };

  const onAbort = () => {
    safeKill('SIGTERM');
    setTimeout(() => safeKill('SIGKILL'), 5000).unref();
  };
  signal.addEventListener('abort', onAbort, { once: true });

  let lastByteAt = Date.now();
  const idleTimer = setInterval(() => {
    if (Date.now() - lastByteAt > idleTimeoutMs) safeKill('SIGTERM');
  }, 1000);
  idleTimer.unref();

  let stderrBuf = '';
  child.stderr?.on('data', (b) => {
    stderrBuf += b.toString('utf8');
  });

  // Resolve on whichever terminal signal arrives first. On ENOENT/EACCES
  // the child emits 'error' (and never 'exit'), so we also resolve from
  // 'error' to unblock the await below; the actual error is read from
  // `spawnError`. 'close' is a final fallback.
  const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    let settled = false;
    const finish = (code: number | null, sig: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      resolve({ code, signal: sig });
    };
    child.on('exit', (code, sig) => finish(code, sig));
    child.on('close', () => finish(null, null));
    child.on('error', () => finish(null, null));
  });

  try {
    if (!child.stdout) throw new Error('child has no stdout');
    try {
      for await (const line of readLines(child.stdout)) {
        lastByteAt = Date.now();
        yield line;
      }
    } catch (e) {
      // When our error handler destroys stdout in response to a spawn
      // failure, readLines surfaces a "Premature close" error. Suppress it
      // so the spawnError check below reports the real cause; otherwise
      // re-throw.
      if (!spawnError) throw e;
    }
    const { code, signal: exitSignal } = await exitPromise;
    // ENOENT/EACCES paths land here with code=null after the 'error' event
    // fires; surface that first so the caller sees the real cause.
    if (spawnError) {
      // Node reports a nonexistent cwd as "spawn <cmd> ENOENT" — identical
      // to a missing binary. Disambiguate so a stale session cwd (deleted
      // dir, mistyped /cd) doesn't masquerade as a missing CLI. Phrasing is
      // kept in lock-step with validateCwd ("directory does not exist: …").
      const cwd = spawnOpts.cwd;
      if (cwd !== undefined && !existsSync(cwd)) {
        throw new Error(`directory does not exist: ${String(cwd)} (failed to spawn ${cmd})`);
      }
      throw new Error(`failed to spawn ${cmd}: ${spawnError.message}`);
    }
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
    safeKill('SIGTERM');
  }
}

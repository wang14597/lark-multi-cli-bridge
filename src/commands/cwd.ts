// SPDX-License-Identifier: MIT
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

/** Expand `~` / `~/x` and resolve to an absolute path. */
export function resolveCwd(value: string): string {
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return resolve(homedir(), value.slice(2));
  return resolve(value);
}

/**
 * Validate that a user-supplied cwd is an existing directory. Returns an
 * error message to send back to the chat, or undefined when valid.
 *
 * Bad paths must be rejected at command time: once a nonexistent cwd is
 * stored in the session, the next agent run fails with a misleading
 * "spawn <cli> ENOENT" (Node reports a missing cwd identically to a
 * missing binary).
 */
export async function validateCwd(cwd: string): Promise<string | undefined> {
  try {
    const s = await stat(cwd);
    return s.isDirectory() ? undefined : `not a directory: ${cwd}`;
  } catch (err) {
    // ENOENT (path absent) and ENOTDIR (a parent component isn't a
    // directory) genuinely mean "not there". Anything else — most commonly
    // EACCES when a parent lacks the execute bit — means the path may well
    // exist but we can't see it; reporting "does not exist" would repeat the
    // very misdirection this validation exists to prevent, so surface the code.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return `directory does not exist: ${cwd}`;
    }
    return `cannot access directory: ${cwd} (${code ?? 'unknown error'})`;
  }
}

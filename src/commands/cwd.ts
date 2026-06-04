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
  } catch {
    return `directory does not exist: ${cwd}`;
  }
}

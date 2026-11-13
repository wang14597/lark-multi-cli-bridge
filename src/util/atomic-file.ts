// SPDX-License-Identifier: MIT
import { mkdir, rename, writeFile, readFile, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function writeJsonAtomic<T>(path: string, value: T, mode: number = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  // pid+time alone collides when two writes land in the same millisecond: the
  // second rename then fails with ENOENT (this crashed a worker mid-run).
  const tmp = `${path}.tmp.${process.pid}.${randomUUID()}`;
  await writeFile(tmp, JSON.stringify(value, null, 2), { mode });
  await rename(tmp, path);
  await chmod(path, mode);
}

export async function readJsonOrDefault<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// SPDX-License-Identifier: MIT
import { mkdir, rename, writeFile, readFile, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function writeJsonAtomic<T>(path: string, value: T, mode: number = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
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

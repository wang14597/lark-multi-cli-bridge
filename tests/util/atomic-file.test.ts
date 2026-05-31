// SPDX-License-Identifier: MIT
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeJsonAtomic, readJsonOrDefault } from '../../src/util/atomic-file.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lmcb-atomic-'));
});

describe('atomic-file', () => {
  it('writes JSON and reads it back', async () => {
    const target = join(dir, 'state.json');
    await writeJsonAtomic(target, { hello: 'world' });
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ hello: 'world' });
  });

  it('readJsonOrDefault returns default if file does not exist', async () => {
    const target = join(dir, 'missing.json');
    expect(await readJsonOrDefault(target, { a: 1 })).toEqual({ a: 1 });
  });

  it('readJsonOrDefault returns default if file is corrupt', async () => {
    const target = join(dir, 'bad.json');
    await writeJsonAtomic(target, { ok: true });
    const corrupted = join(dir, 'bad.json');
    writeFileSync(corrupted, '{ not json');
    expect(await readJsonOrDefault(corrupted, { fallback: true })).toEqual({ fallback: true });
  });

  it('does not leave a partial file if write is interrupted', async () => {
    const target = join(dir, 'safe.json');
    await writeJsonAtomic(target, { a: 1 });
    await writeJsonAtomic(target, { a: 2 });
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ a: 2 });
    expect(existsSync(`${target}.tmp`)).toBe(false);
  });
});

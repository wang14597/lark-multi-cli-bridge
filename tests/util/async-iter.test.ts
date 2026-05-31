// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { readLines } from '../../src/util/async-iter.js';

describe('readLines', () => {
  it('emits each newline-terminated line', async () => {
    const stream = Readable.from(['a\nb\n', 'c\nd', '\n']);
    const out: string[] = [];
    for await (const line of readLines(stream)) out.push(line);
    expect(out).toEqual(['a', 'b', 'c', 'd']);
  });

  it('does not emit a trailing partial line without newline', async () => {
    const stream = Readable.from(['only-partial']);
    const out: string[] = [];
    for await (const line of readLines(stream)) out.push(line);
    expect(out).toEqual([]);
  });
});

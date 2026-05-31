// SPDX-License-Identifier: MIT
import type { Readable } from 'node:stream';

export async function* readLines(stream: Readable): AsyncIterable<string> {
  let buf = '';
  for await (const chunk of stream) {
    buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      yield buf.slice(0, idx);
      buf = buf.slice(idx + 1);
    }
  }
}

export class Deferred<T> {
  promise: Promise<T>;
  resolve!: (v: T) => void;
  reject!: (e: unknown) => void;
  constructor() {
    this.promise = new Promise<T>((res, rej) => {
      this.resolve = res;
      this.reject = rej;
    });
  }
}

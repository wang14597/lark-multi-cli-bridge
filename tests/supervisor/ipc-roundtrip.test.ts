// SPDX-License-Identifier: MIT
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IpcServer } from '../../src/supervisor/ipc-server.js';
import { IpcClient } from '../../src/supervisor/ipc-client.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lmcb-ipc-'));
});

describe('IPC round-trip', () => {
  it('ping returns pong', async () => {
    const sock = join(dir, 'a.sock');
    const server = new IpcServer(sock, {
      ping: async () => ({ pong: true }),
    });
    await server.start();
    const client = new IpcClient(sock);
    const res = await client.call('ping');
    expect(res).toEqual({ pong: true });
    await server.stop();
  });

  it('returns error payload on method exception', async () => {
    const sock = join(dir, 'b.sock');
    const server = new IpcServer(sock, {
      boom: async () => {
        throw new Error('nope');
      },
    });
    await server.start();
    const client = new IpcClient(sock);
    await expect(client.call('boom')).rejects.toThrow('nope');
    await server.stop();
  });
});

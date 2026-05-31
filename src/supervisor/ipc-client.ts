// SPDX-License-Identifier: MIT
import { connect, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { RpcResponseSchema, type RpcResponse } from './ipc-protocol.js';

export class IpcClient {
  constructor(private socketPath: string) {}

  async call(method: string, params?: unknown, timeoutMs: number = 5000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const sock: Socket = connect(this.socketPath);
      let buf = '';
      const timer = setTimeout(() => {
        sock.destroy();
        reject(new Error(`ipc timeout: ${method}`));
      }, timeoutMs);
      sock.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      sock.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (!line.trim()) continue;
          let resp: RpcResponse;
          try {
            resp = RpcResponseSchema.parse(JSON.parse(line));
          } catch (err) {
            clearTimeout(timer);
            sock.destroy();
            reject(err);
            return;
          }
          if (resp.id !== id) continue;
          clearTimeout(timer);
          sock.end();
          if (resp.ok) resolve(resp.result);
          else reject(new Error(resp.error ?? 'unknown ipc error'));
        }
      });
      const payload = JSON.stringify({ id, method, params });
      sock.write(payload + '\n');
    });
  }
}

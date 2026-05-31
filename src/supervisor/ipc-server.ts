// SPDX-License-Identifier: MIT
import { createServer, type Server, type Socket } from 'node:net';
import { unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { RpcRequestSchema, type RpcResponse } from './ipc-protocol.js';

export type IpcHandler = (params: unknown) => Promise<unknown>;
export type IpcHandlers = Record<string, IpcHandler>;

export class IpcServer {
  private server?: Server;
  constructor(private socketPath: string, private handlers: IpcHandlers) {}

  async start(): Promise<void> {
    if (existsSync(this.socketPath)) await unlink(this.socketPath);
    this.server = createServer((sock) => this.onConn(sock));
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.socketPath, () => resolve());
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    delete this.server;
    if (existsSync(this.socketPath)) await unlink(this.socketPath).catch(() => {});
  }

  private onConn(sock: Socket): void {
    let buf = '';
    sock.on('data', async (chunk) => {
      buf += chunk.toString('utf8');
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        await this.handleLine(line, sock);
      }
    });
  }

  private async handleLine(line: string, sock: Socket): Promise<void> {
    let req;
    try {
      req = RpcRequestSchema.parse(JSON.parse(line));
    } catch (err) {
      const resp: RpcResponse = { id: '0', ok: false, error: `bad request: ${(err as Error).message}` };
      sock.write(JSON.stringify(resp) + '\n');
      return;
    }
    const handler = this.handlers[req.method];
    if (!handler) {
      const resp: RpcResponse = { id: req.id, ok: false, error: `no such method: ${req.method}` };
      sock.write(JSON.stringify(resp) + '\n');
      return;
    }
    try {
      const result = await handler(req.params);
      const resp: RpcResponse = { id: req.id, ok: true, result };
      sock.write(JSON.stringify(resp) + '\n');
    } catch (err) {
      const resp: RpcResponse = { id: req.id, ok: false, error: (err as Error).message };
      sock.write(JSON.stringify(resp) + '\n');
    }
  }
}

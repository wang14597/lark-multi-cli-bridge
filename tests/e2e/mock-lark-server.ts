// SPDX-License-Identifier: MIT
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';

/**
 * Minimal stand-in for Lark's WS protocol. Reserved for future expansion;
 * the current single-bot wiring test exercises parser → dispatcher → streamer
 * directly without an actual WS handshake.
 */
export class MockLarkServer {
  private wss: WebSocketServer | undefined;
  public messageCreate: unknown[] = [];
  public messagePatch: unknown[] = [];

  async listen(port: number): Promise<void> {
    this.wss = new WebSocketServer({ port });
  }

  async send(_clientPredicate: (ws: WebSocket) => boolean, _payload: unknown): Promise<void> {
    // intentional no-op for now
  }

  async close(): Promise<void> {
    const w = this.wss;
    if (!w) return;
    await new Promise<void>((r) => w.close(() => r()));
  }
}

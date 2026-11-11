// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import type WsWebSocket from 'ws';
import { isAbortedHandshakeError } from '../../src/lark/ws.js';

// Resolve the same `ws` the Lark SDK uses, so a wording change there fails this test.
const require = createRequire(import.meta.url);
const WebSocket = require(
  require.resolve('ws', { paths: [require.resolve('@larksuiteoapi/node-sdk')] }),
) as typeof WsWebSocket;

describe('isAbortedHandshakeError', () => {
  it('matches the error ws emits when a socket is terminated mid-handshake (what the SDK does on timeout)', async () => {
    const ws = new WebSocket('wss://10.255.255.1:443'); // unroutable: stays in CONNECTING
    const err = await new Promise<unknown>((resolve) => {
      ws.on('error', resolve);
      setTimeout(() => ws.terminate(), 50);
    });
    expect(isAbortedHandshakeError(err)).toBe(true);
  });

  it('does not match other errors', () => {
    expect(isAbortedHandshakeError(new Error('boom'))).toBe(false);
    expect(isAbortedHandshakeError('WebSocket was closed before the connection was established')).toBe(false);
  });
});

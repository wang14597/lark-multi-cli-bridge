// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { RpcRequestSchema, RpcResponseSchema } from '../../src/supervisor/ipc-protocol.js';

describe('ipc protocol', () => {
  it('parses request and response shapes', () => {
    expect(RpcRequestSchema.parse({ id: '1', method: 'ping' })).toEqual({ id: '1', method: 'ping' });
    expect(RpcResponseSchema.parse({ id: '1', ok: true, result: { v: 1 } })).toEqual({
      id: '1',
      ok: true,
      result: { v: 1 },
    });
  });
});

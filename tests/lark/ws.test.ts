// SPDX-License-Identifier: MIT
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SdkLogger } from '../../src/lark/sdk-logger.js';

// Capture WSClient constructor params. vi.mock factories are hoisted above
// imports, so the shared state must come from vi.hoisted.
const captured = vi.hoisted(() => ({ wsCtorParams: [] as unknown[] }));

vi.mock('@larksuiteoapi/node-sdk', () => {
  class FakeWSClient {
    constructor(params: unknown) {
      captured.wsCtorParams.push(params);
    }
    start(): void {}
    close(): void {}
  }
  class FakeEventDispatcher {
    register(): this {
      return this;
    }
  }
  return {
    WSClient: FakeWSClient,
    EventDispatcher: FakeEventDispatcher,
    Domain: { Feishu: 'domain-feishu', Lark: 'domain-lark' },
    LoggerLevel: { warn: 3 },
  };
});

import { LarkWsClient } from '../../src/lark/ws.js';

interface WsCtorParams {
  appId?: string;
  appSecret?: string;
  wsConfig?: { pingTimeout?: number };
  handshakeTimeoutMs?: number;
  onReconnecting?: () => void;
  onReconnected?: () => void;
}

function makeLogger(): SdkLogger & { warnCalls: unknown[][] } {
  const warnCalls: unknown[][] = [];
  return {
    error: vi.fn(),
    warn: (...msg: unknown[]) => {
      warnCalls.push(msg);
    },
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    warnCalls,
  };
}

async function startClient(logger?: SdkLogger): Promise<WsCtorParams> {
  const client = new LarkWsClient({
    appId: 'cli_test_app',
    appSecret: 'secret',
    domain: 'lark',
    ...(logger ? { logger } : {}),
  });
  await client.start();
  expect(captured.wsCtorParams).toHaveLength(1);
  return captured.wsCtorParams[0] as WsCtorParams;
}

describe('LarkWsClient liveness watchdog config', () => {
  beforeEach(() => {
    captured.wsCtorParams.length = 0;
  });

  it('passes wsConfig.pingTimeout so the SDK pong watchdog is armed', async () => {
    // Without pingTimeout the SDK's armLiveness() is a no-op: a half-open
    // connection is never detected, the app goes "offline" on Lark's side,
    // and card button clicks fail with "目标回调服务当前未在线".
    const params = await startClient();
    expect(params.wsConfig?.pingTimeout).toBe(3);
  });

  it('passes handshakeTimeoutMs for fast-fail reconnects', async () => {
    const params = await startClient();
    expect(params.handshakeTimeoutMs).toBe(8000);
  });

  it('wires onReconnecting/onReconnected to warn-level logs', async () => {
    const logger = makeLogger();
    const params = await startClient(logger);

    expect(typeof params.onReconnecting).toBe('function');
    expect(typeof params.onReconnected).toBe('function');

    params.onReconnecting?.();
    params.onReconnected?.();

    const lines = logger.warnCalls.map((c) => c.join(' '));
    expect(lines.some((l) => l.includes('reconnecting'))).toBe(true);
    expect(lines.some((l) => l.includes('reconnected'))).toBe(true);
  });

  it('reconnect hooks do not throw when no logger is provided', async () => {
    const params = await startClient();
    expect(() => {
      params.onReconnecting?.();
      params.onReconnected?.();
    }).not.toThrow();
  });
});

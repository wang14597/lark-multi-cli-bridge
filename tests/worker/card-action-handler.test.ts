// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from 'vitest';
import pino from 'pino';
import { makeCardActionHandler } from '../../src/worker/card-action-handler.js';
import type { CardActionEvent } from '../../src/lark/card-action.js';
import type { IngressMessage } from '../../src/lark/types.js';
import type { AccessConfig } from '../../src/config/schema.js';

const silentLog = pino({ level: 'silent' });

function makeAccess(overrides: Partial<AccessConfig> = {}): AccessConfig {
  return { allowed_users: ['ou_alice'], allowed_chats: [], admins: [], ...overrides };
}

describe('makeCardActionHandler — __claude_cb branch', () => {
  it('enqueues a [card-click] message when value.__claude_cb is true', async () => {
    const enqueue = vi.fn(async (_req: any) => {});
    const abort = vi.fn(() => false);
    const lastIngressByChat = new Map<string, IngressMessage>();
    lastIngressByChat.set('oc_chat', {
      chatId: 'oc_chat',
      chatType: 'p2p',
      senderOpenId: 'ou_alice',
      messageId: 'om_prev',
      text: 'irrelevant',
      mentions: [],
      rawType: 'text',
      attachments: [],
      receivedAt: '2026-06-01T00:00:00Z',
    });

    const handler = makeCardActionHandler({
      access: makeAccess(),
      dispatcher: { enqueue, abort } as any,
      log: silentLog,
      lastIngressByChat,
      botDefaultCwd: '/tmp',
      botBackendType: 'claude',
      idleTimeoutMs: 600_000,
      sessions: { get: () => undefined } as any,
    });

    const evt: CardActionEvent = {
      chatId: 'oc_chat',
      messageId: 'om_card',
      operatorOpenId: 'ou_alice',
      value: { __claude_cb: true, choice: 'a' },
      receivedAt: '2026-06-01T00:00:01Z',
    };
    await handler(evt);

    expect(abort).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledTimes(1);
    const call = enqueue.mock.calls[0]![0];
    expect(call.chatId).toBe('oc_chat');
    expect(call.prompt).toBe('[card-click] {"choice":"a"}');
  });

  it('drops the __claude_cb marker key from the synth prompt', async () => {
    const enqueue = vi.fn(async (_req: any) => {});
    const handler = makeCardActionHandler({
      access: makeAccess(),
      dispatcher: { enqueue, abort: vi.fn() } as any,
      log: silentLog,
      lastIngressByChat: new Map(),
      botDefaultCwd: '/tmp',
      botBackendType: 'claude',
      idleTimeoutMs: 600_000,
      sessions: { get: () => undefined } as any,
    });

    await handler({
      chatId: 'oc_chat',
      messageId: 'om_card',
      operatorOpenId: 'ou_alice',
      value: { __claude_cb: true, x: 1, y: 'z' },
      receivedAt: '2026-06-01T00:00:01Z',
    });

    const prompt = (enqueue.mock.calls[0]![0] as any).prompt;
    expect(prompt).toBe('[card-click] {"x":1,"y":"z"}');
    expect(prompt).not.toContain('__claude_cb');
  });

  it('still calls dispatcher.abort for value.cmd === "stop"', async () => {
    const enqueue = vi.fn(async (_req: any) => {});
    const abort = vi.fn(() => true);
    const handler = makeCardActionHandler({
      access: makeAccess(),
      dispatcher: { enqueue, abort } as any,
      log: silentLog,
      lastIngressByChat: new Map(),
      botDefaultCwd: '/tmp',
      botBackendType: 'claude',
      idleTimeoutMs: 600_000,
      sessions: { get: () => undefined } as any,
    });

    await handler({
      chatId: 'oc_chat',
      messageId: 'om_card',
      operatorOpenId: 'ou_alice',
      cmd: 'stop',
      value: { cmd: 'stop' },
      receivedAt: '2026-06-01T00:00:01Z',
    });

    expect(abort).toHaveBeenCalledWith('oc_chat');
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('drops events from unauthorized users', async () => {
    const enqueue = vi.fn(async (_req: any) => {});
    const abort = vi.fn();
    const handler = makeCardActionHandler({
      access: makeAccess({ allowed_users: ['ou_other'] }),
      dispatcher: { enqueue, abort } as any,
      log: silentLog,
      lastIngressByChat: new Map(),
      botDefaultCwd: '/tmp',
      botBackendType: 'claude',
      idleTimeoutMs: 600_000,
      sessions: { get: () => undefined } as any,
    });

    await handler({
      chatId: 'oc_chat',
      messageId: 'om_card',
      operatorOpenId: 'ou_alice',
      value: { __claude_cb: true },
      receivedAt: '2026-06-01T00:00:01Z',
    });

    expect(enqueue).not.toHaveBeenCalled();
    expect(abort).not.toHaveBeenCalled();
  });

  it('prefers __claude_cb over cmd when both are present', async () => {
    // If the LLM emits a button with both markers, the LLM wins.
    const enqueue = vi.fn(async (_req: any) => {});
    const abort = vi.fn();
    const handler = makeCardActionHandler({
      access: makeAccess(),
      dispatcher: { enqueue, abort } as any,
      log: silentLog,
      lastIngressByChat: new Map(),
      botDefaultCwd: '/tmp',
      botBackendType: 'claude',
      idleTimeoutMs: 600_000,
      sessions: { get: () => undefined } as any,
    });

    await handler({
      chatId: 'oc_chat',
      messageId: 'om_card',
      operatorOpenId: 'ou_alice',
      cmd: 'stop',
      value: { __claude_cb: true, cmd: 'stop' },
      receivedAt: '2026-06-01T00:00:01Z',
    });

    expect(abort).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});

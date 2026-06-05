// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from 'vitest';
import pino from 'pino';
import { makeCardActionHandler, cmdToCommand } from '../../src/worker/card-action-handler.js';
import type { CardActionEvent } from '../../src/lark/card-action.js';
import type { DispatchRequest } from '../../src/worker/dispatcher.js';
import type { IngressMessage } from '../../src/lark/types.js';
import type { AccessConfig } from '../../src/config/schema.js';

const silentLog = pino({ level: 'silent' });

function makeAccess(overrides: Partial<AccessConfig> = {}): AccessConfig {
  return { allowed_users: ['ou_alice'], allowed_chats: [], admins: [], ...overrides };
}

function makeMocks(abortResult = false) {
  const enqueue = vi.fn(async (_req: DispatchRequest) => {});
  const abort = vi.fn((_chatId: string) => abortResult);
  return { enqueue, abort };
}

describe('makeCardActionHandler — __claude_cb branch', () => {
  it('enqueues a [card-click] message when value.__claude_cb is true', async () => {
    const { enqueue, abort } = makeMocks();
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
      dispatcher: { enqueue, abort },
      log: silentLog,
      lastIngressByChat,
      botDefaultCwd: '/tmp',
      botBackendType: 'claude',
      botName: 'claude-bot',
      idleTimeoutMs: 600_000,
      sessions: { get: () => undefined },
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
    const { enqueue, abort } = makeMocks();
    const handler = makeCardActionHandler({
      access: makeAccess(),
      dispatcher: { enqueue, abort },
      log: silentLog,
      lastIngressByChat: new Map(),
      botDefaultCwd: '/tmp',
      botBackendType: 'claude',
      botName: 'claude-bot',
      idleTimeoutMs: 600_000,
      sessions: { get: () => undefined },
    });

    await handler({
      chatId: 'oc_chat',
      messageId: 'om_card',
      operatorOpenId: 'ou_alice',
      value: { __claude_cb: true, x: 1, y: 'z' },
      receivedAt: '2026-06-01T00:00:01Z',
    });

    const prompt = enqueue.mock.calls[0]![0].prompt;
    expect(prompt).toBe('[card-click] {"x":1,"y":"z"}');
    expect(prompt).not.toContain('__claude_cb');
  });

  it('still calls dispatcher.abort for value.cmd === "stop"', async () => {
    const { enqueue, abort } = makeMocks(true);
    const handler = makeCardActionHandler({
      access: makeAccess(),
      dispatcher: { enqueue, abort },
      log: silentLog,
      lastIngressByChat: new Map(),
      botDefaultCwd: '/tmp',
      botBackendType: 'claude',
      botName: 'claude-bot',
      idleTimeoutMs: 600_000,
      sessions: { get: () => undefined },
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
    const { enqueue, abort } = makeMocks();
    const handler = makeCardActionHandler({
      access: makeAccess({ allowed_users: ['ou_other'] }),
      dispatcher: { enqueue, abort },
      log: silentLog,
      lastIngressByChat: new Map(),
      botDefaultCwd: '/tmp',
      botBackendType: 'claude',
      botName: 'claude-bot',
      idleTimeoutMs: 600_000,
      sessions: { get: () => undefined },
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
    const { enqueue, abort } = makeMocks();
    const handler = makeCardActionHandler({
      access: makeAccess(),
      dispatcher: { enqueue, abort },
      log: silentLog,
      lastIngressByChat: new Map(),
      botDefaultCwd: '/tmp',
      botBackendType: 'claude',
      botName: 'claude-bot',
      idleTimeoutMs: 600_000,
      sessions: { get: () => undefined },
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

describe('cmdToCommand', () => {
  it('maps plain command buttons to structured commands', () => {
    expect(cmdToCommand('new', {})).toEqual({ name: 'new', args: [] });
    expect(cmdToCommand('status', {})).toEqual({ name: 'status', args: [] });
    expect(cmdToCommand('help', {})).toEqual({ name: 'help', args: [] });
    expect(cmdToCommand('ws.list', {})).toEqual({ name: 'ws', args: ['list'] });
  });

  it('threads value.name into ws.use / ws.remove as a discrete arg', () => {
    expect(cmdToCommand('ws.use', { name: 'proj' })).toEqual({ name: 'ws', args: ['use', 'proj'] });
    expect(cmdToCommand('ws.remove', { name: 'proj' })).toEqual({
      name: 'ws',
      args: ['remove', 'proj'],
    });
  });

  it('keeps a workspace name with whitespace intact (no slash re-split)', () => {
    // Regression: a name like "foo bar" must survive as ONE arg, not split
    // into ['foo', 'bar'] — otherwise the click resolves to the wrong (or a
    // truncated-prefix) workspace.
    expect(cmdToCommand('ws.use', { name: 'foo bar' })).toEqual({
      name: 'ws',
      args: ['use', 'foo bar'],
    });
    expect(cmdToCommand('ws.remove', { name: 'a\nb' })).toEqual({
      name: 'ws',
      args: ['remove', 'a\nb'],
    });
  });

  it('returns undefined for ws.* without a name', () => {
    expect(cmdToCommand('ws.use', {})).toBeUndefined();
    expect(cmdToCommand('ws.remove', { name: 42 })).toBeUndefined();
  });

  it('returns undefined for stop (handled inline) and unknown cmds', () => {
    expect(cmdToCommand('stop', {})).toBeUndefined();
    expect(cmdToCommand('bogus', {})).toBeUndefined();
    expect(cmdToCommand(undefined, {})).toBeUndefined();
  });
});

describe('makeCardActionHandler — internal cmd routing', () => {
  function makeHandler(dispatchCommand?: ReturnType<typeof vi.fn>) {
    const { enqueue, abort } = makeMocks();
    const handler = makeCardActionHandler({
      access: makeAccess(),
      dispatcher: { enqueue, abort },
      log: silentLog,
      lastIngressByChat: new Map(),
      botDefaultCwd: '/tmp',
      botBackendType: 'claude',
      botName: 'claude-bot',
      idleTimeoutMs: 600_000,
      sessions: { get: () => undefined },
      ...(dispatchCommand ? { dispatchCommand } : {}),
    });
    return { handler, enqueue, abort };
  }

  function evt(cmd: string, value: Record<string, unknown>): CardActionEvent {
    return {
      chatId: 'oc_chat',
      messageId: 'om_card',
      operatorOpenId: 'ou_alice',
      cmd,
      value: { cmd, ...value },
      receivedAt: '2026-06-01T00:00:01Z',
    };
  }

  it('routes the 新会话 button (cmd:new) to the new command', async () => {
    const dispatchCommand = vi.fn(async () => {});
    const { handler, enqueue } = makeHandler(dispatchCommand);
    await handler(evt('new', {}));
    expect(dispatchCommand).toHaveBeenCalledWith(
      { name: 'new', args: [] },
      { chatId: 'oc_chat', operatorOpenId: 'ou_alice' },
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('routes ws.use with a name as structured args', async () => {
    const dispatchCommand = vi.fn(async () => {});
    const { handler } = makeHandler(dispatchCommand);
    await handler(evt('ws.use', { name: 'proj' }));
    expect(dispatchCommand).toHaveBeenCalledWith(
      { name: 'ws', args: ['use', 'proj'] },
      { chatId: 'oc_chat', operatorOpenId: 'ou_alice' },
    );
  });

  it('routes a whitespace workspace name as a single arg', async () => {
    const dispatchCommand = vi.fn(async () => {});
    const { handler } = makeHandler(dispatchCommand);
    await handler(evt('ws.use', { name: 'foo bar' }));
    expect(dispatchCommand).toHaveBeenCalledWith(
      { name: 'ws', args: ['use', 'foo bar'] },
      { chatId: 'oc_chat', operatorOpenId: 'ou_alice' },
    );
  });

  it('does not dispatch an unknown cmd', async () => {
    const dispatchCommand = vi.fn(async () => {});
    const { handler } = makeHandler(dispatchCommand);
    await handler(evt('bogus', {}));
    expect(dispatchCommand).not.toHaveBeenCalled();
  });

  it('is a safe no-op when dispatchCommand is not wired', async () => {
    const { handler, enqueue, abort } = makeHandler();
    await handler(evt('new', {}));
    expect(enqueue).not.toHaveBeenCalled();
    expect(abort).not.toHaveBeenCalled();
  });

  it('never lets a dispatchCommand rejection escape into the event loop', async () => {
    // The real dispatchCommand (makeDispatchCommand) owns the user-visible
    // fallback reply; this last-resort catch only guarantees the handler
    // itself never throws even if dispatchCommand somehow does.
    const dispatchCommand = vi.fn(async () => {
      throw new Error('send failed');
    });
    const { handler } = makeHandler(dispatchCommand);
    await expect(handler(evt('status', {}))).resolves.toBeUndefined();
    expect(dispatchCommand).toHaveBeenCalledOnce();
  });
});

// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from 'vitest';
import pino from 'pino';
import { makeDispatchCommand } from '../../src/worker/dispatch-command.js';
import type { CommandCtx } from '../../src/commands/types.js';
import type { ParsedCommand } from '../../src/commands/router.js';

const silentLog = pino({ level: 'silent' });

function makeBot(overrides: Partial<CommandCtx['bot']> = {}): CommandCtx['bot'] {
  return {
    name: 'claude-bot',
    backend: { type: 'claude' },
    access: { allowed_users: [], allowed_chats: [], admins: ['ou_admin'] },
    ...overrides,
  } as CommandCtx['bot'];
}

function setup(dispatchParsed: (cmd: ParsedCommand, ctx: unknown) => Promise<boolean>) {
  const replies: string[] = [];
  const reply = vi.fn(async (t: string) => void replies.push(t));
  const replyCard = vi.fn(async () => {});
  const makeReplies = vi.fn(() => ({ reply, replyCard }));
  const dispatch = makeDispatchCommand({
    router: { dispatchParsed: dispatchParsed as never },
    bot: makeBot(),
    sessions: {} as CommandCtx['sessions'],
    workspaces: {} as CommandCtx['workspaces'],
    makeReplies,
    log: silentLog,
  });
  return { dispatch, replies, reply, replyCard, makeReplies };
}

describe('makeDispatchCommand', () => {
  it('passes the structured command and clicker context through to the router', async () => {
    const calls: Array<{ cmd: ParsedCommand; ctx: Record<string, unknown> }> = [];
    const dispatchParsed = vi.fn(async (cmd: ParsedCommand, ctx: unknown) => {
      calls.push({ cmd, ctx: ctx as Record<string, unknown> });
      return true;
    });
    const { dispatch } = setup(dispatchParsed);

    await dispatch({ name: 'ws', args: ['use', 'foo bar'] }, {
      chatId: 'oc_chat',
      operatorOpenId: 'ou_admin',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.cmd).toEqual({ name: 'ws', args: ['use', 'foo bar'] });
    expect(calls[0]!.ctx).toMatchObject({
      chatId: 'oc_chat',
      senderOpenId: 'ou_admin',
      isAdmin: true, // recomputed from the clicker's open_id (in bot.access.admins)
    });
  });

  it('recomputes admin=false for a non-admin clicker', async () => {
    let seenAdmin: boolean | undefined;
    const dispatchParsed = vi.fn(async (_cmd: ParsedCommand, ctx: unknown) => {
      seenAdmin = (ctx as { isAdmin: boolean }).isAdmin;
      return true;
    });
    const { dispatch } = setup(dispatchParsed);
    await dispatch({ name: 'status', args: [] }, {
      chatId: 'oc_chat',
      operatorOpenId: 'ou_stranger',
    });
    expect(seenAdmin).toBe(false);
  });

  it('sends a best-effort fallback reply when the router throws', async () => {
    const dispatchParsed = vi.fn(async () => {
      throw new Error('SDK down');
    });
    const { dispatch, replies } = setup(dispatchParsed);

    // Must not throw...
    await expect(
      dispatch({ name: 'status', args: [] }, { chatId: 'oc_chat', operatorOpenId: 'ou_admin' }),
    ).resolves.toBeUndefined();
    // ...and the user sees a failure instead of a dead button.
    expect(replies).toEqual(['⚠️ command failed: /status']);
  });

  it('renders args in the fallback message', async () => {
    const dispatchParsed = vi.fn(async () => {
      throw new Error('boom');
    });
    const { dispatch, replies } = setup(dispatchParsed);
    await dispatch({ name: 'ws', args: ['use', 'foo bar'] }, {
      chatId: 'oc_chat',
      operatorOpenId: 'ou_admin',
    });
    expect(replies).toEqual(['⚠️ command failed: /ws use foo bar']);
  });

  it('does not throw when even the fallback reply fails', async () => {
    const dispatchParsed = vi.fn(async () => {
      throw new Error('router boom');
    });
    const reply = vi.fn(async () => {
      throw new Error('reply boom');
    });
    const dispatch = makeDispatchCommand({
      router: { dispatchParsed: dispatchParsed as never },
      bot: makeBot(),
      sessions: {} as CommandCtx['sessions'],
      workspaces: {} as CommandCtx['workspaces'],
      makeReplies: () => ({ reply, replyCard: async () => {} }),
      log: silentLog,
    });
    await expect(
      dispatch({ name: 'new', args: [] }, { chatId: 'oc_chat', operatorOpenId: 'ou_admin' }),
    ).resolves.toBeUndefined();
    expect(reply).toHaveBeenCalledOnce();
  });
});

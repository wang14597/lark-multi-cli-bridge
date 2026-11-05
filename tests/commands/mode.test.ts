// SPDX-License-Identifier: MIT
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { modeHandler } from '../../src/commands/handlers/mode.js';
import { SessionStore } from '../../src/session/store.js';
import type { CommandCtx } from '../../src/commands/types.js';

const tmpDirs: string[] = [];
function mkTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lmcb-mode-test-'));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function makeStore(): Promise<SessionStore> {
  const store = new SessionStore(join(mkTmp(), 'sessions.json'));
  await store.load();
  return store;
}

function makeCtx(args: string[], sessions: SessionStore) {
  const replies: string[] = [];
  const ctx: CommandCtx = {
    chatId: 'oc_test',
    senderOpenId: 'ou_test',
    isAdmin: false,
    args,
    bot: {
      name: 'claude-bot',
      backend: { type: 'claude' },
      behavior: { default_cwd: '~' },
    } as CommandCtx['bot'],
    sessions,
    workspaces: {} as CommandCtx['workspaces'],
    teams: {} as CommandCtx['teams'],
    reply: async (t: string) => void replies.push(t),
  };
  return { ctx, replies };
}

describe('modeHandler', () => {
  it('shows the default mode', async () => {
    const store = await makeStore();
    const { ctx, replies } = makeCtx([], store);
    await modeHandler.run(ctx);
    expect(replies).toEqual(['mode: stream']);
  });

  it('creates the slot when none exists and sets final', async () => {
    const store = await makeStore();
    const { ctx, replies } = makeCtx(['final'], store);
    await modeHandler.run(ctx);
    expect(store.get('oc_test', 'claude-bot')?.outputMode).toBe('final');
    expect(replies).toEqual(['mode: final (applies on next run)']);
    const shown = makeCtx([], store);
    await modeHandler.run(shown.ctx);
    expect(shown.replies).toEqual(['mode: final']);
  });

  it('sets stream back on an existing slot', async () => {
    const store = await makeStore();
    await store.upsert('oc_test', { backend: 'claude', bot: 'claude-bot', cwd: '/tmp' });
    await store.setOutputMode('oc_test', 'claude-bot', 'final');
    const { ctx, replies } = makeCtx(['stream'], store);
    await modeHandler.run(ctx);
    expect(store.get('oc_test', 'claude-bot')?.outputMode).toBeUndefined();
    expect(replies).toEqual(['mode: stream (applies on next run)']);
  });

  it('rejects a bad arg with usage and leaves the session untouched', async () => {
    const store = await makeStore();
    const { ctx, replies } = makeCtx(['bogus'], store);
    await modeHandler.run(ctx);
    expect(replies).toEqual(['usage: /mode [stream|final]']);
    expect(store.get('oc_test', 'claude-bot')).toBeUndefined();
  });
});

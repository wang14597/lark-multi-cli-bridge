// SPDX-License-Identifier: MIT
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { timeoutHandler } from '../../src/commands/handlers/timeout.js';
import { SessionStore } from '../../src/session/store.js';
import type { CommandCtx } from '../../src/commands/types.js';

const tmpDirs: string[] = [];
function mkTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lmcb-timeout-test-'));
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
    reply: async (t: string) => void replies.push(t),
  };
  return { ctx, replies };
}

describe('timeoutHandler', () => {
  it('rejects a non-numeric / non-positive arg without touching the session', async () => {
    const store = await makeStore();
    for (const bad of ['', 'abc', '0', '-5']) {
      const { ctx, replies } = makeCtx([bad], store);
      await timeoutHandler.run(ctx);
      expect(replies.join('\n')).toMatch(/usage/i);
    }
    expect(store.get('oc_test', 'claude-bot')).toBeUndefined();
  });

  it('persists the override (ms) on an existing session slot', async () => {
    const store = await makeStore();
    await store.upsert('oc_test', { backend: 'claude', bot: 'claude-bot', cwd: '/tmp' });
    const { ctx, replies } = makeCtx(['1200'], store);
    await timeoutHandler.run(ctx);
    expect(store.get('oc_test', 'claude-bot')?.idleTimeoutMs).toBe(1_200_000);
    expect(replies.join('\n')).toContain('1200s');
  });

  it('creates a session slot when none exists yet', async () => {
    const store = await makeStore();
    const { ctx } = makeCtx(['300'], store);
    await timeoutHandler.run(ctx);
    const s = store.get('oc_test', 'claude-bot');
    expect(s).toBeDefined();
    expect(s?.idleTimeoutMs).toBe(300_000);
  });
});

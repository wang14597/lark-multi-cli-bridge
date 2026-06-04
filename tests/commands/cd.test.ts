// SPDX-License-Identifier: MIT
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { cdHandler } from '../../src/commands/handlers/cd.js';
import { newHandler } from '../../src/commands/handlers/new.js';
import { SessionStore } from '../../src/session/store.js';
import type { CommandCtx } from '../../src/commands/types.js';

function makeCtx(args: string[], sessions: SessionStore) {
  const replies: string[] = [];
  const ctx: CommandCtx = {
    chatId: 'oc_test',
    senderOpenId: 'ou_test',
    isAdmin: false,
    args,
    bot: { name: 'codex-bot', backend: { type: 'codex' } } as CommandCtx['bot'],
    sessions,
    workspaces: {} as CommandCtx['workspaces'],
    reply: async (t: string) => void replies.push(t),
  };
  return { ctx, replies };
}

async function makeStore(): Promise<{ store: SessionStore; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'lmcb-cd-test-'));
  const store = new SessionStore(join(dir, 'sessions.json'));
  await store.load();
  return { store, dir };
}

describe('cdHandler cwd validation', () => {
  it('rejects a nonexistent directory and does not write the session', async () => {
    const { store } = await makeStore();
    const { ctx, replies } = makeCtx(['/Downloads/wiz/projects/voice-agent'], store);
    await cdHandler.run(ctx);
    expect(replies.join('\n')).toMatch(/does not exist/i);
    expect(store.get('oc_test', 'codex-bot')).toBeUndefined();
  });

  it('rejects a path that exists but is not a directory', async () => {
    const { store, dir } = await makeStore();
    const filePath = join(dir, 'a-file.txt');
    writeFileSync(filePath, 'x');
    const { ctx, replies } = makeCtx([filePath], store);
    await cdHandler.run(ctx);
    expect(replies.join('\n')).toMatch(/not a directory/i);
    expect(store.get('oc_test', 'codex-bot')).toBeUndefined();
  });

  it('accepts an existing directory and writes the session cwd', async () => {
    const { store, dir } = await makeStore();
    const { ctx, replies } = makeCtx([dir], store);
    await cdHandler.run(ctx);
    expect(replies.join('\n')).toContain(dir);
    expect(store.get('oc_test', 'codex-bot')?.cwd).toBe(dir);
  });

  it('expands a bare ~ to the home directory', async () => {
    const { store } = await makeStore();
    const { ctx } = makeCtx(['~'], store);
    await cdHandler.run(ctx);
    const cwd = store.get('oc_test', 'codex-bot')?.cwd;
    expect(cwd).toBeDefined();
    expect(cwd).not.toContain('~');
  });
});

describe('newHandler cwd validation', () => {
  it('rejects a nonexistent directory and does not write the session', async () => {
    const { store } = await makeStore();
    const { ctx, replies } = makeCtx(['/Downloads/does/not/exist'], store);
    await newHandler.run(ctx);
    expect(replies.join('\n')).toMatch(/does not exist/i);
    expect(store.get('oc_test', 'codex-bot')).toBeUndefined();
  });

  it('accepts an existing directory and starts a fresh session there', async () => {
    const { store, dir } = await makeStore();
    const { ctx, replies } = makeCtx([dir], store);
    await newHandler.run(ctx);
    expect(replies.join('\n')).toContain(dir);
    expect(store.get('oc_test', 'codex-bot')?.cwd).toBe(dir);
  });
});

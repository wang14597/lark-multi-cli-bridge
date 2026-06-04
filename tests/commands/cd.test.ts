// SPDX-License-Identifier: MIT
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { cdHandler } from '../../src/commands/handlers/cd.js';
import { newHandler } from '../../src/commands/handlers/new.js';
import { validateCwd } from '../../src/commands/cwd.js';
import { SessionStore } from '../../src/session/store.js';
import type { CommandCtx } from '../../src/commands/types.js';

// Create a tracked temp dir; all of them are removed after each test so the
// suite doesn't leak directories into the OS tmpdir.
const tmpDirs: string[] = [];
function mkTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lmcb-cd-test-'));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

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
  const dir = mkTmp();
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

describe('validateCwd', () => {
  it('returns "does not exist" for a missing directory', async () => {
    const msg = await validateCwd('/definitely/does/not/exist/dir-xyzzy');
    expect(msg).toMatch(/does not exist/i);
  });

  it('returns "not a directory" for a path that is a regular file', async () => {
    const dir = mkTmp();
    const filePath = join(dir, 'a-file.txt');
    writeFileSync(filePath, 'x');
    const msg = await validateCwd(filePath);
    expect(msg).toMatch(/not a directory/i);
  });

  it('returns undefined for an existing directory', async () => {
    expect(await validateCwd(mkTmp())).toBeUndefined();
  });

  it('reports a permission error distinctly from "does not exist"', async () => {
    // A path whose parent directory lacks the execute (x) bit can't be
    // stat'd — Node throws EACCES, not ENOENT. The old catch-all reported
    // every stat failure as "does not exist", which is misleading: the
    // directory may well exist, we just can't see it. POSIX-only: Windows
    // has no execute bit (chmod is largely a no-op) and root bypasses the
    // permission check, so skip in both cases.
    if (process.platform === 'win32' || process.getuid?.() === 0) return;
    const dir = mkTmp();
    const locked = join(dir, 'locked');
    mkdirSync(locked);
    const child = join(locked, 'child');
    chmodSync(locked, 0o000);
    try {
      const msg = await validateCwd(child);
      expect(msg).toBeDefined();
      expect(msg).not.toMatch(/does not exist/i);
      expect(msg).toMatch(/EACCES|cannot access|permission/i);
    } finally {
      chmodSync(locked, 0o755);
    }
  });
});

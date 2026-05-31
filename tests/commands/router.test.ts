// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { parseSlashCommand, CommandRouter } from '../../src/commands/router.js';
import type { CommandCtx } from '../../src/commands/types.js';

describe('parseSlashCommand', () => {
  it('splits name and args', () => {
    expect(parseSlashCommand('/cd /tmp/foo bar')).toEqual({ name: 'cd', args: ['/tmp/foo', 'bar'] });
  });
  it('returns undefined for non-slash text', () => {
    expect(parseSlashCommand('hello')).toBeUndefined();
  });
});

describe('CommandRouter', () => {
  it('routes by name and rejects unknown commands', async () => {
    const seen: string[] = [];
    const router = new CommandRouter([
      { name: 'foo', description: '', run: async (c) => void seen.push('foo:' + c.args.join(',')) },
    ]);
    const replies: string[] = [];
    const ctx = {
      chatId: 'oc_x', senderOpenId: 'ou_x', isAdmin: false,
      bot: {} as CommandCtx['bot'], sessions: {} as CommandCtx['sessions'], workspaces: {} as CommandCtx['workspaces'],
      reply: async (t: string) => void replies.push(t),
    };
    await router.dispatch('/foo a b', ctx);
    await router.dispatch('/bar', ctx);
    expect(seen).toEqual(['foo:a,b']);
    expect(replies.some((r) => r.includes('unknown'))).toBe(true);
  });
});

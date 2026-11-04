// SPDX-License-Identifier: MIT
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { teamHandler } from '../../src/commands/handlers/team.js';
import { CommandRouter } from '../../src/commands/router.js';
import { TeamStore } from '../../src/session/team.js';
import type { CommandCtx } from '../../src/commands/types.js';

function setup(args: string[]) {
  const teams = new TeamStore(join(mkdtempSync(join(tmpdir(), 'lmcb-team-cmd-')), 'teams.json'));
  const replies: string[] = [];
  const ctx = {
    chatId: 'oc_g',
    senderOpenId: 'ou_x',
    isAdmin: true,
    args,
    bot: { name: 'claude-bot' } as CommandCtx['bot'],
    sessions: {} as CommandCtx['sessions'],
    workspaces: {} as CommandCtx['workspaces'],
    teams,
    reply: async (t: string) => void replies.push(t),
  } as CommandCtx;
  return { ctx, teams, replies };
}

describe('teamHandler', () => {
  it('set joins a multi-word role and stores it for this chat', async () => {
    const { ctx, teams, replies } = setup(['set', 'gemini-bot', 'docker', '启动', '/', '测试']);
    await teamHandler.run(ctx);
    expect(await teams.get('oc_g')).toEqual({ 'gemini-bot': { role: 'docker 启动 / 测试' } });
    expect(replies[0]).toContain('gemini-bot');
  });

  it('set without a role or bot prints usage and stores nothing', async () => {
    for (const args of [['set'], ['set', 'codex-bot'], []]) {
      const { ctx, teams, replies } = setup(args);
      await teamHandler.run(ctx);
      expect(replies[0]).toMatch(/^usage:/);
      expect(await teams.get('oc_g')).toEqual({});
    }
  });

  it('rm / list / clear', async () => {
    const { ctx, teams, replies } = setup(['rm', 'codex-bot']);
    await teams.set('oc_g', 'codex-bot', 'review');
    await teamHandler.run(ctx);
    expect(replies[0]).toContain('removed');
    await teamHandler.run({ ...ctx, args: ['rm', 'codex-bot'] });
    expect(replies[1]).toContain('not in');
    await teamHandler.run({ ...ctx, args: ['list'] });
    expect(replies[2]).toContain('no roster');
    await teams.set('oc_g', 'a', 'r');
    await teamHandler.run({ ...ctx, args: ['list'] });
    expect(replies[3]).toContain('a → r');
    await teamHandler.run({ ...ctx, args: ['clear'] });
    expect(await teams.get('oc_g')).toEqual({});
  });

  it('is admin-only through the router', async () => {
    const { ctx, teams, replies } = setup([]);
    const router = new CommandRouter([teamHandler]);
    const { args: _args, ...rest } = ctx;
    await router.dispatch('/team set codex-bot review', { ...rest, isAdmin: false });
    expect(replies[0]).toBe('admin only: /team');
    expect(await teams.get('oc_g')).toEqual({});
  });
});

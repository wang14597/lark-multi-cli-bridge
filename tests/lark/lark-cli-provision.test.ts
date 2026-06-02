// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from 'vitest';
import { ensureLarkProfile } from '../../src/lark/lark-cli-provision.js';

const bot = {
  name: 'claude-bot',
  lark: { app_id: 'cli_aa96561a57b81ed1', app_secret: 'sekrit', tenant: 'lark' as const },
};

function makeRunner(scriptedResponses: Array<{
  match: (args: string[]) => boolean;
  result: { stdout: string; stderr: string; exitCode: number };
}>) {
  const calls: Array<{ args: string[]; stdin?: string }> = [];
  const runLarkCli = vi.fn(async (args: string[], opts?: { stdin?: string }) => {
    calls.push({ args, ...(opts?.stdin !== undefined ? { stdin: opts.stdin } : {}) });
    for (const r of scriptedResponses) {
      if (r.match(args)) return r.result;
    }
    throw new Error(`unexpected runLarkCli args: ${JSON.stringify(args)}`);
  });
  return { runLarkCli, calls };
}

describe('ensureLarkProfile', () => {
  it('skips add when profile with matching app_id already exists', async () => {
    const { runLarkCli, calls } = makeRunner([
      {
        match: (args) => args[0] === 'profile' && args[1] === 'list',
        result: {
          stdout: JSON.stringify([
            { name: 'other', appId: 'cli_aa93d72c97f9deea', brand: 'lark', active: true },
            { name: 'cli_aa96561a57b81ed1', appId: 'cli_aa96561a57b81ed1', brand: 'lark', active: false },
          ]),
          stderr: '',
          exitCode: 0,
        },
      },
    ]);

    await ensureLarkProfile(bot, {
      runLarkCli,
      writeFile: vi.fn(),
      mkdirp: vi.fn(),
    });

    expect(calls.length).toBe(1);
    expect(calls[0]!.args).toEqual(['profile', 'list', '--format', 'json']);
  });
});

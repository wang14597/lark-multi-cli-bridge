// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from 'vitest';
import { ensureLarkProfile, provisionLarkShim } from '../../src/lark/lark-cli-provision.js';

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

  it('runs profile add with --app-secret-stdin when app_id missing from list', async () => {
    const { runLarkCli, calls } = makeRunner([
      {
        match: (args) => args[0] === 'profile' && args[1] === 'list',
        result: {
          stdout: JSON.stringify([
            { name: 'other', appId: 'cli_aa93d72c97f9deea', brand: 'lark', active: true },
          ]),
          stderr: '',
          exitCode: 0,
        },
      },
      {
        match: (args) => args[0] === 'profile' && args[1] === 'add',
        result: { stdout: 'OK', stderr: '', exitCode: 0 },
      },
    ]);

    await ensureLarkProfile(bot, {
      runLarkCli,
      writeFile: vi.fn(),
      mkdirp: vi.fn(),
    });

    expect(calls.length).toBe(2);
    expect(calls[1]!.args).toEqual([
      'profile',
      'add',
      '--name',
      'cli_aa96561a57b81ed1',
      '--app-id',
      'cli_aa96561a57b81ed1',
      '--brand',
      'lark',
      '--app-secret-stdin',
    ]);
    expect(calls[1]!.stdin).toBe('sekrit');
  });

  it('throws when profile add fails', async () => {
    const { runLarkCli } = makeRunner([
      {
        match: (args) => args[0] === 'profile' && args[1] === 'list',
        result: { stdout: '[]', stderr: '', exitCode: 0 },
      },
      {
        match: (args) => args[0] === 'profile' && args[1] === 'add',
        result: { stdout: '', stderr: 'boom', exitCode: 1 },
      },
    ]);
    await expect(
      ensureLarkProfile(bot, { runLarkCli, writeFile: vi.fn(), mkdirp: vi.fn() }),
    ).rejects.toThrow(/profile add failed.*boom/);
  });

  it('throws when profile list returns non-zero', async () => {
    const { runLarkCli } = makeRunner([
      {
        match: (args) => args[0] === 'profile' && args[1] === 'list',
        result: { stdout: '', stderr: 'nope', exitCode: 2 },
      },
    ]);
    await expect(
      ensureLarkProfile(bot, { runLarkCli, writeFile: vi.fn(), mkdirp: vi.fn() }),
    ).rejects.toThrow(/profile list failed.*nope/);
  });
});

describe('provisionLarkShim', () => {
  it('writes shim with exec line bound to real lark-cli + bot app_id', async () => {
    const writes: Array<{ path: string; content: string; mode: number }> = [];
    const mkdirs: string[] = [];
    const writeFile = vi.fn(async (path: string, content: string, mode: number) => {
      writes.push({ path, content, mode });
    });
    const mkdirp = vi.fn(async (path: string) => {
      mkdirs.push(path);
    });

    const shimPath = await provisionLarkShim(
      bot,
      '/tmp/shims/claude-bot',
      '/usr/local/bin/lark-cli',
      { writeFile, mkdirp },
    );

    expect(shimPath).toBe('/tmp/shims/claude-bot/lark-cli');
    expect(mkdirs).toEqual(['/tmp/shims/claude-bot']);
    expect(writes.length).toBe(1);
    expect(writes[0]!.mode).toBe(0o755);
    expect(writes[0]!.path).toBe('/tmp/shims/claude-bot/lark-cli');
    expect(writes[0]!.content).toContain('#!/usr/bin/env bash');
    expect(writes[0]!.content).toContain(
      'exec "/usr/local/bin/lark-cli" --profile "cli_aa96561a57b81ed1" "$@"',
    );
  });

  it('rejects realLarkCliPath that contains a double-quote (shim injection guard)', async () => {
    await expect(
      provisionLarkShim(
        bot,
        '/tmp/shims/x',
        '/usr/local/bin/lark"; rm -rf /; "cli',
        { writeFile: vi.fn(), mkdirp: vi.fn() },
      ),
    ).rejects.toThrow(/unsafe lark-cli path/);
  });
});

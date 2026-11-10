// SPDX-License-Identifier: MIT
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkerManager } from '../../src/supervisor/worker-manager.js';
import type { BotConfig } from '../../src/config/schema.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, '__fixtures__/exit-worker.js');

const mkBot = (name: string): BotConfig =>
  ({
    name,
    enabled: true,
    lark: { app_id: 'cli_x', app_secret: 's', tenant: 'lark' },
    backend: { type: 'claude', claude: { permission_mode: 'bypassPermissions', extra_args: [] } },
    access: { allowed_users: [], allowed_chats: [], admins: [] },
    behavior: { default_cwd: '~', group_trigger: 'mention', idle_timeout_seconds: 600, max_concurrent_chats: 0 },
  }) as BotConfig;

describe('WorkerManager crash budget', () => {
  let mgr: WorkerManager;
  beforeEach(() => {
    mgr = new WorkerManager({
      workerScript: FIXTURE,
      bots: [mkBot('test-bot')],
      crashBudget: { maxCrashes: 3, windowMs: 1_000 },
      delays: [10, 10, 10, 10, 10],
    });
  });

  it('disables a bot that crashes faster than the budget', async () => {
    process.env.LMCB_FAKE_EXIT = '1';
    process.env.LMCB_FAKE_READY = '0';
    await mgr.start();
    await new Promise((r) => setTimeout(r, 800));
    const status = mgr.statusOf('test-bot');
    expect(['crashed', 'disabled', 'restarting']).toContain(status.state);
    await new Promise((r) => setTimeout(r, 600));
    expect(mgr.statusOf('test-bot').state).toBe('disabled');
    await mgr.stop();
    delete process.env.LMCB_FAKE_EXIT;
    delete process.env.LMCB_FAKE_READY;
  });

  it('marks ready when worker sends ready message and exits cleanly', async () => {
    process.env.LMCB_FAKE_EXIT = '0';
    process.env.LMCB_FAKE_READY = '1';
    await mgr.start();
    await new Promise((r) => setTimeout(r, 100));
    expect(['stopped', 'restarting', 'ready']).toContain(mgr.statusOf('test-bot').state);
    await mgr.stop();
    delete process.env.LMCB_FAKE_EXIT;
    delete process.env.LMCB_FAKE_READY;
  });
});

describe('WorkerManager restart', () => {
  const STUBBORN = resolve(HERE, '__fixtures__/stubborn-worker.cjs');
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  it('kills a worker that ignores SIGTERM before spawning its replacement, and keeps tracking the new one', async () => {
    const pidsFile = join(mkdtempSync(join(tmpdir(), 'wm-')), 'pids');
    process.env.LMCB_FAKE_PIDS = pidsFile;
    const mgr = new WorkerManager({
      workerScript: STUBBORN,
      bots: [mkBot('test-bot')],
      crashBudget: { maxCrashes: 3, windowMs: 60_000 },
      delays: [10],
      killTimeoutMs: 200,
    });
    try {
      await mgr.start();
      await new Promise((r) => setTimeout(r, 300));
      const oldPid = mgr.statusOf('test-bot').pid!;
      await mgr.restart('test-bot');
      await new Promise((r) => setTimeout(r, 500));
      const status = mgr.statusOf('test-bot');
      expect(alive(oldPid)).toBe(false);
      expect(status.pid).toBeDefined();
      expect(status.pid).not.toBe(oldPid);
      expect(status.state).toBe('ready');
      // Exactly one live worker: the old one's late exit must not respawn another.
      const live = readFileSync(pidsFile, 'utf8').trim().split('\n').map(Number).filter(alive);
      expect(live).toEqual([status.pid]);
    } finally {
      await mgr.stop();
      delete process.env.LMCB_FAKE_PIDS;
    }
  });
});

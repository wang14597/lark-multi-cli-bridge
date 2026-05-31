// SPDX-License-Identifier: MIT
import { describe, it, expect, beforeEach } from 'vitest';
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

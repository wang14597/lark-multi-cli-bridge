// SPDX-License-Identifier: MIT
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAllBots, loadGlobalConfig } from '../../src/config/load.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lmcb-cfg-'));
});

describe('loadGlobalConfig', () => {
  it('returns defaults when file missing', async () => {
    const cfg = await loadGlobalConfig(join(dir, 'missing.yaml'));
    expect(cfg.log_retention_days).toBe(7);
  });
});

describe('loadAllBots', () => {
  it('reads every YAML in bots/ and validates name matches filename', async () => {
    const botsDir = join(dir, 'bots');
    mkdirSync(botsDir, { recursive: true });
    writeFileSync(
      join(botsDir, 'claude-bot.yaml'),
      `
name: claude-bot
enabled: true
lark: { app_id: cli_a, app_secret: s, tenant: lark }
backend: { type: claude, claude: { permission_mode: bypassPermissions } }
access: { allowed_users: [], allowed_chats: [], admins: [] }
behavior: { default_cwd: "~", group_trigger: mention, idle_timeout_seconds: 600, max_concurrent_chats: 0 }
`,
    );
    const bots = await loadAllBots(botsDir);
    expect(bots).toHaveLength(1);
    expect(bots[0]?.name).toBe('claude-bot');
  });

  it('skips files whose name field disagrees with filename, with a warning', async () => {
    const botsDir = join(dir, 'bots');
    mkdirSync(botsDir, { recursive: true });
    writeFileSync(
      join(botsDir, 'claude-bot.yaml'),
      `
name: wrong-name
enabled: true
lark: { app_id: cli_a, app_secret: s, tenant: lark }
backend: { type: claude, claude: { permission_mode: bypassPermissions } }
access: { allowed_users: [], allowed_chats: [], admins: [] }
behavior: { default_cwd: "~", group_trigger: mention, idle_timeout_seconds: 600, max_concurrent_chats: 0 }
`,
    );
    const bots = await loadAllBots(botsDir);
    expect(bots).toHaveLength(0);
  });

  it('returns empty array when bots directory does not exist', async () => {
    const bots = await loadAllBots(join(dir, 'no-such-dir'));
    expect(bots).toEqual([]);
  });
});

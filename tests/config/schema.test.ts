// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { BotConfigSchema, GlobalConfigSchema } from '../../src/config/schema.js';

const minimalClaudeBot = {
  name: 'claude-bot',
  enabled: true,
  lark: { app_id: 'cli_abc', app_secret: 'secret_xyz', tenant: 'lark' },
  backend: { type: 'claude', claude: { permission_mode: 'bypassPermissions' } },
  access: { allowed_users: [], allowed_chats: [], admins: [] },
  behavior: { default_cwd: '~', group_trigger: 'mention', idle_timeout_seconds: 600, max_concurrent_chats: 0 },
};

describe('BotConfigSchema', () => {
  it('accepts a minimal claude bot', () => {
    const parsed = BotConfigSchema.parse(minimalClaudeBot);
    expect(parsed.name).toBe('claude-bot');
  });

  it('accepts a codex bot with codex sub-block', () => {
    const codex = { ...minimalClaudeBot, name: 'codex-bot', backend: { type: 'codex', codex: { extra_args: [] } } };
    const parsed = BotConfigSchema.parse(codex);
    expect(parsed.backend.type).toBe('codex');
  });

  it('rejects bot with mismatched backend sub-block', () => {
    const bad = { ...minimalClaudeBot, backend: { type: 'gemini', claude: {} } };
    expect(() => BotConfigSchema.parse(bad)).toThrow();
  });

  it('rejects bot with unknown backend.type', () => {
    const bad = { ...minimalClaudeBot, backend: { type: 'gpt', claude: {} } };
    expect(() => BotConfigSchema.parse(bad)).toThrow();
  });
});

describe('GlobalConfigSchema', () => {
  it('provides defaults when fields omitted', () => {
    const parsed = GlobalConfigSchema.parse({});
    expect(parsed.log_retention_days).toBe(7);
    expect(parsed.defaults.behavior.group_trigger).toBe('mention');
  });
});

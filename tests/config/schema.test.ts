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

describe('per-backend skill-prompt config', () => {
  it('claude backend accepts injectSkillPrompt + appendSystemPrompt', () => {
    const bot = {
      ...minimalClaudeBot,
      backend: {
        type: 'claude',
        claude: { permission_mode: 'bypassPermissions' },
        injectSkillPrompt: false,
        appendSystemPrompt: 'extra instructions',
      },
    };
    const parsed = BotConfigSchema.parse(bot);
    if (parsed.backend.type !== 'claude') throw new Error('type narrowing');
    expect(parsed.backend.injectSkillPrompt).toBe(false);
    expect(parsed.backend.appendSystemPrompt).toBe('extra instructions');
  });

  it('codex backend accepts injectSkillPrompt + appendSystemPrompt', () => {
    const bot = {
      ...minimalClaudeBot,
      name: 'codex-bot',
      backend: {
        type: 'codex',
        codex: { extra_args: [] },
        injectSkillPrompt: true,
        appendSystemPrompt: 'codex-specific',
      },
    };
    const parsed = BotConfigSchema.parse(bot);
    if (parsed.backend.type !== 'codex') throw new Error('type narrowing');
    expect(parsed.backend.injectSkillPrompt).toBe(true);
    expect(parsed.backend.appendSystemPrompt).toBe('codex-specific');
  });

  it('codex backend accepts skip_git_repo_check in codex sub-block', () => {
    const bot = {
      ...minimalClaudeBot,
      name: 'codex-bot',
      backend: {
        type: 'codex',
        codex: { extra_args: [], skip_git_repo_check: false },
      },
    };
    const parsed = BotConfigSchema.parse(bot);
    if (parsed.backend.type !== 'codex') throw new Error('type narrowing');
    expect(parsed.backend.codex.skip_git_repo_check).toBe(false);
  });

  it('codex backend leaves skip_git_repo_check undefined when omitted', () => {
    const bot = {
      ...minimalClaudeBot,
      name: 'codex-bot',
      backend: {
        type: 'codex',
        codex: { extra_args: [] },
      },
    };
    const parsed = BotConfigSchema.parse(bot);
    if (parsed.backend.type !== 'codex') throw new Error('type narrowing');
    expect(parsed.backend.codex.skip_git_repo_check).toBeUndefined();
  });

  it('codex backend accepts bypass_sandbox in codex sub-block', () => {
    const bot = {
      ...minimalClaudeBot,
      name: 'codex-bot',
      backend: {
        type: 'codex',
        codex: { extra_args: [], bypass_sandbox: false },
      },
    };
    const parsed = BotConfigSchema.parse(bot);
    if (parsed.backend.type !== 'codex') throw new Error('type narrowing');
    expect(parsed.backend.codex.bypass_sandbox).toBe(false);
  });

  it('codex backend leaves bypass_sandbox undefined when omitted (adapter defaults on)', () => {
    const bot = {
      ...minimalClaudeBot,
      name: 'codex-bot',
      backend: {
        type: 'codex',
        codex: { extra_args: [] },
      },
    };
    const parsed = BotConfigSchema.parse(bot);
    if (parsed.backend.type !== 'codex') throw new Error('type narrowing');
    expect(parsed.backend.codex.bypass_sandbox).toBeUndefined();
  });

  it('gemini backend accepts the same two fields', () => {
    const bot = {
      ...minimalClaudeBot,
      name: 'gemini-bot',
      backend: {
        type: 'gemini',
        gemini: { extra_args: [] },
      },
    };
    const parsed = BotConfigSchema.parse(bot);
    if (parsed.backend.type !== 'gemini') throw new Error('type narrowing');
    expect(parsed.backend.injectSkillPrompt).toBeUndefined();
    expect(parsed.backend.appendSystemPrompt).toBeUndefined();
  });
});

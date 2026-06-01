// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { buildAdapter } from '../../src/adapters/registry.js';
import { BOT_SKILL_PROMPT } from '../../src/prompts/lark-bot-skill.js';
import type { BotConfig } from '../../src/config/schema.js';

const baseClaudeBot: BotConfig = {
  name: 'claude-bot',
  enabled: true,
  lark: { app_id: 'cli_x', app_secret: 's', tenant: 'lark' },
  backend: {
    type: 'claude',
    claude: { permission_mode: 'bypassPermissions', extra_args: [] },
  },
  access: { allowed_users: [], allowed_chats: [], admins: [] },
  behavior: { default_cwd: '~', group_trigger: 'mention', idle_timeout_seconds: 600, max_concurrent_chats: 0 },
};

describe('buildAdapter — effective system prompt resolution', () => {
  it('defaults to injecting BOT_SKILL_PROMPT when injectSkillPrompt is absent', () => {
    const adapter = buildAdapter(baseClaudeBot);
    expect((adapter as any).opts.appendSystemPrompt).toBe(BOT_SKILL_PROMPT);
  });

  it('omits the skill prompt when injectSkillPrompt is false', () => {
    const bot: BotConfig = {
      ...baseClaudeBot,
      backend: { ...baseClaudeBot.backend, injectSkillPrompt: false } as any,
    };
    const adapter = buildAdapter(bot);
    expect((adapter as any).opts.appendSystemPrompt ?? '').toBe('');
  });

  it('concatenates appendSystemPrompt after the skill prompt when both set', () => {
    const bot: BotConfig = {
      ...baseClaudeBot,
      backend: { ...baseClaudeBot.backend, appendSystemPrompt: 'EXTRA' } as any,
    };
    const adapter = buildAdapter(bot);
    expect((adapter as any).opts.appendSystemPrompt).toBe(BOT_SKILL_PROMPT + '\n\n' + 'EXTRA');
  });

  it('uses only appendSystemPrompt when skill-prompt is disabled', () => {
    const bot: BotConfig = {
      ...baseClaudeBot,
      backend: { ...baseClaudeBot.backend, injectSkillPrompt: false, appendSystemPrompt: 'EXTRA' } as any,
    };
    const adapter = buildAdapter(bot);
    expect((adapter as any).opts.appendSystemPrompt).toBe('EXTRA');
  });

  it('passes the same effective prompt into codex adapter', () => {
    const codexBot: BotConfig = {
      ...baseClaudeBot,
      name: 'codex-bot',
      backend: { type: 'codex', codex: { json_mode: true, extra_args: [] } },
    };
    const adapter = buildAdapter(codexBot);
    expect((adapter as any).opts.appendSystemPrompt).toBe(BOT_SKILL_PROMPT);
  });

  it('passes skip_git_repo_check from codex sub-block into adapter opts', () => {
    const codexBot: BotConfig = {
      ...baseClaudeBot,
      name: 'codex-bot',
      backend: { type: 'codex', codex: { json_mode: true, extra_args: [], skip_git_repo_check: false } as any },
    };
    const adapter = buildAdapter(codexBot);
    expect((adapter as any).opts.skipGitRepoCheck).toBe(false);
  });

  it('leaves skipGitRepoCheck undefined when codex sub-block omits it (adapter defaults to true)', () => {
    const codexBot: BotConfig = {
      ...baseClaudeBot,
      name: 'codex-bot',
      backend: { type: 'codex', codex: { json_mode: true, extra_args: [] } },
    };
    const adapter = buildAdapter(codexBot);
    expect((adapter as any).opts.skipGitRepoCheck).toBeUndefined();
  });

  it('passes the same effective prompt into gemini adapter', () => {
    const geminiBot: BotConfig = {
      ...baseClaudeBot,
      name: 'gemini-bot',
      backend: { type: 'gemini', gemini: { extra_args: [] } },
    };
    const adapter = buildAdapter(geminiBot);
    expect((adapter as any).opts.appendSystemPrompt).toBe(BOT_SKILL_PROMPT);
  });
});

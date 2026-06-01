// SPDX-License-Identifier: MIT
import { ClaudeAdapter } from './claude.js';
import { CodexAdapter } from './codex.js';
import { GeminiAdapter } from './gemini.js';
import { BOT_SKILL_PROMPT } from '../prompts/lark-bot-skill.js';
import type { Adapter } from './types.js';
import type { BotConfig } from '../config/schema.js';

function resolveSystemPrompt(backend: BotConfig['backend']): string {
  const inject = backend.injectSkillPrompt ?? true;
  const skill = inject ? BOT_SKILL_PROMPT : '';
  const extra = backend.appendSystemPrompt ?? '';
  if (skill && extra) return `${skill}\n\n${extra}`;
  return skill || extra;
}

export function buildAdapter(bot: BotConfig): Adapter {
  const appendSystemPrompt = resolveSystemPrompt(bot.backend);
  switch (bot.backend.type) {
    case 'claude': {
      const cfg = bot.backend.claude;
      return new ClaudeAdapter({
        permissionMode: cfg.permission_mode,
        ...(cfg.model !== undefined ? { model: cfg.model } : {}),
        extraArgs: cfg.extra_args,
        ...(appendSystemPrompt ? { appendSystemPrompt } : {}),
      });
    }
    case 'codex': {
      const cfg = bot.backend.codex;
      return new CodexAdapter({
        jsonMode: cfg.json_mode,
        ...(cfg.model !== undefined ? { model: cfg.model } : {}),
        extraArgs: cfg.extra_args,
        ...(appendSystemPrompt ? { appendSystemPrompt } : {}),
      });
    }
    case 'gemini': {
      const cfg = bot.backend.gemini;
      return new GeminiAdapter({
        ...(cfg.model !== undefined ? { model: cfg.model } : {}),
        extraArgs: cfg.extra_args,
        ...(appendSystemPrompt ? { appendSystemPrompt } : {}),
      });
    }
  }
}

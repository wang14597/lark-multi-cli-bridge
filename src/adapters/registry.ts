// SPDX-License-Identifier: MIT
import { ClaudeAdapter } from './claude.js';
import { CodexAdapter } from './codex.js';
import { GeminiAdapter } from './gemini.js';
import type { Adapter } from './types.js';
import type { BotConfig } from '../config/schema.js';

export function buildAdapter(bot: BotConfig): Adapter {
  switch (bot.backend.type) {
    case 'claude': {
      const cfg = bot.backend.claude;
      return new ClaudeAdapter({
        permissionMode: cfg.permission_mode,
        ...(cfg.model !== undefined ? { model: cfg.model } : {}),
        extraArgs: cfg.extra_args,
      });
    }
    case 'codex': {
      const cfg = bot.backend.codex;
      return new CodexAdapter({
        jsonMode: cfg.json_mode,
        ...(cfg.model !== undefined ? { model: cfg.model } : {}),
        extraArgs: cfg.extra_args,
      });
    }
    case 'gemini': {
      const cfg = bot.backend.gemini;
      return new GeminiAdapter({
        ...(cfg.model !== undefined ? { model: cfg.model } : {}),
        extraArgs: cfg.extra_args,
      });
    }
  }
}

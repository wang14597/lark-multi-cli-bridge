// SPDX-License-Identifier: MIT
import { resolveCwd } from '../cwd.js';
import type { CommandHandler } from '../types.js';

export const timeoutHandler: CommandHandler = {
  name: 'timeout',
  description: 'override idle_timeout_seconds for this chat',
  async run(ctx) {
    const seconds = parseInt(ctx.args[0] ?? '', 10);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      await ctx.reply('usage: /timeout <seconds>');
      return;
    }
    const ms = seconds * 1000;
    // Persist the override on this (chatId, botName) slot. The dispatcher reads
    // it via resolveIdleTimeoutMs and prefers it over the bot default on the
    // next run. Create the slot first if the chat has no session yet.
    const existing = ctx.sessions.get(ctx.chatId, ctx.bot.name);
    if (existing) {
      await ctx.sessions.setIdleTimeout(ctx.chatId, ctx.bot.name, ms);
    } else {
      await ctx.sessions.upsert(ctx.chatId, {
        backend: ctx.bot.backend.type,
        bot: ctx.bot.name,
        cwd: resolveCwd(ctx.bot.behavior.default_cwd),
        idleTimeoutMs: ms,
      });
    }
    await ctx.reply(`idle timeout for this chat set to ${seconds}s (applies on next run)`);
  },
};

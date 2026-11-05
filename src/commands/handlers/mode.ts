// SPDX-License-Identifier: MIT
import { resolveCwd } from '../cwd.js';
import type { CommandHandler } from '../types.js';

export const modeHandler: CommandHandler = {
  name: 'mode',
  description: 'show or set output mode for this chat: stream (default) or final (conclusion only)',
  async run(ctx) {
    const arg = ctx.args[0];
    if (arg === undefined) {
      const current = ctx.sessions.get(ctx.chatId, ctx.bot.name)?.outputMode ?? 'stream';
      await ctx.reply(`mode: ${current}`);
      return;
    }
    if (arg !== 'stream' && arg !== 'final') {
      await ctx.reply('usage: /mode [stream|final]');
      return;
    }
    // Create the slot first if the chat has no session yet (same as /timeout).
    if (!ctx.sessions.get(ctx.chatId, ctx.bot.name)) {
      await ctx.sessions.upsert(ctx.chatId, {
        backend: ctx.bot.backend.type,
        bot: ctx.bot.name,
        cwd: resolveCwd(ctx.bot.behavior.default_cwd),
      });
    }
    await ctx.sessions.setOutputMode(ctx.chatId, ctx.bot.name, arg);
    await ctx.reply(`mode: ${arg} (applies on next run)`);
  },
};

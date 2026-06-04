// SPDX-License-Identifier: MIT
import { resolveCwd, validateCwd } from '../cwd.js';
import type { CommandHandler } from '../types.js';

export const newHandler: CommandHandler = {
  name: 'new',
  description: 'start a new session; optionally change cwd',
  async run(ctx) {
    const arg = ctx.args[0];
    const existing = ctx.sessions.get(ctx.chatId, ctx.bot.name);
    if (!existing && !arg) {
      await ctx.reply('no existing session; pass a path to start: /new <path>');
      return;
    }
    if (arg) {
      const cwd = resolveCwd(arg);
      const invalid = await validateCwd(cwd);
      if (invalid) {
        await ctx.reply(invalid);
        return;
      }
      // Ensure the record exists at the new cwd, then reset clears sessionId.
      // upsert with sessionId: undefined would NOT clear an existing id, it would preserve it,
      // so we upsert (sets cwd/bot/backend) then reset (clears sessionId).
      await ctx.sessions.upsert(ctx.chatId, {
        backend: ctx.bot.backend.type,
        bot: ctx.bot.name,
        cwd,
      });
      await ctx.sessions.reset(ctx.chatId, ctx.bot.name);
      await ctx.reply(`new session in ${cwd}`);
    } else {
      await ctx.sessions.reset(ctx.chatId, ctx.bot.name);
      await ctx.reply('new session started');
    }
  },
};

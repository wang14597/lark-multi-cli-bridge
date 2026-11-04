// SPDX-License-Identifier: MIT
import type { CommandHandler } from '../types.js';

const USAGE = 'usage: /team set <bot-name> <role> | rm <bot-name> | list | clear';

export const teamHandler: CommandHandler = {
  name: 'team',
  description: 'group roster: set <bot> <role> | rm <bot> | list | clear',
  adminOnly: true,
  async run(ctx) {
    const [sub, bot, ...roleParts] = ctx.args;
    switch (sub) {
      case 'set': {
        const role = roleParts.join(' ');
        if (!bot || !role) return ctx.reply(USAGE);
        await ctx.teams.set(ctx.chatId, bot, role);
        return ctx.reply(`team: ${bot} → ${role}`);
      }
      case 'rm': {
        if (!bot) return ctx.reply(USAGE);
        const removed = await ctx.teams.remove(ctx.chatId, bot);
        return ctx.reply(
          removed ? `team: removed ${bot}` : `team: ${bot} is not in this group's roster`,
        );
      }
      case 'list': {
        const entries = Object.entries(await ctx.teams.get(ctx.chatId));
        if (entries.length === 0) return ctx.reply('team: no roster for this group');
        return ctx.reply(entries.map(([name, m]) => `  ${name} → ${m.role}`).join('\n'));
      }
      case 'clear': {
        await ctx.teams.clear(ctx.chatId);
        return ctx.reply('team: roster cleared');
      }
      default:
        return ctx.reply(USAGE);
    }
  },
};

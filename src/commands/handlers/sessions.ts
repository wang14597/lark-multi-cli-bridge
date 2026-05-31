// SPDX-License-Identifier: MIT
import type { CommandHandler } from '../types.js';

export const sessionsHandler: CommandHandler = {
  name: 'sessions',
  description: 'list all chat sessions on this bot (admin)',
  adminOnly: true,
  async run(ctx) {
    const all = ctx.sessions.list().filter((s) => s.session.bot === ctx.bot.name);
    if (all.length === 0) {
      await ctx.reply('no sessions');
      return;
    }
    const lines = all.map(({ chatId, session }) =>
      `  ${chatId}  cwd=${session.cwd}  count=${session.messageCount}  last=${session.lastUsedAt}`,
    );
    await ctx.reply(lines.join('\n'));
  },
};

// SPDX-License-Identifier: MIT
import type { CommandHandler } from '../types.js';
import { buildAccessCard } from '../../lark/command-cards.js';

export const accessHandler: CommandHandler = {
  name: 'access',
  description: 'show access lists (admin only)',
  adminOnly: true,
  async run(ctx) {
    const a = ctx.bot.access;

    if (ctx.replyCard !== undefined) {
      await ctx.replyCard(buildAccessCard(a));
      return;
    }

    // Text fallback.
    await ctx.reply(
      [
        `allowed_users: ${a.allowed_users.length === 0 ? '(everyone)' : a.allowed_users.join(', ')}`,
        `allowed_chats: ${a.allowed_chats.length === 0 ? '(everywhere)' : a.allowed_chats.join(', ')}`,
        `admins:        ${a.admins.join(', ') || '(none)'}`,
      ].join('\n'),
    );
  },
};

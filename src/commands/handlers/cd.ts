// SPDX-License-Identifier: MIT
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { CommandHandler } from '../types.js';

export const cdHandler: CommandHandler = {
  name: 'cd',
  description: 'change cwd (keeps session unless --new)',
  async run(ctx) {
    const path = ctx.args[0];
    if (!path) {
      await ctx.reply('usage: /cd <path> [--new]');
      return;
    }
    const reset = ctx.args.includes('--new');
    const cwd = path.startsWith('~') ? path.replace(/^~/, homedir()) : resolve(path);
    const existing = ctx.sessions.get(ctx.chatId);
    if (existing) {
      await ctx.sessions.setCwd(ctx.chatId, cwd, reset);
    } else {
      await ctx.sessions.upsert(ctx.chatId, {
        backend: ctx.bot.backend.type,
        bot: ctx.bot.name,
        cwd,
      });
    }
    await ctx.reply(`cwd: ${cwd}${reset ? ' (session reset)' : ''}`);
  },
};

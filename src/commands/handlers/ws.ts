// SPDX-License-Identifier: MIT
import type { CommandHandler } from '../types.js';
import { buildWorkspacesCard } from '../../lark/command-cards.js';

export const wsHandler: CommandHandler = {
  name: 'ws',
  description: 'workspace: save <name> | use <name> | list | remove <name>',
  async run(ctx) {
    const [sub, name] = ctx.args;
    switch (sub) {
      case 'save': {
        if (!name) return ctx.reply('usage: /ws save <name>');
        const s = ctx.sessions.get(ctx.chatId);
        if (!s) return ctx.reply('no session yet - use /cd first');
        await ctx.workspaces.save(name, s.cwd);
        return ctx.reply(`saved workspace ${name} -> ${s.cwd}`);
      }
      case 'use': {
        if (!name) return ctx.reply('usage: /ws use <name>');
        const path = ctx.workspaces.resolve(name);
        if (!path) return ctx.reply(`unknown workspace: ${name}`);
        const existing = ctx.sessions.get(ctx.chatId);
        if (existing) await ctx.sessions.setCwd(ctx.chatId, path, true);
        else
          await ctx.sessions.upsert(ctx.chatId, {
            backend: ctx.bot.backend.type,
            bot: ctx.bot.name,
            cwd: path,
          });
        return ctx.reply(`switched to ${name} (${path}); session reset`);
      }
      case 'list': {
        const s = ctx.sessions.get(ctx.chatId);
        const current = s?.cwd;
        const named = Object.fromEntries(ctx.workspaces.list().map((w) => [w.name, w.path]));

        if (ctx.replyCard !== undefined) {
          await ctx.replyCard(buildWorkspacesCard(current, named));
          return;
        }

        // Text fallback.
        const all = ctx.workspaces.list();
        if (all.length === 0) return ctx.reply('no workspaces saved');
        return ctx.reply(all.map((w) => `  ${w.name} -> ${w.path}`).join('\n'));
      }
      case 'remove': {
        if (!name) return ctx.reply('usage: /ws remove <name>');
        await ctx.workspaces.remove(name);
        return ctx.reply(`removed ${name}`);
      }
      default:
        return ctx.reply('usage: /ws save|use|list|remove ...');
    }
  },
};

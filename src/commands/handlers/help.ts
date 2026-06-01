// SPDX-License-Identifier: MIT
import type { CommandHandler } from '../types.js';
import { buildHelpCard } from '../../lark/command-cards.js';

export function makeHelpHandler(allHandlers: () => CommandHandler[]): CommandHandler {
  return {
    name: 'help',
    description: 'show available commands',
    async run(ctx) {
      const visible = allHandlers().filter((h) => !h.adminOnly || ctx.isAdmin);

      if (ctx.replyCard !== undefined) {
        await ctx.replyCard(buildHelpCard(visible));
        return;
      }

      // Text fallback.
      const lines: string[] = ['Available commands:'];
      for (const h of visible) {
        lines.push(`  /${h.name}${h.adminOnly ? ' (admin)' : ''} - ${h.description}`);
      }
      await ctx.reply(lines.join('\n'));
    },
  };
}

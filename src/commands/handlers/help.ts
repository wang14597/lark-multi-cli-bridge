// SPDX-License-Identifier: MIT
import type { CommandHandler } from '../types.js';

export function makeHelpHandler(allHandlers: () => CommandHandler[]): CommandHandler {
  return {
    name: 'help',
    description: 'show available commands',
    async run(ctx) {
      const lines: string[] = ['Available commands:'];
      for (const h of allHandlers()) {
        if (h.adminOnly && !ctx.isAdmin) continue;
        lines.push(`  /${h.name}${h.adminOnly ? ' (admin)' : ''} - ${h.description}`);
      }
      await ctx.reply(lines.join('\n'));
    },
  };
}

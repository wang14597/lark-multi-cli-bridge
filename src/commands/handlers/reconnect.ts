// SPDX-License-Identifier: MIT
import type { CommandHandler } from '../types.js';

export interface Reconnector {
  reconnect(): Promise<void>;
}

export function makeReconnectHandler(rc: Reconnector): CommandHandler {
  return {
    name: 'reconnect',
    description: 'force reconnect of the Lark WebSocket (admin)',
    adminOnly: true,
    async run(ctx) {
      await rc.reconnect();
      await ctx.reply('reconnect issued');
    },
  };
}

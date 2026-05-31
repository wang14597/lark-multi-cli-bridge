// SPDX-License-Identifier: MIT
import type { CommandHandler } from '../types.js';

export interface AbortRegistry {
  abort(chatId: string): boolean;
}

export function makeStopHandler(reg: AbortRegistry): CommandHandler {
  return {
    name: 'stop',
    description: 'abort the current run for this chat',
    async run(ctx) {
      const aborted = reg.abort(ctx.chatId);
      await ctx.reply(aborted ? 'aborted current run' : 'nothing running');
    },
  };
}

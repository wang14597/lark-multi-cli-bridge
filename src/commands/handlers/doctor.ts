// SPDX-License-Identifier: MIT
import type { CommandHandler } from '../types.js';
import type { Adapter } from '../../adapters/types.js';

export function makeDoctorHandler(adapter: Adapter): CommandHandler {
  return {
    name: 'doctor',
    description: 'check CLI version, network, and recent errors',
    async run(ctx) {
      const pf = await adapter.preflight();
      const sess = ctx.sessions.get(ctx.chatId, ctx.bot.name);
      const lines = [
        `bot:          ${ctx.bot.name}`,
        `backend:      ${ctx.bot.backend.type}`,
        `cli:          ${pf.ok ? 'OK ' + (pf.version ?? '') : 'FAIL ' + (pf.error ?? '')}`,
        `current_cwd:  ${sess?.cwd ?? '(none)'}`,
        `session_id:   ${sess?.sessionId ?? '(new)'}`,
      ];
      await ctx.reply(lines.join('\n'));
    },
  };
}

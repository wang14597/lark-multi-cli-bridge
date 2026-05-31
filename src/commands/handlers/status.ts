// SPDX-License-Identifier: MIT
import type { CommandHandler } from '../types.js';

export const statusHandler: CommandHandler = {
  name: 'status',
  description: 'show backend, cwd, session id, message count for this chat',
  async run(ctx) {
    const s = ctx.sessions.get(ctx.chatId);
    if (!s) {
      await ctx.reply('no session for this chat yet');
      return;
    }
    await ctx.reply(
      [
        `bot:           ${s.bot}`,
        `backend:       ${s.backend}`,
        `cwd:           ${s.cwd}`,
        `session_id:    ${s.sessionId ?? '(new)'}`,
        `message_count: ${s.messageCount}`,
      ].join('\n'),
    );
  },
};

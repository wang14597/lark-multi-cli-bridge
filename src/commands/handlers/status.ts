// SPDX-License-Identifier: MIT
import type { CommandHandler } from '../types.js';
import { buildStatusCard } from '../../lark/command-cards.js';

export const statusHandler: CommandHandler = {
  name: 'status',
  description: 'show backend, cwd, session id, message count for this chat',
  async run(ctx) {
    const s = ctx.sessions.get(ctx.chatId);
    if (!s) {
      await ctx.reply('no session for this chat yet');
      return;
    }

    if (ctx.replyCard !== undefined) {
      await ctx.replyCard(
        buildStatusCard({
          chatId: ctx.chatId,
          cwd: s.cwd,
          sessionId: s.sessionId,
          agentName: s.bot,
        }),
      );
      return;
    }

    // Text fallback (e.g. in unit tests where replyCard is not available).
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

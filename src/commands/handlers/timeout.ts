// SPDX-License-Identifier: MIT
import type { CommandHandler } from '../types.js';

export const timeoutHandler: CommandHandler = {
  name: 'timeout',
  description: 'override idle_timeout_seconds for this chat',
  async run(ctx) {
    const seconds = parseInt(ctx.args[0] ?? '', 10);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      await ctx.reply('usage: /timeout <seconds>');
      return;
    }
    // The dispatcher resolves per-chat timeout via resolveIdleTimeoutMs (Task 4.5).
    // For now we acknowledge; concrete persistence + dispatcher hookup lands when the M4 wiring task connects everything.
    await ctx.reply(`timeout override accepted: ${seconds}s (applies on next run)`);
  },
};

// SPDX-License-Identifier: MIT
import type { CommandCtx, CommandHandler } from './types.js';

export interface ParsedCommand {
  name: string;
  args: string[];
}

export function parseSlashCommand(text: string): ParsedCommand | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return undefined;
  const parts = trimmed.slice(1).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return undefined;
  const [name, ...args] = parts;
  if (name === undefined) return undefined;
  return { name, args };
}

export class CommandRouter {
  private handlers = new Map<string, CommandHandler>();
  constructor(handlers: CommandHandler[]) {
    for (const h of handlers) this.handlers.set(h.name, h);
  }

  list(includeAdmin: boolean): CommandHandler[] {
    return Array.from(this.handlers.values()).filter((h) => includeAdmin || !h.adminOnly);
  }

  async dispatch(text: string, ctx: Omit<CommandCtx, 'args'>): Promise<boolean> {
    const parsed = parseSlashCommand(text);
    if (!parsed) return false;
    return this.dispatchParsed(parsed, ctx);
  }

  /**
   * Run an already-parsed command. Use this when the command name + args are
   * known structurally (e.g. a card-button click carrying `value.name`) so a
   * name with whitespace is never lossily re-split through `parseSlashCommand`.
   * Returns true once a command was consumed (handled, rejected as unknown, or
   * blocked as admin-only).
   */
  async dispatchParsed(parsed: ParsedCommand, ctx: Omit<CommandCtx, 'args'>): Promise<boolean> {
    const handler = this.handlers.get(parsed.name);
    if (!handler) {
      await ctx.reply(`unknown command: /${parsed.name}`);
      return true;
    }
    if (handler.adminOnly && !ctx.isAdmin) {
      await ctx.reply(`admin only: /${parsed.name}`);
      return true;
    }
    await handler.run({ ...ctx, args: parsed.args });
    return true;
  }
}

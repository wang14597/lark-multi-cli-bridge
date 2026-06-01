// SPDX-License-Identifier: MIT
import type { BotConfig } from '../config/schema.js';
import type { SessionStore } from '../session/store.js';
import type { WorkspaceStore } from '../session/workspace.js';

export interface CommandCtx {
  chatId: string;
  senderOpenId: string;
  isAdmin: boolean;
  args: string[];
  bot: BotConfig;
  sessions: SessionStore;
  workspaces: WorkspaceStore;
  reply(text: string): Promise<void>;
  /** Send a Lark schema-2.0 interactive card. Falls back to reply() in unit tests where undefined. */
  replyCard?: ((card: unknown) => Promise<void>) | undefined;
}

export interface CommandHandler {
  name: string;
  description: string;
  adminOnly?: boolean;
  run(ctx: CommandCtx): Promise<void>;
}

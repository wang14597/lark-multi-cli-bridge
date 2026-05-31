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
}

export interface CommandHandler {
  name: string;
  description: string;
  adminOnly?: boolean;
  run(ctx: CommandCtx): Promise<void>;
}

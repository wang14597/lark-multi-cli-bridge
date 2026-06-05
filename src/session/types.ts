// SPDX-License-Identifier: MIT
import type { BackendType } from '../adapters/types.js';

export interface ChatSession {
  backend: BackendType;
  bot: string;
  sessionId?: string;
  cwd: string;
  lastUsedAt: string;
  messageCount: number;
  /**
   * Per-chat idle-timeout override in milliseconds, set by /timeout. When
   * present it supersedes the bot's configured idle_timeout_seconds for this
   * (chatId, botName) slot. Survives /new and /cd (it's a chat preference, not
   * a per-session-id setting). Unset = use the bot default.
   */
  idleTimeoutMs?: number;
}

/**
 * On-disk schema. Sessions are scoped per (chatId, botName) so that two
 * bots active in the same chat keep their own conversation continuity
 * without overwriting each other's sessionId / cwd.
 *
 * v1 (legacy, pre-multi-bot) stored a single ChatSession per chatId:
 *   { chats: { [chatId]: ChatSession } }
 * SessionStore.load() detects the legacy shape and migrates in place.
 */
export interface SessionsFile {
  chats: Record<string /* chatId */, Record<string /* botName */, ChatSession>>;
}

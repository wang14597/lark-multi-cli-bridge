// SPDX-License-Identifier: MIT
import type { BackendType } from '../adapters/types.js';

export interface ChatSession {
  backend: BackendType;
  bot: string;
  sessionId?: string;
  cwd: string;
  lastUsedAt: string;
  messageCount: number;
}

export interface SessionsFile {
  chats: Record<string, ChatSession>;
}

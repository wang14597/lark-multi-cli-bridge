// SPDX-License-Identifier: MIT
import { readJsonOrDefault, writeJsonAtomic } from '../util/atomic-file.js';
import type { ChatSession, SessionsFile } from './types.js';

export class SessionStore {
  private data: SessionsFile = { chats: {} };
  constructor(private filePath: string) {}

  async load(): Promise<void> {
    this.data = await readJsonOrDefault<SessionsFile>(this.filePath, { chats: {} });
  }

  get(chatId: string): ChatSession | undefined {
    return this.data.chats[chatId];
  }

  list(): Array<{ chatId: string; session: ChatSession }> {
    return Object.entries(this.data.chats).map(([chatId, session]) => ({ chatId, session }));
  }

  async upsert(
    chatId: string,
    patch: Partial<ChatSession> & Pick<ChatSession, 'backend' | 'bot' | 'cwd'>,
  ): Promise<ChatSession> {
    const existing = this.data.chats[chatId];
    const sessionId = patch.sessionId ?? existing?.sessionId;
    const next: ChatSession = {
      backend: patch.backend,
      bot: patch.bot,
      cwd: patch.cwd,
      ...(sessionId !== undefined ? { sessionId } : {}),
      lastUsedAt: new Date().toISOString(),
      messageCount: (existing?.messageCount ?? 0) + 1,
    };
    this.data.chats[chatId] = next;
    await this.persist();
    return next;
  }

  async reset(chatId: string): Promise<void> {
    const existing = this.data.chats[chatId];
    if (!existing) return;
    const { sessionId: _sessionId, ...rest } = existing;
    this.data.chats[chatId] = { ...rest, lastUsedAt: new Date().toISOString() };
    await this.persist();
  }

  async setCwd(chatId: string, cwd: string, resetSession: boolean): Promise<void> {
    const existing = this.data.chats[chatId];
    if (!existing) throw new Error(`chat not initialized: ${chatId}`);
    if (resetSession) {
      const { sessionId: _sessionId, ...rest } = existing;
      this.data.chats[chatId] = { ...rest, cwd, lastUsedAt: new Date().toISOString() };
    } else {
      this.data.chats[chatId] = { ...existing, cwd, lastUsedAt: new Date().toISOString() };
    }
    await this.persist();
  }

  private async persist(): Promise<void> {
    await writeJsonAtomic(this.filePath, this.data);
  }
}

// SPDX-License-Identifier: MIT
import { readJsonOrDefault, writeJsonAtomic } from '../util/atomic-file.js';

export type TeamMembers = Record<string, { role: string }>;
type TeamsFile = Record<string, { members: TeamMembers }>;

/**
 * Per-group team roster: chatId → lmcb bot name → role. Every bot worker in a
 * group writes and reads it, so it follows WorkspaceStore: no cache, every
 * read hits disk, every mutation is a read-modify-write of just its own chat
 * key. Same known limit — cross-process RMW isn't atomic, which is fine for an
 * interactive, low-frequency command.
 */
export class TeamStore {
  constructor(private filePath: string) {}

  async get(chatId: string): Promise<TeamMembers> {
    return (await this.read())[chatId]?.members ?? {};
  }

  async set(chatId: string, bot: string, role: string): Promise<void> {
    const data = await this.read();
    const members = data[chatId]?.members ?? {};
    members[bot] = { role };
    data[chatId] = { members };
    await writeJsonAtomic(this.filePath, data);
  }

  /** Returns false when the bot wasn't in the roster. */
  async remove(chatId: string, bot: string): Promise<boolean> {
    const data = await this.read();
    const members = data[chatId]?.members;
    if (!members || !(bot in members)) return false;
    delete members[bot];
    if (Object.keys(members).length === 0) delete data[chatId];
    await writeJsonAtomic(this.filePath, data);
    return true;
  }

  async clear(chatId: string): Promise<void> {
    const data = await this.read();
    if (!(chatId in data)) return;
    delete data[chatId];
    await writeJsonAtomic(this.filePath, data);
  }

  private async read(): Promise<TeamsFile> {
    const raw = await readJsonOrDefault<TeamsFile>(this.filePath, {});
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  }
}

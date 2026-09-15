// SPDX-License-Identifier: MIT
import { readJsonOrDefault, writeJsonAtomic } from '../util/atomic-file.js';

interface WorkspacesFile {
  named: Record<string, string>;
}

/**
 * Named workspace aliases (`/ws save <name>` → cwd), shared by every bot:
 * a path saved from claude-bot is meant to be usable from codex-bot. That
 * global namespace is why this store keeps ONE shared file instead of the
 * per-bot split SessionStore uses — splitting would fragment the aliases.
 *
 * Because the file has many writers, the store is read-through: every read
 * and every mutation goes to disk, and a mutation is a read-modify-write of
 * just its own key. Previously the store loaded once at startup and wrote
 * its whole in-memory snapshot back on every save, so a sibling worker's
 * entries were reverted to whatever this worker booted with, and entries
 * saved elsewhere stayed invisible until restart.
 *
 * Known limit: read-modify-write is not atomic across processes, so two
 * workers mutating in the same few milliseconds can still lose one edit.
 * `/ws` is interactive and low-frequency, so the window is negligible
 * compared to the worker-lifetime window it replaces.
 */
export class WorkspaceStore {
  constructor(private filePath: string) {}

  /**
   * Retained for lifecycle symmetry with SessionStore. The store holds no
   * cache — every accessor reads the file — so there is nothing to warm.
   */
  async load(): Promise<void> {}

  async resolve(name: string): Promise<string | undefined> {
    return (await this.read()).named[name];
  }

  async list(): Promise<Array<{ name: string; path: string }>> {
    const data = await this.read();
    return Object.entries(data.named).map(([name, path]) => ({ name, path }));
  }

  async save(name: string, path: string): Promise<void> {
    const data = await this.read();
    data.named[name] = path;
    await writeJsonAtomic(this.filePath, data);
  }

  async remove(name: string): Promise<void> {
    const data = await this.read();
    delete data.named[name];
    await writeJsonAtomic(this.filePath, data);
  }

  private async read(): Promise<WorkspacesFile> {
    const raw = await readJsonOrDefault<WorkspacesFile>(this.filePath, { named: {} });
    return raw && typeof raw.named === 'object' && raw.named !== null ? raw : { named: {} };
  }
}

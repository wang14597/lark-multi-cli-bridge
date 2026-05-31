// SPDX-License-Identifier: MIT
import { readJsonOrDefault, writeJsonAtomic } from '../util/atomic-file.js';

interface WorkspacesFile {
  named: Record<string, string>;
}

export class WorkspaceStore {
  private data: WorkspacesFile = { named: {} };
  constructor(private filePath: string) {}

  async load(): Promise<void> {
    this.data = await readJsonOrDefault<WorkspacesFile>(this.filePath, { named: {} });
  }

  resolve(name: string): string | undefined {
    return this.data.named[name];
  }

  list(): Array<{ name: string; path: string }> {
    return Object.entries(this.data.named).map(([name, path]) => ({ name, path }));
  }

  async save(name: string, path: string): Promise<void> {
    this.data.named[name] = path;
    await writeJsonAtomic(this.filePath, this.data);
  }

  async remove(name: string): Promise<void> {
    delete this.data.named[name];
    await writeJsonAtomic(this.filePath, this.data);
  }
}

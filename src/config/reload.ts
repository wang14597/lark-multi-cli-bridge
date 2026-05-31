// SPDX-License-Identifier: MIT
import { watch, type FSWatcher } from 'node:fs';
import { EventEmitter } from 'node:events';

export class BotsDirWatcher extends EventEmitter {
  private watcher: FSWatcher | undefined;
  constructor(private dir: string) {
    super();
  }
  start(): void {
    try {
      this.watcher = watch(this.dir, { persistent: false }, (_event, filename) => {
        if (!filename) return;
        if (!filename.endsWith('.yaml') && !filename.endsWith('.yml')) return;
        this.emit('change', filename);
      });
    } catch {
      // Directory doesn't exist yet — that's fine; nothing to watch.
    }
  }
  stop(): void {
    this.watcher?.close();
  }
}

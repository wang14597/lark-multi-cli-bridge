// SPDX-License-Identifier: MIT
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { paths } from '../../config/paths.js';
import { IpcClient } from '../../supervisor/ipc-client.js';
import { Methods } from '../../supervisor/ipc-protocol.js';

const HERE = dirname(fileURLToPath(import.meta.url));

export async function startCommand(opts: { foreground?: boolean }): Promise<void> {
  if (existsSync(paths.ipcSock)) {
    try {
      const client = new IpcClient(paths.ipcSock);
      await client.call(Methods.ping, undefined, 1500);
      console.error('supervisor already running');
      process.exit(1);
    } catch {
      // stale socket — supervisor not actually alive; fall through
    }
  }
  const supervisor = resolve(HERE, '../../supervisor/index.js');
  if (opts.foreground) {
    const { runSupervisor } = await import('../../supervisor/index.js');
    await runSupervisor();
    return;
  }
  const child = spawn(process.execPath, [supervisor], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
  console.log('supervisor started (background)');
}

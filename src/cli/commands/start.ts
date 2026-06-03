// SPDX-License-Identifier: MIT
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { paths } from '../../config/paths.js';
import { IpcClient } from '../../supervisor/ipc-client.js';
import { Methods } from '../../supervisor/ipc-protocol.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// NOTE: path is relative to the BUILT bundle (dist/cli/index.js), not the
// source file — tsup flattens src/cli/commands/start.ts into dist/cli/index.js,
// so the supervisor entry is one level up, in a sibling dist/supervisor/ dir.
export function resolveSupervisorEntry(fromDir: string): string {
  return resolve(fromDir, '../supervisor/index.js');
}

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
  const supervisor = resolveSupervisorEntry(HERE);
  if (opts.foreground) {
    const { runSupervisor } = await import('../../supervisor/index.js');
    await runSupervisor();
    return;
  }
  // The detached spawn below uses stdio: 'ignore', so a bad path would fail
  // silently while we still print success — guard against it loudly instead.
  if (!existsSync(supervisor)) {
    console.error(`supervisor entry not found: ${supervisor} (build layout changed?)`);
    process.exit(1);
  }
  const child = spawn(process.execPath, [supervisor], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
  console.log('supervisor started (background)');
}

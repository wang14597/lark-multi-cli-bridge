// SPDX-License-Identifier: MIT
import { paths } from '../../config/paths.js';
import { IpcClient } from '../../supervisor/ipc-client.js';
import { Methods } from '../../supervisor/ipc-protocol.js';

export async function psCommand(): Promise<void> {
  const client = new IpcClient(paths.ipcSock);
  const res = (await client.call(Methods.listWorkers)) as {
    workers: Array<{
      bot: string;
      state: string;
      pid?: number;
      restartCount: number;
      lastError?: string;
    }>;
    supervisorPid: number;
  };
  console.log(`supervisor pid=${res.supervisorPid}`);
  for (const w of res.workers) {
    console.log(
      `  ${w.bot.padEnd(20)} state=${w.state.padEnd(10)} pid=${w.pid ?? '-'}  restarts=${w.restartCount}${
        w.lastError ? `  last-error="${w.lastError}"` : ''
      }`,
    );
  }
}

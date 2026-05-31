// SPDX-License-Identifier: MIT
import { paths } from '../../config/paths.js';
import { IpcClient } from '../../supervisor/ipc-client.js';
import { Methods } from '../../supervisor/ipc-protocol.js';

export async function reloadCommand(bot: string): Promise<void> {
  const client = new IpcClient(paths.ipcSock);
  await client.call(Methods.reloadWorker, { bot });
  console.log(`reload requested: ${bot}`);
}

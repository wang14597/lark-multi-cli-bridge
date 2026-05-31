// SPDX-License-Identifier: MIT
import { paths } from '../../config/paths.js';
import { IpcClient } from '../../supervisor/ipc-client.js';
import { Methods } from '../../supervisor/ipc-protocol.js';

export async function restartCommand(bot: string): Promise<void> {
  const client = new IpcClient(paths.ipcSock);
  await client.call(Methods.restartWorker, { bot });
  console.log(`restart requested: ${bot}`);
}

// SPDX-License-Identifier: MIT
import { paths } from '../../config/paths.js';
import { IpcClient } from '../../supervisor/ipc-client.js';
import { Methods } from '../../supervisor/ipc-protocol.js';

export async function stopCommand(): Promise<void> {
  const client = new IpcClient(paths.ipcSock);
  try {
    await client.call(Methods.shutdown);
    console.log('supervisor stopping');
  } catch (err) {
    console.error('failed to contact supervisor:', (err as Error).message);
    process.exit(1);
  }
}
